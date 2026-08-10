import { useCallback, useRef } from 'react'
import JSZip from 'jszip'
import type { PackFileMap } from '../api'

interface Props {
  files: PackFileMap | null
  fileCount: number
  fileName: string
  onLoad: (entries: PackFileMap, name: string) => void
  onClear: () => void
}

// Folder and zipped uploads usually nest every path under the chosen folder
// name (e.g. "pack/pack.mcmeta"). The engine expects pack-relative keys, so we
// locate pack.mcmeta and trim its parent prefix off every entry.
function normalizePackFiles(files: PackFileMap): PackFileMap {
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

export default function PackSelector({ files, fileCount, fileName, onLoad, onClear }: Props) {
  const folderRef = useRef<HTMLInputElement>(null)
  const zipRef = useRef<HTMLInputElement>(null)

  const handleFolder = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const dir = e.target.files
    if (!dir) return
    const entries: PackFileMap = {}
    for (let i = 0; i < dir.length; i++) {
      const f = dir[i]
      const rel = f.webkitRelativePath || f.name
      if (rel.startsWith('.')) continue
      entries[rel] = await f.text()
    }
    await onLoad(normalizePackFiles(entries), dir[0]?.webkitRelativePath?.split('/')[0] || 'folder')
  }, [onLoad])

  const handleZip = useCallback(async (file: File) => {
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
    await onLoad(normalizePackFiles(entries), file.name)
  }, [onLoad])

  const handleZipInput = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    await handleZip(file)
  }, [handleZip])

  const handleDrop = useCallback(async (e: React.DragEvent) => {
    e.preventDefault()
    const items = e.dataTransfer.items
    if (!items) return
    for (const item of items) {
      if (item.kind === 'file') {
        const file = item.getAsFile()
        if (!file) continue
        if (file.name.endsWith('.zip') || file.type === 'application/zip') {
          await handleZip(file)
          return
        }
      }
    }
    for (const item of items) {
      const entry = item.webkitGetAsEntry?.()
      if (entry?.isDirectory) {
        const allFiles = await readDirectoryEntry(entry)
        onLoad(normalizePackFiles(allFiles), entry.name)
        return
      }
    }
  }, [handleZip, onLoad])

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.currentTarget.classList.add('dragover')
  }, [])

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.currentTarget.classList.remove('dragover')
  }, [])

  return (
    <div className="card animate-in-d2">
      <h2>
        Pack
        <span className="sub">
          {files ? <><span className="kbd">Esc</span> to clear</> : 'required'}
        </span>
      </h2>
      {files ? (
        <div className="dz-loaded">
          <div className="checkicon">✓</div>
          <div className="meta">
            <div className="name">{fileName}</div>
            <div className="count">{fileCount} files loaded</div>
          </div>
          <div className="dz-btns">
            <button className="btn btn-ghost" onClick={() => folderRef.current?.click()}>Replace</button>
            <button className="btn btn-ghost" aria-label="Remove pack" onClick={onClear}>✕</button>
          </div>
        </div>
      ) : (
        <div
          className="dropzone"
          onDrop={handleDrop}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
        >
          <div className="dz-icon">
            <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ opacity: 0.5 }}>
              <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
            </svg>
          </div>
          <p>Drop a datapack / resource pack here</p>
          <div className="dz-hint">Folder or .zip containing pack.mcmeta</div>
          <div className="dz-browse">
            <button type="button" className="browse-link" onClick={(e) => { e.stopPropagation(); folderRef.current?.click() }}>Browse folder</button>
            <span className="browse-sep">·</span>
            <button type="button" className="browse-link" onClick={(e) => { e.stopPropagation(); zipRef.current?.click() }}>Browse .zip</button>
          </div>
        </div>
      )}
      <input ref={folderRef} type="file" {...{ webkitdirectory: '', directory: '' } as any} onChange={handleFolder} style={{ display: 'none' }} />
      <input ref={zipRef} type="file" accept=".zip" onChange={handleZipInput} style={{ display: 'none' }} />
    </div>
  )
}

async function readDirectoryEntry(entry: any): Promise<PackFileMap> {
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
