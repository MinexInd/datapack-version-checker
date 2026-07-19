import { useState, useCallback, useRef, useEffect } from 'react'
import JSZip from 'jszip'
import type { PackFileMap, CheckResponse, McmetaVersion, Mode } from './api'
import { runCheck, runFix, fetchVersions } from './api'
import Results from './components/Results'

type Tab = 'check' | 'fix'

export default function App() {
  const [tab, setTab] = useState<Tab>('check')
  const [mode, setMode] = useState<Mode>('auto')
  const [all, setAll] = useState(false)
  const [strict, setStrict] = useState(false)
  const [selectedVersions, setSelectedVersions] = useState<string[]>([])
  const [files, setFiles] = useState<PackFileMap | null>(null)
  const [fileCount, setFileCount] = useState(0)
  const [fileName, setFileName] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [result, setResult] = useState<CheckResponse | null>(null)
  const [progress, setProgress] = useState('')
  const [versions, setVersions] = useState<McmetaVersion[]>([])
  const [versionsLoading, setVersionsLoading] = useState(true)
  const [versionSearch, setVersionSearch] = useState('')

  const filteredVersions = versions.filter(v => {
    const q = versionSearch.trim().toLowerCase()
    if (!q) return true
    return (
      v.name.toLowerCase().includes(q) ||
      v.id.toLowerCase().includes(q) ||
      v.type.toLowerCase().includes(q)
    )
  })

  // Fix mode
  const [fixTarget, setFixTarget] = useState('')
  const [fixSource, setFixSource] = useState('')

  const folderRef = useRef<HTMLInputElement>(null)
  const zipRef = useRef<HTMLInputElement>(null)
  const dropRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    fetchVersions()
      .then(v => setVersions(v))
      .catch(() => {})
      .finally(() => setVersionsLoading(false))
  }, [])

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

  const toggleVersion = (name: string) => {
    setSelectedVersions(prev =>
      prev.includes(name) ? prev.filter(v => v !== name) : [...prev, name]
    )
  }

  const handleRun = useCallback(async () => {
    if (!files) { setError('Select a pack first'); return }
    setLoading(true)
    setError('')
    setResult(null)
    setProgress('Running compatibility check...')
    try {
      const versionList = all ? undefined : selectedVersions.length ? selectedVersions : undefined
      const res = await runCheck({ mode, versions: versionList, all, strict, files })
      setResult(res)
    } catch (err: any) {
      setError(err.message || String(err))
    } finally {
      setLoading(false)
      setProgress('')
    }
  }, [files, mode, all, strict, selectedVersions])

  const handleFix = useCallback(async () => {
    if (!files) { setError('Select a pack first'); return }
    if (!fixTarget) { setError('Choose a target version to port to'); return }
    setLoading(true)
    setError('')
    setProgress(`Porting pack to ${fixTarget}...`)
    try {
      const blob = await runFix({ files, targetVersion: fixTarget, sourceVersion: fixSource || undefined })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `fixed_${fixTarget.replace(/[^a-zA-Z0-9._-]/g, '_')}.zip`
      a.click()
      URL.revokeObjectURL(url)
      setProgress('')
    } catch (err: any) {
      setError(err.message || String(err))
    } finally {
      setLoading(false)
      setProgress('')
    }
  }, [files, fixTarget, fixSource])

  const clearFiles = () => {
    setFiles(null)
    setFileCount(0)
    setFileName('')
    setResult(null)
  }

  return (
    <div className="container">
      <header>
        <div className="logo">🔍</div>
        <div className="title-block">
          <h1>dpcheck</h1>
          <p>Datapack &amp; Resource Pack Version Checker</p>
        </div>
        <div className="spacer" />
        <span className="header-badge">content-based analysis</span>
      </header>

      {/* Pack selection */}
      <div className="card">
        <h2>📦 Pack <span className="sub">folder or .zip containing pack.mcmeta</span></h2>
        {files ? (
          <div className="dz-loaded">
            <div className="checkicon">✓</div>
            <div className="meta">
              <div className="name">{fileName}</div>
              <div className="count">{fileCount} files loaded</div>
            </div>
            <div className="dz-btns">
              <button className="btn btn-ghost" onClick={() => folderRef.current?.click()}>Change</button>
              <button className="btn btn-ghost" onClick={clearFiles}>✕</button>
            </div>
          </div>
        ) : (
          <div
            ref={dropRef}
            className="dropzone"
            onDrop={handleDrop}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onClick={() => folderRef.current?.click()}
          >
            <div className="dz-icon">📁</div>
            <p>Drop a datapack / resource pack here, or click to browse</p>
            <div className="dz-hint">Supports folders (Chrome/Edge) and .zip files</div>
          </div>
        )}
        <input ref={folderRef} type="file" webkitdirectory="" directory="" onChange={handleFolder} style={{ display: 'none' }} />
        <input ref={zipRef} type="file" accept=".zip" onChange={handleZipInput} style={{ display: 'none' }} />
      </div>

      {/* Tabs */}
      <div className="tabs">
        <button className={`tab ${tab === 'check' ? 'active' : ''}`} onClick={() => setTab('check')}>🔎 Check Compatibility</button>
        <button className={`tab ${tab === 'fix' ? 'active' : ''}`} onClick={() => setTab('fix')}>🔧 Auto-Fix / Port</button>
      </div>

      {tab === 'check' && (
        <div className="card">
          <h2>⚙️ Options</h2>
          <div className="field">
            <label>Mode</label>
            <div className="segmented">
              {(['auto', 'datapack', 'resourcepack'] as const).map(m => (
                <button key={m} className={mode === m ? 'active' : ''} onClick={() => setMode(m)}>
                  {m === 'auto' ? 'Auto' : m === 'datapack' ? 'Datapack' : 'Resource Pack'}
                </button>
              ))}
            </div>
          </div>

          <div className="field">
            <label>
              Versions to check
              <span style={{ color: 'var(--text-faint)', fontWeight: 400, marginLeft: 6 }}>
                (leave all unchecked = auto-window around load range)
              </span>
            </label>
            {versionsLoading ? (
              <div className="hint">Loading versions…</div>
            ) : (
              <>
                <input
                  type="text"
                  placeholder="🔍 Search versions (e.g. 1.20, 24w, snapshot)…"
                  value={versionSearch}
                  onChange={e => setVersionSearch(e.target.value)}
                  style={{ marginBottom: 10 }}
                />
                <div className="scl-list" style={{ maxHeight: 145 }}>
                  {filteredVersions.map(v => (
                    <div
                      key={v.id}
                      className={`scl-row ${selectedVersions.includes(v.name) ? 'sel' : ''}`}
                      onClick={() => toggleVersion(v.name)}
                    >
                      <span className="scl-name">{v.name}</span>
                      <span className={`scl-tag ${v.type === 'snapshot' ? 'snap' : 'rel'}`}>{v.type}</span>
                    </div>
                  ))}
                </div>
              </>
            )}
            <div className="hint" style={{ marginTop: 6 }}>
              <span>{versions.length} versions{versionSearch ? `, ${filteredVersions.length} match` : ''}</span>
              <span style={{ marginLeft: 12 }}>
                <button className="btn btn-ghost btn-sm" onClick={() => setSelectedVersions(filteredVersions.map(v => v.name))}>All</button>
                <button className="btn btn-ghost btn-sm" onClick={() => setSelectedVersions([])}>Clear</button>
                {selectedVersions.length > 0 && (
                  <span style={{ marginLeft: 6, color: 'var(--text-faint)', fontSize: '0.76rem' }}>{selectedVersions.length} selected</span>
                )}
              </span>
            </div>
          </div>

          <div className="checks">
            <label className="check">
              <input type="checkbox" checked={all} onChange={e => setAll(e.target.checked)} />
              Check ALL versions (incl. snapshots)
            </label>
            <label className="check">
              <input type="checkbox" checked={strict} onChange={e => setStrict(e.target.checked)} />
              Strict command validation
            </label>
            <button className="btn btn-primary" style={{ marginLeft: 'auto' }} onClick={handleRun} disabled={loading || !files}>
              {loading ? <><span className="spinner" /> Running…</> : '▶ Run Check'}
            </button>
          </div>
        </div>
      )}

      {tab === 'fix' && (
        <div className="card">
          <h2>🔧 Auto-Fix / Port <span className="sub">rewrites commands, fixes JSON, updates pack.mcmeta</span></h2>
          <div className="grid-2">
            <div className="field">
              <label>Target version</label>
              <select value={fixTarget} onChange={e => setFixTarget(e.target.value)}>
                <option value="">— select target —</option>
                {versions.map(v => (
                  <option key={v.id} value={v.name}>{v.name}</option>
                ))}
              </select>
            </div>
            <div className="field">
              <label>Source version (optional)</label>
              <select value={fixSource} onChange={e => setFixSource(e.target.value)}>
                <option value="">— auto-detect —</option>
                {versions.map(v => (
                  <option key={v.id} value={v.name}>{v.name}</option>
                ))}
              </select>
              <div className="hint">Auto-detected from pack.mcmeta load range if blank.</div>
            </div>
          </div>
          <button className="btn btn-success" onClick={handleFix} disabled={loading || !files || !fixTarget}>
            {loading ? <><span className="spinner" /> Porting…</> : '🔧 Port & Download .zip'}
          </button>
        </div>
      )}

      {progress && (
        <div className="progress-bar">
          <span className="spinner" />
          {progress}
        </div>
      )}
      {error && (
        <div className="error">
          <span>⚠</span>
          <span>{error}</span>
        </div>
      )}

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
