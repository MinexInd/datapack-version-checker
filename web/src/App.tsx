import { useState, useCallback, useRef, useEffect, useMemo } from 'react'
import type { PackFileMap, CheckResponse, McmetaVersion, Mode } from './api'
import { runCheck, runFix, runFixPreview, fetchVersions } from './api'
import type { FixPreview } from './api'
import HubPage from './components/HubPage'
import IdePage from './components/IdePage'

type View = 'hub' | 'ide'

export default function App() {
  const [view, setView] = useState<View>('hub')
  const [mode, setMode] = useState<Mode>('auto')
  const [all, setAll] = useState(false)
  const [strict, setStrict] = useState(false)
  const [selectedVersions, setSelectedVersions] = useState<string[]>([])
  const [files, setFiles] = useState<PackFileMap | null>(null)
  const [editedFiles, setEditedFiles] = useState<PackFileMap>({})
  const workspaceFiles = useMemo<PackFileMap | null>(() => {
    if (!files) return null
    if (Object.keys(editedFiles).length === 0) return files
    return { ...files, ...editedFiles }
  }, [files, editedFiles])
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
    setEditedFiles({})
  }, [])

  const clearFiles = useCallback(() => {
    setFiles(null)
    setFileCount(0)
    setFileName('')
    setResult(null)
    setEditedFiles({})
  }, [])

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
        e.preventDefault()
        if (!loading && workspaceFiles) handleRun()
      }
      if (e.key === 'Escape' && workspaceFiles && !loading) {
        clearFiles()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [workspaceFiles, loading, clearFiles])

  const handleRun = useCallback(async () => {
    if (!workspaceFiles) { setError('Select a pack first'); return }
    setLoading(true)
    setError('')
    setResult(null)
    setProgress('Running compatibility check...')
    const startTime = Date.now()
    checkStartRef.current = startTime
    try {
      const versionList = all ? undefined : selectedVersions.length ? selectedVersions : undefined
      const res = await runCheck({ mode, versions: versionList, all, strict, files: workspaceFiles, onProgress: setProgress })
      setCheckDuration(Date.now() - checkStartRef.current)
      setResult(res)
    } catch (err: any) {
      setError(err.message || String(err))
    } finally {
      setLoading(false)
      setProgress('')
    }
  }, [workspaceFiles, mode, all, strict, selectedVersions])

  const handleFixPreview = useCallback(async (targetOverride?: string) => {
    if (!workspaceFiles) { setError('Select a pack first'); return }
    const target = targetOverride ?? fixTarget
    if (!target) { setError('Choose a target version to port to'); return }
    setLoading(true)
    setError('')
    setFixPreview(null)
    setProgress('Generating fix preview...')
    try {
      const preview = await runFixPreview({ files: workspaceFiles, targetVersion: target, sourceVersion: fixSource || undefined })
      setFixPreview(preview)
      setProgress('')
    } catch (err: any) {
      setError(err.message || String(err))
    } finally {
      setLoading(false)
      setProgress('')
    }
  }, [workspaceFiles, fixTarget, fixSource])

  /** "Port to X" from a result row: preselect the target and run the same
   *  preview flow as the Fix panel's button (only when a pack is loaded).
   *  IdePage switches to its Fix panel on its own. */
  const handlePortTo = useCallback((versionName: string) => {
    setFixTarget(versionName)
    setFixPreview(null)
    if (workspaceFiles) handleFixPreview(versionName)
  }, [workspaceFiles, handleFixPreview])

  const handleFix = useCallback(async () => {
    if (!workspaceFiles) { setError('Select a pack first'); return }
    if (!fixTarget) { setError('Choose a target version to port to'); return }
    setLoading(true)
    setError('')
    setProgress(`Downloading ported pack to ${fixTarget}...`)
    try {
      const blob = await runFix({ files: workspaceFiles, targetVersion: fixTarget, sourceVersion: fixSource || undefined })
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
  }, [workspaceFiles, fixTarget, fixSource])

  if (view === 'ide') {
    return (
      <IdePage
        originalFiles={files}
        editedFiles={editedFiles}
        onEditedFilesChange={setEditedFiles}
        fileCount={fileCount}
        fileName={fileName}
        onLoad={loadFiles}
        onClear={clearFiles}
        onBack={() => setView('hub')}
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
        loading={loading}
        error={error}
        progress={progress}
        result={result}
        checkDuration={checkDuration}
        onRun={handleRun}
        onPortTo={handlePortTo}
        fixTarget={fixTarget}
        onFixTargetChange={(v) => { setFixTarget(v); setFixPreview(null) }}
        fixSource={fixSource}
        onFixSourceChange={(v) => { setFixSource(v); setFixPreview(null) }}
        fixPreview={fixPreview}
        onPreview={handleFixPreview}
        onDownload={handleFix}
      />
    )
  }

  return <HubPage onOpenDatapackEditor={() => setView('ide')} />
}
