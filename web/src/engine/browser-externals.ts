import type {
  DecompressedFile,
  Externals,
  ExternalErrorKind,
  ExternalStats,
  FsLocation,
} from '@spyglassmc/core'
import { gunzipBytes, parseTar } from './tar'

type ExternalDirEntry = ExternalStats & { name: string }

/**
 * Minimal cache stub for this task. Task 2 replaces this with the real
 * IndexedDB-backed implementation.
 */
export interface CacheLike {
  get(url: string): Promise<Response | null>
  put(url: string, response: Response): Promise<void>
}

export function createBrowserExternals(cache: CacheLike): Externals {
  // In-memory FS: the Project reads pack files and vanilla tarball entries
  // through this. Keys are the normalized location strings.
  const files = new Map<string, Uint8Array<ArrayBuffer>>()

  const toPath = (location: FsLocation): string =>
    typeof location === 'string' ? location : location.pathname

  const makeError = (kind: ExternalErrorKind, message: string): Error & { kind?: string } => {
    const e = new Error(message) as Error & { kind?: string }
    e.kind = kind
    return e
  }

  const fileStats = (): ExternalStats => ({
    isDirectory: () => false,
    isFile: () => true,
    isSymbolicLink: () => false,
  })

  const dirStats = (): ExternalStats => ({
    isDirectory: () => true,
    isFile: () => false,
    isSymbolicLink: () => false,
  })

  return {
    archive: {
      async decompressBall(buffer, options) {
        const gz = await gunzipBytes(buffer)
        const entries = parseTar(gz)
        const strip = options?.stripLevel ?? 0
        return entries.map((e): DecompressedFile => ({
          data: e.data,
          mode: 0o644,
          mtime: '1970-01-01T00:00:00.000Z',
          path: e.path.split('/').slice(strip).join('/'),
          type: 'file',
        }))
      },
    },
    error: {
      createKind(kind, message) {
        return makeError(kind, message)
      },
      isKind(e, kind) {
        return typeof e === 'object' && e !== null && (e as { kind?: unknown }).kind === kind
      },
    },
    fs: {
      async readFile(location) {
        const path = toPath(location)
        const data = files.get(path)
        if (!data) throw makeError('ENOENT', `No such file: ${path}`)
        return data
      },
      async stat(location) {
        const path = toPath(location)
        if (files.has(path)) return fileStats()
        const prefix = path.endsWith('/') ? path : path + '/'
        for (const key of files.keys()) {
          if (key.startsWith(prefix)) return dirStats()
        }
        throw makeError('ENOENT', `No such file or directory: ${path}`)
      },
      async readdir(location) {
        const path = toPath(location)
        const prefix = path.endsWith('/') ? path : path + '/'
        const names = new Set<string>()
        for (const key of files.keys()) {
          if (key.startsWith(prefix)) {
            const rest = key.slice(prefix.length)
            const name = rest.split('/')[0]
            if (name) names.add(name)
          }
        }
        const entries: ExternalDirEntry[] = []
        for (const name of names) {
          const isDir = [...files.keys()].some((k) => k.startsWith(prefix + name + '/'))
          entries.push({
            name,
            isDirectory: () => isDir,
            isFile: () => !isDir,
            isSymbolicLink: () => false,
          })
        }
        return entries
      },
      async writeFile(location, data) {
        files.set(toPath(location), typeof data === 'string' ? new TextEncoder().encode(data) : data)
      },
      async mkdir() {
        // In-memory FS has no real directories; no-op.
      },
      async rm(location) {
        files.delete(toPath(location))
      },
      async unlink(location) {
        files.delete(toPath(location))
      },
      async chmod() {
        // No-op: in-memory files are always readable.
      },
      async showFile() {
        // No platform explorer in the browser; no-op.
      },
    },
    web: {
      // CacheLike is a minimal stub for this task; Task 2 swaps in the real
      // IndexedDB-backed Cache implementation.
      getCache: () => Promise.resolve(cache as unknown as Cache),
    },
  }
}