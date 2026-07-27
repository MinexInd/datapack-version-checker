import { useState, useCallback, useRef, useEffect } from 'react'
import type { PackFileMap, CheckResponse, McmetaVersion, Mode } from './api'
import { runCheck, runFix, runFixPreview, fetchVersions } from './api'
import type { FixPreview } from './api'
import Header from './components/Header'
import PackSelector from './components/PackSelector'
import CheckPanel from './components/CheckPanel'
import FixPanel from './components/FixPanel'
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
  const [checkDuration, setCheckDuration] = useState(0)
  const checkStartRef = useRef(0)

  const [fixTarget, setFixTarget] = useState('')
  const [fixSource, setFixSource] = useState('')
  const [fixPreview, setFixPreview] = useState<FixPreview | null>(null)

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

  const clearFiles = useCallback(() => {
    setFiles(null)
    setFileCount(0)
    setFileName('')
    setResult(null)
  }, [])

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
        e.preventDefault()
        if (!loading && files) handleRun()
      }
      if (e.key === 'Escape' && files && !loading) {
        clearFiles()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [files, loading, clearFiles])

  const handleRun = useCallback(async () => {
    if (!files) { setError('Select a pack first'); return }
    setLoading(true)
    setError('')
    setResult(null)
    setProgress('Running compatibility check...')
    const startTime = Date.now()
    checkStartRef.current = startTime
    try {
      const versionList = all ? undefined : selectedVersions.length ? selectedVersions : undefined
      const res = await runCheck({ mode, versions: versionList, all, strict, files, onProgress: setProgress })
      setCheckDuration(Date.now() - checkStartRef.current)
      setResult(res)
    } catch (err: any) {
      setError(err.message || String(err))
    } finally {
      setLoading(false)
      setProgress('')
    }
  }, [files, mode, all, strict, selectedVersions])

  const handleFixPreview = useCallback(async () => {
    if (!files) { setError('Select a pack first'); return }
    if (!fixTarget) { setError('Choose a target version to port to'); return }
    setLoading(true)
    setError('')
    setFixPreview(null)
    setProgress('Generating fix preview...')
    try {
      const preview = await runFixPreview({ files, targetVersion: fixTarget, sourceVersion: fixSource || undefined })
      setFixPreview(preview)
      setProgress('')
    } catch (err: any) {
      setError(err.message || String(err))
    } finally {
      setLoading(false)
      setProgress('')
    }
  }, [files, fixTarget, fixSource])

  const handleFix = useCallback(async () => {
    if (!files) { setError('Select a pack first'); return }
    if (!fixTarget) { setError('Choose a target version to port to'); return }
    setLoading(true)
    setError('')
    setProgress(`Downloading ported pack to ${fixTarget}...`)
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

  return (
    <div className="container">
      <Header />

      {!files && (
        <div className="hero-grid animate-in-d1">
          <div className="hero-card">
            <span className="hc-icon">⌘</span>
            <h3>Command Validation</h3>
            <p>Checks every .mcfunction against the target version's command tree.</p>
          </div>
          <div className="hero-card">
            <span className="hc-icon">📦</span>
            <h3>Registry &amp; mcdoc</h3>
            <p>Validates JSON files against per-version registries and mcdoc schemas.</p>
          </div>
          <div className="hero-card">
            <span className="hc-icon">▦</span>
            <h3>mcdoc Structural</h3>
            <p>Validates JSON against Minecraft's type system — catches field changes, removed fields, and structural issues across versions.</p>
          </div>
          <div className="hero-card">
            <span className="hc-icon">⚡</span>
            <h3>Auto-Fix</h3>
            <p>Ports packs between versions — rewrites commands and fixes JSON automatically.</p>
          </div>
        </div>
      )}

      <PackSelector
        files={files}
        fileCount={fileCount}
        fileName={fileName}
        onLoad={loadFiles}
        onClear={clearFiles}
      />

      {/* Tabs */}
      <div className="tab-bar animate-in-d3">
        <button className={`tab ${tab === 'check' ? 'active' : ''}`} onClick={() => setTab('check')}>Check Compatibility</button>
        <button className={`tab ${tab === 'fix' ? 'active' : ''}`} onClick={() => setTab('fix')}>Auto-Fix / Port</button>
      </div>

      {tab === 'check' && (
        <CheckPanel
          mode={mode}
          onModeChange={setMode}
          all={all}
          onAllChange={setAll}
          strict={strict}
          onStrictChange={setStrict}
          versions={versions}
          versionsLoading={versionsLoading}
          selectedVersions={selectedVersions}
          onSelectedVersionsChange={setSelectedVersions}
          onRun={handleRun}
          loading={loading}
          hasFiles={!!files}
        />
      )}

      {tab === 'fix' && (
        <FixPanel
          versions={versions}
          fixTarget={fixTarget}
          onFixTargetChange={(v) => { setFixTarget(v); setFixPreview(null) }}
          fixSource={fixSource}
          onFixSourceChange={(v) => { setFixSource(v); setFixPreview(null) }}
          fixPreview={fixPreview}
          onPreview={handleFixPreview}
          onDownload={handleFix}
          loading={loading}
          hasFiles={!!files}
        />
      )}

      {progress && (
        <div className="progress-bar">
          <span className="spinner" />
          <span style={{ position: 'relative', zIndex: 1 }}>{progress}</span>
        </div>
      )}
      {error && (
        <div className="error">
          <span>⚠</span>
          <span>{error}</span>
        </div>
      )}

      {loading && !result && !error && (
        <div className="card" style={{ animation: 'fadeScale 0.25s ease both' }}>
          <h2>Results <span className="sub">checking…</span></h2>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginTop: 14 }}>
            {[1, 2, 3, 4].map(i => (
              <div key={i} className="skeleton" style={{ padding: '18px 20px', borderRadius: 10 }}>
                <div className="skeleton-line w40" style={{ height: 28, marginBottom: 6 }} />
                <div className="skeleton-line w60" style={{ height: 10 }} />
              </div>
            ))}
          </div>
          <div style={{ marginTop: 16 }}>
            {[1, 2, 3].map(i => (
              <div key={i} className="skeleton-row">
                <div className="skeleton sk-name">
                  <div className="skeleton-line w60" />
                </div>
                <div className="sk-pills">
                  <div className="skeleton skeleton-pill" />
                  <div className="skeleton skeleton-pill" />
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {result && <Results result={result.result} mode={result.mode} duration={checkDuration} />}

      <footer className="app-footer">
        <p>Runs entirely in your browser — nothing is uploaded.</p>
        <div className="footer-links">
          <a href="https://github.com/MinexInd/datapack-version-checker" target="_blank" rel="noopener">GitHub</a>
          <a href="https://github.com/MinexInd/datapack-version-checker/issues" target="_blank" rel="noopener">Report Issue</a>
          <span style={{ color: 'var(--text-faint)', fontSize: '0.76rem' }}>v0.6.0</span>
        </div>
      </footer>
    </div>
  )
}
