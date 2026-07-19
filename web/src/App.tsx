import { useState, useCallback, useRef } from 'react'
import JSZip from 'jszip'
import type { PackFileMap, CheckResponse } from './api'
import { runCheck } from './api'
import Results from './components/Results'

type PackType = 'auto' | 'datapack' | 'resourcepack'

export default function App() {
  const [mode, setMode] = useState<PackType>('auto')
  const [versions, setVersions] = useState('1.21,1.21.1,1.21.2,1.21.3,1.21.4,1.21.5')
  const [all, setAll] = useState(false)
  const [strict, setStrict] = useState(false)
  const [files, setFiles] = useState<PackFileMap | null>(null)
  const [fileCount, setFileCount] = useState(0)
  const [fileName, setFileName] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [result, setResult] = useState<CheckResponse | null>(null)
  const [progress, setProgress] = useState('')
  const folderRef = useRef<HTMLInputElement>(null)
  const zipRef = useRef<HTMLInputElement>(null)
  const dropRef = useRef<HTMLDivElement>(null)

  const loadFiles = useCallback(async (entries: PackFileMap, name: string) => {
    setFiles(entries)
    setFileCount(Object.keys(entries).length)
    setFileName(name)
    setError('')
    setResult(null)
  }, [])

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
    await loadFiles(entries, dir[0]?.webkitRelativePath?.split('/')[0] || 'folder')
  }, [loadFiles])

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
    await loadFiles(entries, file.name)
  }, [loadFiles])

  const handleZipInput = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    await handleZip(file)
  }, [handleZip])

  const handleDrop = useCallback(async (e: React.DragEvent) => {
    e.preventDefault()
    const items = e.dataTransfer.items
    if (!items) return
    // Check for zip file
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
    // Fallback: try folder via webkitGetAsEntry
    for (const item of items) {
      const entry = item.webkitGetAsEntry?.()
      if (entry?.isDirectory) {
        // Read directory via FileReader
        const allFiles = await readDirectoryEntry(entry)
        await loadFiles(allFiles, entry.name)
        return
      }
    }
    setError('Drop a .zip file or a folder containing pack.mcmeta')
  }, [handleZip, loadFiles])

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.currentTarget.classList.add('dragover')
  }, [])

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.currentTarget.classList.remove('dragover')
  }, [])

  const handleRun = useCallback(async () => {
    if (!files) { setError('Select a pack first'); return }
    setLoading(true)
    setError('')
    setResult(null)
    setProgress('Running compatibility check...')
    try {
      const versionList = all ? undefined : versions.split(',').map(v => v.trim()).filter(Boolean)
      const res = await runCheck({ mode, versions: versionList, all, strict, files })
      setResult(res)
    } catch (err: any) {
      setError(err.message || String(err))
    } finally {
      setLoading(false)
      setProgress('')
    }
  }, [files, mode, versions, all, strict])

  return (
    <div className="container">
      <header>
        <h1>🔍 dpcheck</h1>
        <p>Datapack / Resource Pack Version Checker</p>
      </header>

      <div className="card">
        <h2>📦 Pack</h2>
        <div
          ref={dropRef}
          className="file-zone"
          onDrop={handleDrop}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
        >
          {files ? (
            <>
              <p>✅ {fileName}</p>
              <div className="count">{fileCount} files loaded</div>
              <div style={{ marginTop: 10, fontSize: '0.8rem', color: '#8b949e' }}>
                Drop another pack or click below to change
              </div>
            </>
          ) : (
            <>
              <p>Drop a datapack/resource pack folder or .zip file here</p>
              <div className="count">(the one containing pack.mcmeta)</div>
            </>
          )}
          <div style={{ marginTop: 12, display: 'flex', gap: 8, justifyContent: 'center' }}>
            <button className="mode-btn" onClick={() => folderRef.current?.click()}>
              📁 Select Folder
            </button>
            <button className="mode-btn" onClick={() => zipRef.current?.click()}>
              📦 Select .zip
            </button>
          </div>
          <input ref={folderRef} type="file" webkitdirectory="" directory="" onChange={handleFolder} style={{ display: 'none' }} />
          <input ref={zipRef} type="file" accept=".zip" onChange={handleZipInput} style={{ display: 'none' }} />
        </div>
      </div>

      <div className="card">
        <h2>⚙️ Options</h2>
        <label>Mode</label>
        <div className="mode-group">
          {(['auto', 'datapack', 'resourcepack'] as const).map(m => (
            <button key={m} className={`mode-btn ${mode === m ? 'active' : ''}`} onClick={() => setMode(m)}>
              {m === 'auto' ? 'Auto-detect' : m === 'datapack' ? 'Datapack' : 'Resource Pack'}
            </button>
          ))}
        </div>
        <label>Versions (comma-separated)</label>
        <input type="text" value={versions} onChange={e => setVersions(e.target.value)} disabled={all} />
        <div className="options-row" style={{ marginTop: 12 }}>
          <label><input type="checkbox" checked={all} onChange={e => setAll(e.target.checked)} /> Check all versions</label>
          <label><input type="checkbox" checked={strict} onChange={e => setStrict(e.target.checked)} /> Strict mode</label>
          <button className="btn btn-primary" onClick={handleRun} disabled={loading || !files} style={{ marginLeft: 'auto' }}>
            {loading ? <><span className="spinner" /> Running...</> : '▶ Run Check'}
          </button>
        </div>
      </div>

      {progress && <div className="progress">{progress}</div>}
      {error && <div className="error">{error}</div>}

      {result && <Results result={result.result} mode={result.mode} />}
    </div>
  )
}

async function readDirectoryEntry(entry: any): Promise<PackFileMap> {
  const files: PackFileMap = {}
  const reader = entry.createReader()
  const entries = await new Promise<any[]>((resolve) => {
    const all: any[] = []
    reader.readEntries((batch: any[]) => {
      if (batch.length === 0) resolve(all)
      else all.push(...batch)
    })
  })
  for (const e of entries) {
    if (e.isDirectory) {
      const sub = await readDirectoryEntry(e)
      for (const [k, v] of Object.entries(sub)) {
        files[e.name + '/' + k] = v
      }
    } else {
      const file = await new Promise<File>((resolve) => e.file(resolve))
      if (!file.name.startsWith('.')) {
        files[file.name] = await file.text()
      }
    }
  }
  return files
}
