import { useMemo, useState, useCallback, useEffect, useRef, type ReactNode } from 'react'
import Editor, { type BeforeMount, type OnMount } from '@monaco-editor/react'
import type { languages as MonacoLanguages } from 'monaco-editor'
import PackSelector from './PackSelector'
import CheckPanel from './CheckPanel'
import FixPanel from './FixPanel'
import Results from './Results'
import type { PackFileMap, Mode, McmetaVersion, CheckResponse, FixPreview } from '../api'
import { SpyglassService } from '../engine/spyglass-service'
import { registerSpyglassMonaco } from '../ide/monaco-spyglass'

interface Props {
  originalFiles: PackFileMap | null
  editedFiles: PackFileMap
  onEditedFilesChange: (files: PackFileMap) => void
  fileCount: number
  fileName: string
  onLoad: (entries: PackFileMap, name: string) => void
  onClear: () => void
  onBack: () => void
  mode: Mode
  onModeChange: (m: Mode) => void
  all: boolean
  onAllChange: (v: boolean) => void
  strict: boolean
  onStrictChange: (v: boolean) => void
  versions: McmetaVersion[]
  versionsLoading: boolean
  selectedVersions: string[]
  onSelectedVersionsChange: (v: string[]) => void
  loading: boolean
  error: string
  progress: string
  result: CheckResponse | null
  checkDuration: number
  onRun: () => void
  onPortTo: (versionName: string) => void
  fixTarget: string
  onFixTargetChange: (v: string) => void
  fixSource: string
  onFixSourceChange: (v: string) => void
  fixPreview: FixPreview | null
  onPreview: () => void
  onDownload: () => void
}

interface TreeNode {
  name: string
  path: string
  isDir: boolean
  children: TreeNode[]
}

interface LogEntry {
  time: string
  kind: 'info' | 'success' | 'error' | 'run'
  message: string
}

function buildTree(paths: string[]): TreeNode {
  const root: TreeNode = { name: '', path: '', isDir: true, children: [] }
  for (const p of paths.sort()) {
    const parts = p.split('/')
    let node = root
    let acc = ''
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i]
      const isLast = i === parts.length - 1
      acc = acc ? acc + '/' + part : part
      let child = node.children.find(c => c.name === part)
      if (!child) {
        child = { name: part, path: acc, isDir: !isLast, children: [] }
        node.children.push(child)
      }
      node = child
    }
  }
  root.children.sort((a, b) => (a.isDir === b.isDir ? a.name.localeCompare(b.name) : a.isDir ? -1 : 1))
  for (const walk of (function* () { const stack = [root]; while (stack.length) { const n = stack.pop()!; yield n; for (const c of n.children) stack.push(c) } })()) {
    if (walk.isDir && walk.children.length > 1) {
      walk.children.sort((a, b) => (a.isDir === b.isDir ? a.name.localeCompare(b.name) : a.isDir ? -1 : 1))
    }
  }
  return root
}

function langFor(path: string): string {
  const ext = path.split('.').pop()?.toLowerCase()
  if (ext === 'json' || path.endsWith('.mcmeta')) return 'json'
  if (ext === 'mcfunction') return 'mcfunction'
  if (ext === 'nbt' || ext === 'snbt') return 'plaintext'
  if (ext === 'md') return 'markdown'
  return 'plaintext'
}

