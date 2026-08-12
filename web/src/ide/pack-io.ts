import JSZip from 'jszip'
import type { PackFileMap } from '../api'

// Folder and zipped uploads usually nest every path under the chosen folder
// name (e.g. "pack/pack.mcmeta"). The engine expects pack-relative keys, so we
// locate pack.mcmeta and trim its parent prefix off every entry.
export function normalizePackFiles(files: PackFileMap): PackFileMap {
  const pmKey = Object.keys(files).find(k => {
    const seg = k.split('/')
    return seg[seg.length - 1] === 'pack.mcmeta' && !k.includes('/data/')
  })
  if (!pmKey || pmKey === 'pack.mcmeta') return files
  const root = pmKey.slice(0, pmKey.length - 'pack.mcmeta'.length)
  const out: PackFileMap = {}
  for (const [k, v] of Object.entries(files)) {
    out[k.startsWith(root) ? k.slice(root.length) : k] = v
  }
  return out
}

/** Recursively read a directory entry (from DataTransfer webkitGetAsEntry). */
export async function readDirectoryEntry(entry: any): Promise<PackFileMap> {
  const files: PackFileMap = {}
  const reader = entry.createReader()

  const readAllEntries = () => new Promise<any[]>((resolve, reject) => {
    const all: any[] = []
    const readBatch = () => {
      reader.readEntries((batch: any[]) => {
        if (batch.length === 0) resolve(all)
        else { all.push(...batch); readBatch() }
      }, (err: any) => reject(err))
    }
    readBatch()
  })

  const entries = await readAllEntries()
  for (const e of entries) {
    if (e.isDirectory) {
      const sub = await readDirectoryEntry(e)
      for (const [k, v] of Object.entries(sub)) {
        files[e.name + '/' + k] = v as string
      }
    } else {
      const file = await new Promise<File>((resolve, reject) => e.file(resolve, reject))
      if (!file.name.startsWith('.')) {
        files[file.name] = await file.text()
      }
    }
  }
  return files
}

/** Read a .zip file and return its contents as a PackFileMap. */
export async function readZipFile(file: File): Promise<PackFileMap> {
  const zip = await JSZip.loadAsync(file)
  const entries: PackFileMap = {}
  const promises: Promise<void>[] = []
  zip.forEach((rel, entry) => {
    if (entry.dir) return
    const name = rel.replace(/\\/g, '/')
    if (name.startsWith('.') || name.startsWith('__MACOSX')) return
    promises.push(
      entry.async('string').then(content => { entries[name] = content })
    )
  })
  await Promise.all(promises)
  return entries
}

/**
 * Read files from a DataTransfer (drag-and-drop).
 * Returns the normalized pack contents, or null if unsupported.
 */
export async function readDroppedFiles(dataTransfer: DataTransfer): Promise<PackFileMap | null> {
  const items = dataTransfer.items
  if (!items) return null

  // Check for .zip files first
  for (const item of items) {
    if (item.kind === 'file') {
      const file = item.getAsFile()
      if (!file) continue
      if (file.name.endsWith('.zip') || file.type === 'application/zip') {
        return normalizePackFiles(await readZipFile(file))
      }
    }
  }

  // Check for directory entries
  for (const item of items) {
    const entry = item.webkitGetAsEntry?.()
    if (entry?.isDirectory) {
      const allFiles = await readDirectoryEntry(entry)
      return normalizePackFiles(allFiles)
    }
  }

  return null
}
