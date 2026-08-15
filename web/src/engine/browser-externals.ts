import type {
  DecompressedFile,
  Externals,
  ExternalErrorKind,
  ExternalStats,
  FsLocation,
} from '@spyglassmc/core'
import { gunzipBytes, parseTar } from './tar'

const SPYGLASS_HOST = 'api.spyglassmc.com'
const PROXY_PREFIX = '/api/spyglassmc'
const JDELIVR_BASE = 'https://cdn.jsdelivr.net/gh/misode/mcmeta'

/**
 * Resolve a Spyglass API URL to a CORS-friendly mirror, or undefined to keep
 * the original request.
 *
 * api.spyglassmc.com is unreliable in production: it intermittently drops
 * CORS headers (BunnyCDN 502s) and the OPTIONS preflight always fails. jsDelivr
 * serves the same misode/mcmeta data with proper CORS headers, so production
 * requests are redirected there. The vanilla mcdoc tarball is bundled into the
 * build (web/public/vanilla-mcdoc.tar.gz) and served same-origin.
 */
// Vanilla data/resourcepack tarballs are bundled same-origin for this release.
// jsDelivr serves raw files, not tarballs, so it can't provide these; the
// original API returns correct gzips but is intermittently down. Bundling the
// current latest release covers the common "auto" case reliably. Other versions
// fall back to the original API (correct per-version tarball when healthy).
const BUNDLED_VERSION = '26.2'

function resolveSpyglassRewrite(url: string): string | undefined {
  const prefix = `https://${SPYGLASS_HOST}`

  // Versions list (no version suffix). The Spyglass API proxies mcmeta's
  // summary/versions/data.json — a flat array of version objects — so serve it
  // directly from raw.githubusercontent.com (CORS-enabled, serves branches
  // reliably). jsDelivr 404s on cold branch-ref edges and the original API's
  // /mcje/versions endpoint is intermittently down (502).
  if (url === `${prefix}/mcje/versions`) {
    return 'https://raw.githubusercontent.com/misode/mcmeta/summary/versions/data.json'
  }

  // Vanilla mcdoc tarball → same-origin bundled asset
  if (url === `${prefix}/vanilla-mcdoc/tarball`) {
    return '/vanilla-mcdoc.tar.gz'
  }

  // Version-specific endpoints: /mcje/versions/:v/...
  const versionMatch = url.match(
    new RegExp(`^${prefix.replace('.', '\\.')}/mcje/versions/([^/]+)/(.+)$`),
  )
  if (versionMatch) {
    const [, version, rest] = versionMatch

    // Tarballs: bundle same-origin (jsDelivr can't serve tarballs). Only the
    // bundled release is served locally; other versions fall back to the API.
    if (rest === 'vanilla-data/tarball') {
      return version === BUNDLED_VERSION ? '/vanilla-data.tar.gz' : undefined
    }
    if (rest === 'vanilla-assets-tiny/tarball') {
      return version === BUNDLED_VERSION ? '/vanilla-assets-tiny.tar.gz' : undefined
    }

    // Summary JSONs: block_states, commands, registries → jsDelivr tags
    const summaryMap: Record<string, string> = {
      block_states: 'blocks',
      commands: 'commands',
      registries: 'registries',
    }
    for (const [apiName, dirName] of Object.entries(summaryMap)) {
      if (rest === apiName) {
        return `${JDELIVR_BASE}@${version}-summary/${dirName}/data.json`
      }
    }
  }

  return undefined
}

let fetchPatched = false
function applyFetchProxy() {
  if (fetchPatched || typeof window === 'undefined' || typeof globalThis.fetch !== 'function') return
  fetchPatched = true
  const original = globalThis.fetch
  const isLocalhost = window.location.hostname === 'localhost'

  globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    let url: string
    if (typeof input === 'string') url = input
    else if (input instanceof URL) url = input.toString()
    else url = input.url

    // Spyglass's fetchWithCache sets non-simple headers (if-none-match,
    // if-modified-since, user-agent) that force a CORS preflight. External
    // CDNs (jsDelivr, raw.githubusercontent) reject preflights, so drop ALL
    // custom headers and send a plain GET. No CDN needs these headers, and
    // Spyglass's own cache handles revalidation.
    const method = (input as Request)?.method ?? init?.method ?? 'GET'
    const body = (input as Request)?.body ?? (init as any)?.body
    const signal = (input as Request)?.signal ?? (init as any)?.signal

    if (!url.startsWith(`https://${SPYGLASS_HOST}/`)) {
      // Non-Spyglass request (e.g. api.ts → jsDelivr/raw.githubusercontent):
      // forward as a plain request with no custom headers.
      return original(new Request(url, { method, body, signal }))
    }

    let rewritten: string | undefined
    if (isLocalhost) {
      rewritten = PROXY_PREFIX + url.slice(`https://${SPYGLASS_HOST}`.length)
    } else {
      rewritten = resolveSpyglassRewrite(url)
    }
    if (!rewritten) {
      return original(new Request(url, { method, body, signal }))
    }

    try {
      const req = new Request(rewritten, {
        method,
        body,
        signal,
        credentials: 'omit',
        mode: 'cors',
      })
      const res = await original(req)
      if (res.ok) return res
      throw new Error(`rewrite response ${res.status}`)
    } catch {
      // Rewrite failed (e.g. CDN hiccup): fall back to the original API.
      return original(new Request(url, { method, body, signal }))
    }
  }
}
applyFetchProxy()

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