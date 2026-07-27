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
    await onLoad(entries, dir[0]?.webkitRelativePath?.split('/')[0] || 'folder')
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
    await onLoad(entries, file.name)
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
        onLoad(allFiles, entry.name)
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
      <h2>Pack <span className="sub">folder or .zip containing pack.mcmeta</span></h2>
      {files ? (
        <div className="dz-loaded">
          <div className="checkicon">✓</div>
          <div className="meta">
            <div className="name">{fileName}</div>
            <div className="count">{fileCount} files loaded</div>
          </div>
          <div className="dz-btns">
            <button className="btn btn-ghost" onClick={() => folderRef.current?.click()}>Change</button>
            <button className="btn btn-ghost" onClick={onClear}>✕</button>
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
          <div className="dz-hint">Drag a folder or .zip file</div>
          <div className="dz-browse">
            <span className="browse-link" onClick={(e) => { e.stopPropagation(); folderRef.current?.click() }}>Browse folder</span>
            <span className="browse-sep">·</span>
            <span className="browse-link" onClick={(e) => { e.stopPropagation(); zipRef.current?.click() }}>Browse .zip</span>
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