export default function IdePage({
  originalFiles,
  editedFiles,
  onEditedFilesChange,
  fileCount,
  fileName,
  onLoad,
  onClear,
  onBack,
  mode, onModeChange,
  all, onAllChange,
  strict, onStrictChange,
  versions, versionsLoading,
  selectedVersions, onSelectedVersionsChange,
  loading, error, progress,
  result, checkDuration,
  onRun, onPortTo,
  fixTarget, onFixTargetChange,
  fixSource, onFixSourceChange,
  fixPreview, onPreview, onDownload,
}: Props) {
  const [openTabs, setOpenTabs] = useState<string[]>([])
  const [activePath, setActivePath] = useState<string | null>(null)
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  const [panel, setPanel] = useState<'analysis' | 'fix' | 'output'>('analysis')
  const [log, setLog] = useState<LogEntry[]>([])

  const serviceRef = useRef<SpyglassService | null>(null)
  const monacoRef = useRef<typeof import('monaco-editor') | null>(null)
  const spyglassRegisteredRef = useRef(false)

  // Spyglass service lifecycle: (re)create when a pack is loaded.
  useEffect(() => {
    if (!originalFiles) {
      serviceRef.current?.close().catch(() => {})
      serviceRef.current = null
      return
    }
    const service = new SpyglassService()
    serviceRef.current = service
    service.init(originalFiles, 'Auto').catch(err => {
      console.error('Spyglass init failed', err)
    })
    return () => {
      service.close().catch(() => {})
    }
  }, [originalFiles])

  // Keep the active file in sync with the Spyglass project.
  useEffect(() => {
    if (!activePath || !serviceRef.current) return
    const content = editedFiles[activePath] ?? originalFiles?.[activePath] ?? ''
    serviceRef.current.openFile(activePath, content).catch(() => {})
  }, [activePath, originalFiles])

  useEffect(() => {
    if (!activePath || !serviceRef.current) return
    const content = editedFiles[activePath] ?? originalFiles?.[activePath] ?? ''
    serviceRef.current.updateFile(activePath, content).catch(() => {})
  }, [activePath, editedFiles, originalFiles])

  // Debounced diagnostics markers for the active file.
  useEffect(() => {
    if (!activePath || !serviceRef.current || !monacoRef.current) return
    const timer = setTimeout(() => {
      const spyglassMarkers = serviceRef.current!.getMarkers(activePath)
      const { MarkerSeverity } = monacoRef.current!
      const markers = spyglassMarkers.map(m => ({
        ...m,
        severity: MarkerSeverity[m.severity.toUpperCase() as keyof typeof MarkerSeverity] ?? MarkerSeverity.Error,
      }))
      const model = monacoRef.current!.editor.getModel(
        monacoRef.current!.Uri.parse(`file:///pack/${activePath}`),
      )
      if (model) {
        monacoRef.current!.editor.setModelMarkers(model, 'spyglass', markers)
      }
    }, 300)
    return () => clearTimeout(timer)
  }, [activePath, editedFiles, originalFiles])

  const beforeMount = useCallback<BeforeMount>((monacoInstance) => {
    // getLanguages() comes back untyped here: @monaco-editor/react derives Monaco
    // from a deep 'monaco-editor/esm/...' path that the package's exports map no
    // longer resolves, so the whole namespace degrades to any. Annotating the
    // callback keeps this callsite honest under noImplicitAny.
    const registered = monacoInstance.languages.getLanguages() as MonacoLanguages.ILanguageExtensionPoint[]
    if (!registered.some(l => l.id === 'mcfunction')) {
      monacoInstance.languages.register({ id: 'mcfunction' })
      monacoInstance.languages.setLanguageConfiguration('mcfunction', {
        comments: { line: '#' },
        brackets: [['(', ')']],
        autoClosingPairs: [{ open: '(', close: ')' }],
        surroundingPairs: [{ open: '(', close: ')' }],
      })
      monacoInstance.languages.setMonarchTokensProvider('mcfunction', {
        tokenizer: {
          root: [
            [/#.*$/, 'comment'],
            [/^\s*\//, 'punctuation'],
            [/^\s*\/([a-zA-Z0-9_-]+)/, ['', 'keyword.control']],
            [/\$\([^)]*\)/, 'variable.parameter'],
            [/"[^"]*"/, 'string'],
            [/-?\d+(?:\.\d+)?/, 'number'],
            [/[a-zA-Z0-9_.:]+/, 'identifier'],
          ],
        },
      })
    }
    if (!spyglassRegisteredRef.current) {
      registerSpyglassMonaco(monacoInstance, () => serviceRef.current)
      spyglassRegisteredRef.current = true
    }
  }, [])

  const handleMount: OnMount = useCallback((editor, monacoInstance) => {
    monacoRef.current = monacoInstance
  }, [])

  const stamp = () => new Date().toLocaleTimeString([], { hour12: false })
  const addLog = useCallback((kind: LogEntry['kind'], message: string) => {
    setLog(prev => [...prev, { time: stamp(), kind, message }])
  }, [])

  const tree = useMemo(
    () => (originalFiles ? buildTree(Object.keys(originalFiles)) : null),
    [originalFiles],
  )

  const activeContent = useMemo(() => {
    if (!activePath) return ''
    if (editedFiles[activePath] !== undefined) return editedFiles[activePath]
    return originalFiles?.[activePath] ?? ''
  }, [activePath, editedFiles, originalFiles])

  const openFile = useCallback((path: string) => {
    setOpenTabs(prev => (prev.includes(path) ? prev : [...prev, path]))
    setActivePath(path)
    addLog('info', `opened ${path}`)
  }, [addLog])

  const closeTab = useCallback((path: string) => {
    setOpenTabs(prev => {
      const next = prev.filter(p => p !== path)
      if (activePath === path) setActivePath(next[next.length - 1] ?? null)
      return next
    })
  }, [activePath])

  const handleEdited = useCallback((path: string, value: string | undefined) => {
    onEditedFilesChange({ ...editedFiles, [path]: value ?? '' })
  }, [editedFiles, onEditedFilesChange])

  const toggleFolder = useCallback((path: string) => {
    setCollapsed(prev => {
      const next = new Set(prev)
      if (next.has(path)) next.delete(path)
      else next.add(path)
      return next
    })
  }, [])

  const handleRun = useCallback(() => {
    addLog('run', 'compatibility check started')
    onRun()
  }, [addLog, onRun])

  const handlePreview = useCallback(() => {
    addLog('run', `generating fix preview${fixTarget ? ' for ' + fixTarget : ''}`)
    onPreview()
  }, [addLog, fixTarget, onPreview])

  const handleDownload = useCallback(() => {
    addLog('success', `downloaded ported pack for ${fixTarget}`)
    onDownload()
  }, [addLog, fixTarget, onDownload])

  const handleLoad = useCallback(async (entries: PackFileMap, name: string) => {
    setOpenTabs([])
    setActivePath(null)
    await onLoad(entries, name)
    addLog('success', `loaded ${name} (${Object.keys(entries).length} files)`)
  }, [addLog, onLoad])

  const handleClear = useCallback(() => {
    setOpenTabs([])
    setActivePath(null)
    onEditedFilesChange({})
    onClear()
    addLog('info', 'pack cleared')
  }, [addLog, onClear, onEditedFilesChange])

  const handlePortTo = useCallback((versionName: string) => {
    setPanel('fix')
    addLog('run', `port to ${versionName} requested`)
    onPortTo(versionName)
  }, [addLog, onPortTo])

  function renderTree(node: TreeNode, depth: number): ReactNode {
    return node.children.map(child => {
      if (child.isDir) {
        const isCollapsed = collapsed.has(child.path)
        return (
          <div key={child.path}>
            <button
              type="button"
              className={`ide-tree-row ide-folder${isCollapsed ? ' collapsed' : ''}`}
              style={{ paddingLeft: depth * 14 + 6 }}
              onClick={() => toggleFolder(child.path)}
            >
              <span className="ide-caret">{isCollapsed ? '▶' : '▼'}</span>
              <span className="ide-folder-icon">📁</span>
              <span className="ide-folder-name">{child.name}</span>
            </button>
            {!isCollapsed && renderTree(child, depth + 1)}
          </div>
        )
      }
      const isActive = activePath === child.path
      const isEdited = editedFiles[child.path] !== undefined
      return (
        <button
          key={child.path}
          type="button"
          className={`ide-tree-row ide-file${isActive ? ' active' : ''}`}
          style={{ paddingLeft: depth * 14 + 24 }}
          onClick={() => openFile(child.path)}
          title={child.path}
        >
          <span className="ide-file-icon">{isEdited ? '●' : '·'}</span>
          <span className="ide-file-name">{child.name}</span>
        </button>
      )
    })
  }

  const hasUnsaved = Object.keys(editedFiles).length > 0

  return (
    <div className="ide">
      <div className="ide-topbar">
        <button type="button" className="ide-back" onClick={onBack} title="Back to the desk">
          ‹ Desk
        </button>
        <span className="ide-crumb">Case 01 — Datapack Editor</span>
        <span className="ide-status">
          {fileName ? `${fileName} — ${fileCount} files` : 'no pack loaded'}
          {hasUnsaved && <span className="ide-unsaved"> · unsaved edits</span>}
        </span>
      </div>

      <div className="ide-main">
        <aside className="ide-explorer">
          <div className="ide-explorer-head">
            <span>Explorer</span>
            {originalFiles && (
              <span className="ide-explorer-count">{fileCount}</span>
            )}
          </div>

          {!originalFiles ? (
            <div className="ide-loader">
              <PackSelector
                files={null}
                fileCount={0}
                fileName=""
                onLoad={handleLoad}
                onClear={handleClear}
              />
            </div>
          ) : (
            <>
              <div className="ide-packmeta">
                <span className="ide-packmeta-name" title={fileName}>{fileName}</span>
                <span className="ide-packmeta-actions">
                  <button type="button" className="btn btn-ghost btn-sm" onClick={handleClear}>✕</button>
                </span>
              </div>
              {tree && (
                <div className="ide-tree">
                  {tree.children.length > 0 ? renderTree(tree, 0) : (
                    <div className="ide-tree-empty">Empty pack</div>
                  )}
                </div>
              )}
            </>
          )}
        </aside>

        <div className="ide-center">
          <div className="ide-tabs">
            {openTabs.length === 0 && <span className="ide-tabs-hint">Select a file in the explorer to open it here</span>}
            {openTabs.map(path => (
              <span
                key={path}
                className={`ide-tab${path === activePath ? ' active' : ''}`}
                role="button"
                tabIndex={0}
                onClick={() => setActivePath(path)}
                onKeyDown={e => { if (e.key === 'Enter') setActivePath(path) }}
              >
                <span className="ide-tab-dot">{editedFiles[path] !== undefined ? '●' : ''}</span>
                <span className="ide-tab-name">{path.split('/').pop()}</span>
                <button
                  type="button"
                  className="ide-tab-close"
                  title="Close tab"
                  onClick={e => { e.stopPropagation(); closeTab(path) }}
                >✕</button>
              </span>
            ))}
          </div>

          <div className="ide-editor">
            {activePath ? (
              <Editor
                key={activePath}
                path={`file:///pack/${activePath}`}
                beforeMount={beforeMount}
                onMount={handleMount}
                language={langFor(activePath)}
                value={activeContent}
                onChange={(value) => handleEdited(activePath, value)}
                theme="vs-dark"
                options={{
                  minimap: { enabled: false },
                  fontSize: 13,
                  tabSize: 4,
                  insertSpaces: true,
                  wordWrap: 'off',
                  renderWhitespace: 'boundary',
                  scrollBeyondLastLine: false,
                  automaticLayout: true,
                  padding: { top: 8, bottom: 8 },
                  'semanticHighlighting.enabled': true,
                }}
              />
            ) : (
              <div className="ide-editor-empty">
                {originalFiles
                  ? 'No file open — pick one from the explorer.'
                  : 'Load a datapack or resource pack to start editing.'}
              </div>
            )}
          </div>

          <div className="ide-bottom">
            <div className="ide-panel-tabs" role="tablist" aria-label="IDE panels">
              <button
                className={`ide-panel-tab${panel === 'analysis' ? ' active' : ''}`}
                role="tab"
                aria-selected={panel === 'analysis'}
                onClick={() => setPanel('analysis')}
              >Analysis</button>
              <button
                className={`ide-panel-tab${panel === 'fix' ? ' active' : ''}`}
                role="tab"
                aria-selected={panel === 'fix'}
                onClick={() => setPanel('fix')}
              >Fix</button>
              <button
                className={`ide-panel-tab${panel === 'output' ? ' active' : ''}`}
                role="tab"
                aria-selected={panel === 'output'}
                onClick={() => setPanel('output')}
              >
                Output
                {log.length > 0 && <span className="ide-panel-count">{log.length}</span>}
              </button>
            </div>

            <div className="ide-panel-body">
              {panel === 'analysis' && (
                <div className="ide-panel-scroll">
                  <div className="ide-runbar">
                    <span>
                      {progress && <><span className="spinner" /> {progress}</>}
                      {!progress && !loading && (originalFiles ? <span className="kbd">Ctrl</span> : 'upload a pack first')}
                    </span>
                    <button className="btn btn-primary" onClick={handleRun} disabled={loading || !originalFiles} aria-busy={loading}>
                      {loading ? <><span className="spinner" /> Running…</> : '▶ Run Check'}
                    </button>
                  </div>
                  {error && (
                    <div className="error">
                      <span>!</span>
                      <span>{error}</span>
                    </div>
                  )}
                  {loading && !result && !error && (
                    <div className="ide-loading">
                      {progress || 'Checking…'}
                    </div>
                  )}
                  {result && (
                    <Results result={result.result} mode={result.mode} duration={checkDuration} onPortTo={handlePortTo} />
                  )}
                  {!result && !loading && originalFiles && (
                    <div className="ide-analysis-empty">
                      <p>No check run yet for this pack.</p>
                      <p className="ide-analysis-sub">Set the options below, then run a check to see version-by-version findings.</p>
                      <CheckPanel
                        mode={mode}
                        onModeChange={onModeChange}
                        all={all}
                        onAllChange={onAllChange}
                        strict={strict}
                        onStrictChange={onStrictChange}
                        versions={versions}
                        versionsLoading={versionsLoading}
                        selectedVersions={selectedVersions}
                        onSelectedVersionsChange={onSelectedVersionsChange}
                        onRun={handleRun}
                        loading={loading}
                        hasFiles={!!originalFiles}
                      />
                    </div>
                  )}
                  {!result && !loading && !originalFiles && (
                    <div className="ide-analysis-empty">
                      <p>Load a pack to use the Analysis panel.</p>
                    </div>
                  )}
                </div>
              )}

              {panel === 'fix' && (
                <div className="ide-panel-scroll">
                  <FixPanel
                    versions={versions}
                    fixTarget={fixTarget}
                    onFixTargetChange={onFixTargetChange}
                    fixSource={fixSource}
                    onFixSourceChange={onFixSourceChange}
                    fixPreview={fixPreview}
                    onPreview={handlePreview}
                    onDownload={handleDownload}
                    loading={loading}
                    hasFiles={!!originalFiles}
                    originalFiles={originalFiles}
                  />
                </div>
              )}

              {panel === 'output' && (
                <div className="ide-output">
                  {log.length === 0 ? (
                    <div className="ide-output-empty">No events yet — open a file, run a check, or generate a fix.</div>
                  ) : (
                    log.map((entry, i) => (
                      <div key={i} className={`ide-output-line ${entry.kind}`}>
                        <span className="ide-output-time">{entry.time}</span>
                        <span className="ide-output-kind">{entry.kind}</span>
                        <span className="ide-output-msg">{entry.message}</span>
                      </div>
                    ))
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}