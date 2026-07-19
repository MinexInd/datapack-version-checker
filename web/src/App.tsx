import { useState, useCallback, useRef } from 'react'
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
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [result, setResult] = useState<CheckResponse | null>(null)
  const [progress, setProgress] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  const handleFolder = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const dir = e.target.files
    if (!dir) return
    setError('')
    setResult(null)
    const entries: PackFileMap = {}
    let count = 0
    for (let i = 0; i < dir.length; i++) {
      const f = dir[i]
      const rel = f.webkitRelativePath || f.name
      if (rel.startsWith('.')) continue
      count++
      entries[rel] = await f.text()
    }
    setFiles(entries)
    setFileCount(count)
  }, [])

  const handleRun = useCallback(async () => {
    if (!files) { setError('Select a pack folder first'); return }
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
        <div className="file-zone" onClick={() => inputRef.current?.click()}>
          <input ref={inputRef} type="file" webkitdirectory="" directory="" onChange={handleFolder} />
          {files ? (
            <>
              <p>✅ Folder selected</p>
              <div className="count">{fileCount} files</div>
            </>
          ) : (
            <>
              <p>Click to select your datapack/resource pack folder</p>
              <div className="count">(the one containing pack.mcmeta)</div>
            </>
          )}
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
