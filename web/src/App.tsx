import { useState, useCallback, useRef, useEffect, useMemo } from 'react'
import type { PackFileMap, CheckResponse, McmetaVersion, Mode } from './api'
import { runCheck, runFix, runFixPreview, fetchVersions } from './api'
import type { FixPreview } from './api'
import { buildWorkspaceFiles } from './workspace'
import HubPage from './components/HubPage'
import IdePage from './components/IdePage'

type View = 'hub' | 'ide'

function viewFromPath(): View {
  const seg = window.location.pathname.split('/').filter(Boolean).pop()
  return seg === 'datapack-editor' ? 'ide' : 'hub'
}

export default function App() {
  const [view, setView] = useState<View>(viewFromPath)
  const [mode, setMode] = useState<Mode>('auto')
  const [all, setAll] = useState(false)
  const [strict, setStrict] = useState(false)
  const [selectedVersions, setSelectedVersions] = useState<string[]>([])
  const [files, setFiles] = useState<PackFileMap | null>(null)
  const [editedFiles, setEditedFiles] = useState<PackFileMap>({})
  // Milestone 1: deletions now live here so the single buildWorkspaceFiles
  // derivation below (used by check, fix, analyze and export) sees them too —
  // previously check/fix ignored deletions while analyze/export did not.
  const [deletedFiles, setDeletedFiles] = useState<Set<string>>(new Set())
  // Monotonic revision stamped on every workspace mutation. Any async result
  // (check, fix preview, analyze) is checked against it and marked stale when
  // edits happened while the run was in flight, instead of silently overwriting.
  const [revision, setRevision] = useState(0)
  const revisionRef = useRef(revision)
  useEffect(() => { revisionRef.current = revision }, [revision])
  const [resultStale, setResultStale] = useState(false)
  const [previewStale, setPreviewStale] = useState(false)

  const workspaceFiles = useMemo<PackFileMap | null>(
    () => buildWorkspaceFiles({ originalFiles: files, editedFiles, deletedFiles }),
    [files, editedFiles, deletedFiles],
  )

  const handleEditedFilesChange = useCallback((next: PackFileMap) => {
    setEditedFiles(next)
    setRevision(r => r + 1)
  }, [])
  const handleDeletedFilesChange = useCallback((next: Set<string>) => {
    setDeletedFiles(next)
    setRevision(r => r + 1)
  }, [])

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

  useEffect(() => {
    const onPop = () => setView(viewFromPath())
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [])

  useEffect(() => {
    const redirect = sessionStorage.getItem('dpcheck-redirect')
    if (redirect) {
      sessionStorage.removeItem('dpcheck-redirect')
      history.replaceState(null, '', redirect)
      setView(viewFromPath())
    }
  }, [])

  const loadFiles = useCallback(async (entries: PackFileMap, name: string) => {
    setFiles(entries)
    setFileCount(Object.keys(entries).length)
    setFileName(name)
    setError('')
    setResult(null)
    setEditedFiles({})
    setDeletedFiles(new Set())
    setRevision(r => r + 1)
  }, [])

  const clearFiles = useCallback(() => {
    setFiles(null)
    setFileCount(0)
    setFileName('')
    setResult(null)
    setEditedFiles({})
    setDeletedFiles(new Set())
    setRevision(r => r + 1)
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
    const runRevision = revisionRef.current
    setLoading(true)
    setError('')
    setResult(null)
    setResultStale(false)
    setProgress('Running compatibility check...')
    const startTime = Date.now()
    checkStartRef.current = startTime
    try {
      const versionList = all ? undefined : selectedVersions.length ? selectedVersions : undefined
      const res = await runCheck({ mode, versions: versionList, all, strict, files: workspaceFiles, onProgress: setProgress })
      if (revisionRef.current !== runRevision) setResultStale(true)
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
    const runRevision = revisionRef.current
    setLoading(true)
    setError('')
    setFixPreview(null)
    setPreviewStale(false)
    setProgress('Generating fix preview...')
    try {
      const preview = await runFixPreview({ files: workspaceFiles, targetVersion: target, sourceVersion: fixSource || undefined })
      if (revisionRef.current !== runRevision) setPreviewStale(true)
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
    const runRevision = revisionRef.current
    setLoading(true)
    setError('')
    setProgress(`Downloading ported pack to ${fixTarget}...`)
    try {
      // A port is an irreversible download, so refuse when edits landed on top
      // of the source we started with rather than shipping a stale pack.
      if (revisionRef.current !== runRevision) {
        throw new Error('Workspace changed during the run — re-run to download a current port.')
      }
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

  const openEditor = useCallback(() => {
    history.pushState(null, '', 'datapack-editor')
    setView('ide')
  }, [])

  const backToHub = useCallback(() => {
    history.pushState(null, '', './')
    setView('hub')
  }, [])

  if (view === 'ide') {
    return (
      <IdePage
        originalFiles={files}
        editedFiles={editedFiles}
        onEditedFilesChange={handleEditedFilesChange}
        deletedFiles={deletedFiles}
        onDeletedFilesChange={handleDeletedFilesChange}
        revision={revision}
        fileCount={fileCount}
        fileName={fileName}
        onLoad={loadFiles}
        onClear={clearFiles}
        onBack={backToHub}
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
        resultStale={resultStale}
        checkDuration={checkDuration}
        onRun={handleRun}
        onPortTo={handlePortTo}
        fixTarget={fixTarget}
        onFixTargetChange={(v) => { setFixTarget(v); setFixPreview(null) }}
        fixSource={fixSource}
        onFixSourceChange={(v) => { setFixSource(v); setFixPreview(null) }}
        fixPreview={fixPreview}
        previewStale={previewStale}
        onPreview={handleFixPreview}
        onDownload={handleFix}
      />
    )
  }

  return <HubPage onOpenDatapackEditor={openEditor} />
}
