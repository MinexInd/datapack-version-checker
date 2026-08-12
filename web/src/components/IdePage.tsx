import { useMemo, useState, useCallback, useEffect, useRef, type ReactNode } from 'react'
import Editor, { type BeforeMount, type OnMount } from '@monaco-editor/react'
import type { languages as MonacoLanguages } from 'monaco-editor'
import PackSelector from './PackSelector'
import CheckPanel from './CheckPanel'
import FixPanel from './FixPanel'
import Results from './Results'
import type { PackFileMap, Mode, McmetaVersion, CheckResponse, FixPreview } from '../api'
import { SpyglassService, type IdeMarker } from '../engine/spyglass-service'
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
  if (ext === 'nbt' || ext === 'snbt') return 'snbt'
  if (ext === 'md') return 'markdown'
  return 'plaintext'
}

function pathFromUri(uri: { path: string }): string {
  const raw = uri.path
  return raw.startsWith('/pack/') ? raw.slice('/pack/'.length) : raw
}

// Monaco 0.56 dropped editor.getTheme() from the standalone API, so the
// readonly flag below replaces that guard (defineTheme itself is idempotent).
let minexDarkDefined = false

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
  const [panel, setPanel] = useState<'analysis' | 'fix' | 'problems' | 'output'>('analysis')
  const [log, setLog] = useState<LogEntry[]>([])
  // Bottom panel: height in px once the user drags the divider (null = the
  // CSS default of 22%), plus a collapsed state that hides the body.
  const [panelHeight, setPanelHeight] = useState<number | null>(null)
  const [panelCollapsed, setPanelCollapsed] = useState(false)
  // Slim status bar: cursor position follows the editor.
  const [cursor, setCursor] = useState({ lineNumber: 1, column: 1 })

  const serviceRef = useRef<SpyglassService | null>(null)
  const monacoRef = useRef<typeof import('monaco-editor') | null>(null)
  const editorRef = useRef<Parameters<OnMount>[0] | null>(null)
  const spyglassRegisteredRef = useRef(false)
  const [spyglassStatus, setSpyglassStatus] = useState<'idle' | 'loading' | 'ready' | 'failed'>('idle')
  const spyglassReady = spyglassStatus === 'ready'

  // 1.6 — MC version selector state
  const [selectedGameVersion, setSelectedGameVersion] = useState('Auto')
  const [versionWarning, setVersionWarning] = useState<string | null>(null)

  // 1.7 — Analyze-all mode: when true, the Problems panel shows whole-pack
  // markers from analyzeAll rather than per-open-tab markers.
  const [analyzeAllMode, setAnalyzeAllMode] = useState(false)

  // 1.8 — Bump to force the init effect to re-run (reload button).
  const [reloadKey, setReloadKey] = useState(0)

  // Jump target from the Problems panel: reveal a position in the editor.
  const [jump, setJump] = useState<{ path: string; lineNumber: number; column: number } | null>(null)

  const stamp = () => new Date().toLocaleTimeString([], { hour12: false })
  const addLog = useCallback((kind: LogEntry['kind'], message: string) => {
    setLog(prev => [...prev, { time: stamp(), kind, message }].slice(-400))
  }, [])

  // Spyglass service lifecycle: (re)create when a pack is loaded or the
  // game version / reload key changes.
  useEffect(() => {
    if (!originalFiles) {
      serviceRef.current?.close().catch(() => {})
      serviceRef.current = null
      setSpyglassStatus('idle')
      return
    }
    const service = new SpyglassService(undefined, (level, message) => {
      addLog(level === 'error' ? 'error' : 'info', `[spyglass] ${message}`)
    })
    serviceRef.current = service
    setSpyglassStatus('loading')
    setVersionWarning(null)
    addLog('info', `Spyglass initializing (MC ${selectedGameVersion}, vanilla data may download on first load)…`)
    service.init(originalFiles, selectedGameVersion)
      .then(() => {
        setSpyglassStatus('ready')
        addLog('success', `Spyglass ready (MC ${selectedGameVersion})`)
      })
      .catch(err => {
        console.error('Spyglass init failed', err)
        setSpyglassStatus('failed')
        if (selectedGameVersion !== 'Auto') {
          setVersionWarning(`Version "${selectedGameVersion}" failed — reverting to Auto`)
          setSelectedGameVersion('Auto')
        } else {
          addLog('error', `Spyglass init failed: ${err instanceof Error ? err.message : String(err)}`)
        }
      })
    return () => {
      service.close().catch(() => {})
    }
  }, [originalFiles, selectedGameVersion, reloadKey, addLog])

  // Open the active file once Spyglass is ready (and on every tab switch).
  useEffect(() => {
    if (!spyglassReady || !activePath || !serviceRef.current) return
    const content = editedFiles[activePath] ?? originalFiles?.[activePath] ?? ''
    serviceRef.current.openFile(activePath, content).catch(() => {})
  }, [spyglassReady, activePath, originalFiles])

  // Keep Spyglass content in sync on every edit (debounced to avoid
  // re-parsing on every keystroke — collapses rapid typing into a single
  // parse 100ms after the last edit).
  useEffect(() => {
    if (!spyglassReady || !activePath || !serviceRef.current) return
    const content = editedFiles[activePath] ?? originalFiles?.[activePath] ?? ''
    const timer = setTimeout(() => {
      serviceRef.current?.updateFile(activePath, content).catch(() => {})
    }, 100)
    return () => clearTimeout(timer)
  }, [spyglassReady, activePath, editedFiles, originalFiles])

  // Debounced diagnostics markers for the active file.
  useEffect(() => {
    if (!spyglassReady || !activePath || !serviceRef.current || !monacoRef.current) return
    const timer = setTimeout(async () => {
      const spyglassMarkers = await serviceRef.current!.getMarkers(activePath)
      if (!monacoRef.current) return
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
  }, [spyglassReady, activePath, editedFiles, originalFiles])

  // Problems panel: markers for every open tab, like the VSCode Problems view.
  // In analyzeAllMode the problems come from the whole-pack sweep instead.
  const [problems, setProblems] = useState<{ path: string; marker: IdeMarker }[]>([])
  const [problemFilter, setProblemFilter] = useState('')
  // Collapsed file headers in the grouped problems list.
  const [problemsCollapsed, setProblemsCollapsed] = useState<Set<string>>(new Set())
  useEffect(() => {
    // In analyzeAllMode the problems are set explicitly by the Analyze
    // button handler — don't overwrite them with per-tab markers.
    if (analyzeAllMode) return
    if (!spyglassReady || !serviceRef.current) {
      setProblems([])
      return
    }
    const paths = [...new Set([...(openTabs ?? []), ...(activePath ? [activePath] : [])])]
    if (paths.length === 0) {
      setProblems([])
      return
    }
    let cancelled = false
    const timer = setTimeout(async () => {
      const all: typeof problems = []
      for (const path of paths) {
        const markers = await serviceRef.current!.getMarkers(path)
        if (cancelled) return
        for (const marker of markers) all.push({ path, marker })
      }
      if (!cancelled) setProblems(all)
    }, 400)
    return () => { cancelled = true; clearTimeout(timer) }
  }, [spyglassReady, openTabs, activePath, editedFiles, originalFiles, analyzeAllMode])

  // Group problems by file, VS Code style: each file gets a collapsible
  // header (name + dir + count) with its markers indented beneath.
  const problemGroups = useMemo(() => {
    const byPath = new Map<string, { path: string; markers: IdeMarker[] }>()
    for (const { path, marker } of problems) {
      const g = byPath.get(path)
      if (g) g.markers.push(marker)
      else byPath.set(path, { path, markers: [marker] })
    }
    const q = problemFilter.trim().toLowerCase()
    const groups = [...byPath.values()]
      .map(g => ({
        ...g,
        markers: q
          ? g.markers.filter(m =>
              m.message.toLowerCase().includes(q) ||
              g.path.toLowerCase().includes(q))
          : g.markers,
      }))
      .filter(g => g.markers.length > 0)
      .sort((a, b) => a.path.localeCompare(b.path))
    return groups
  }, [problems, problemFilter])

  const beforeMount = useCallback<BeforeMount>((monacoInstance) => {
    // getLanguages() comes back untyped here: @monaco-editor/react derives Monaco
    // from a deep 'monaco-editor/esm/...' path that the package's exports map no
    // longer resolves, so the whole namespace degrades to any. Annotating the
    // callback keeps this callsite honest under noImplicitAny.
    const registered = monacoInstance.languages.getLanguages() as MonacoLanguages.ILanguageExtensionPoint[]
    if (!minexDarkDefined) {
      // Spyglass semantic tokens in VS Code Dark+ palette: purple keywords,
      // orange strings, light-blue variables/properties, green numbers.
      // The legend types come from @spyglassmc/core ColorTokenTypes; every
      // type gets a rule so nothing falls back to the washed-out default.
      monacoInstance.editor.defineTheme('minex-dark', {
        base: 'vs-dark',
        inherit: true,
        semanticHighlighting: true,
        // colors is REQUIRED in Monaco >= 0.5x: the tokenTheme getter reads
        // themeData.colors['editor.foreground'] unguarded, so omitting the
        // map crashes setTheme with "colors is undefined".
        colors: {
          'editor.background': '#0e131b',
          'editor.foreground': '#e6ebf2',
        },
        rules: [
          { token: 'comment', foreground: '6a9955', fontStyle: 'italic' },
          { token: 'keyword', foreground: 'c586c0' },
          { token: 'modifier', foreground: 'c586c0' },
          { token: 'function', foreground: 'dcdcaa' },
          { token: 'type', foreground: '4ec9b0' },
          { token: 'struct', foreground: '4ec9b0' },
          { token: 'enum', foreground: 'b8d7a3' },
          { token: 'enumMember', foreground: 'b8d7a3' },
          { token: 'number', foreground: 'b5cea8' },
          { token: 'literal', foreground: 'b5cea8' },
          { token: 'vector', foreground: 'b5cea8' },
          { token: 'string', foreground: 'ce9178' },
          { token: 'escape', foreground: 'd7ba7d' },
          { token: 'property', foreground: '9cdcfe' },
          { token: 'variable', foreground: '9cdcfe' },
          { token: 'resourceLocation', foreground: '9cdcfe' },
          { token: 'operator', foreground: 'd4d4d4' },
          { token: 'error', foreground: 'f48771' },
        ],
      })
      minexDarkDefined = true
    }
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
    if (!registered.some(l => l.id === 'snbt')) {
      monacoInstance.languages.register({ id: 'snbt' })
      monacoInstance.languages.setMonarchTokensProvider('snbt', {
        tokenizer: {
          root: [
            [/#.*$/, 'comment'],
            [/[{}[\]]/, 'delimiter.bracket'],
            [/"[^"]*"/, 'string'],
            [/-?\d+(?:\.\d+)?[bBfFdDlLsS]?/, 'number'],
            [/true|false/, 'keyword'],
            [/[a-zA-Z0-9_:.-]+/, 'identifier'],
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
    editorRef.current = editor
    // Status bar line/col follows the cursor.
    editor.onDidChangeCursorPosition(e => {
      setCursor({ lineNumber: e.position.lineNumber, column: e.position.column })
    })
    setCursor({ lineNumber: editor.getPosition()?.lineNumber ?? 1, column: editor.getPosition()?.column ?? 1 })
  }, [])

  // Drag the divider above the bottom panel to resize it. The panel lives in
  // a column that ends at the viewport bottom, so the height is the distance
  // from the pointer up to the top of the panel (inverse of clientY relative
  // to the container). Clamp to keep both the editor and the panel usable.
  const panelRef = useRef<HTMLDivElement | null>(null)
  const startResize = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault()
    const panelEl = panelRef.current
    if (!panelEl) return
    const startY = e.clientY
    const startH = panelEl.getBoundingClientRect().height
    const onMove = (ev: PointerEvent) => {
      const h = Math.min(Math.max(startH + (startY - ev.clientY), 90), window.innerHeight - 160)
      setPanelHeight(h)
      setPanelCollapsed(false)
    }
    const onUp = () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }, [])

  // When a Problems-panel entry is clicked, open the file and reveal the
  // line once the editor is showing it. cursor is included because the
  // Monaco onMount callback sets it — this retries the jump after a
  // cross-file switch where the editor hasn't mounted yet on first pass.
  useEffect(() => {
    if (!jump) return
    const editor = editorRef.current
    const model = editor?.getModel()
    const modelPath = model ? pathFromUri(model.uri) : null
    if (modelPath === jump.path && editor) {
      editor.setPosition({ lineNumber: jump.lineNumber, column: jump.column })
      editor.revealLineInCenter(jump.lineNumber)
      editor.focus()
      setJump(null)
    }
  }, [jump, activePath, cursor])

  const handleJump = useCallback((path: string, lineNumber: number, column: number) => {
    setOpenTabs(prev => (prev.includes(path) ? prev : [...prev, path]))
    setActivePath(path)
    setJump({ path, lineNumber, column })
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

  // --- 1.6 MC version selector -------------------------------------------
  const sortedVersions = useMemo(() => {
    return [...versions].sort((a, b) => b.data_version - a.data_version)
  }, [versions])

  const handleVersionChange = useCallback((newVersion: string) => {
    if (newVersion === selectedGameVersion) return
    setAnalyzeAllMode(false)
    setProblems([])
    setSelectedGameVersion(newVersion)
  }, [selectedGameVersion])

  // --- 1.7 Analyze Datapack ----------------------------------------------
  const mergedFiles = useMemo<PackFileMap | null>(() => {
    if (!originalFiles) return null
    if (Object.keys(editedFiles).length === 0) return originalFiles
    return { ...originalFiles, ...editedFiles }
  }, [originalFiles, editedFiles])

  const handleAnalyzeAll = useCallback(async () => {
    if (!serviceRef.current || !mergedFiles) return
    setPanel('problems')
    setAnalyzeAllMode(true)
    addLog('run', 'analyzing full datapack…')
    try {
      const results = await serviceRef.current.analyzeAll(mergedFiles)
      setProblems(results)
      addLog('success', `analyze complete — ${results.length} problem${results.length !== 1 ? 's' : ''}`)
    } catch (err) {
      addLog('error', `analyze failed: ${err instanceof Error ? err.message : String(err)}`)
      setAnalyzeAllMode(false)
    }
  }, [mergedFiles, addLog])

  // --- 1.8 Reset / Reload ------------------------------------------------
  const handleReset = useCallback(() => {
    if (!window.confirm('Discard all edits and reset to original files?')) return
    setOpenTabs([])
    setActivePath(null)
    onEditedFilesChange({})
    setAnalyzeAllMode(false)
    setProblems([])
    setJump(null)
    addLog('info', 'edits discarded — reset to original files')
  }, [addLog, onEditedFilesChange])

  const handleReload = useCallback(() => {
    setAnalyzeAllMode(false)
    setProblems([])
    setLog([])
    setJump(null)
    setReloadKey(k => k + 1)
    addLog('info', 'reloading Spyglass…')
  }, [addLog])

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

        {/* 1.6 — Version selector */}
        <label className="ide-version-label" title="Spyglass game version">
          <span className="ide-version-text">Version</span>
          <select
            className="ide-version-select"
            value={selectedGameVersion}
            onChange={e => handleVersionChange(e.target.value)}
          >
            <option value="Auto">Auto</option>
            {sortedVersions.map(v => (
              <option key={v.id} value={v.name}>
                {v.name}{v.type === 'snapshot' ? ' (snap)' : ''}
              </option>
            ))}
          </select>
        </label>

        {/* 1.6 — Version warning (inline, only when present) */}
        {versionWarning && (
          <span className="ide-version-warning" title={versionWarning}>⚠ {versionWarning}</span>
        )}

        {/* 1.7 — Analyze button */}
        <button
          type="button"
          className="ide-topbar-btn"
          onClick={handleAnalyzeAll}
          disabled={!spyglassReady || !originalFiles}
          title="Analyze all pack files (Ctrl+Shift+A)"
        >Analyze</button>

        {/* 1.8 — Reset + Reload */}
        <button
          type="button"
          className="ide-topbar-btn"
          onClick={handleReset}
          disabled={!originalFiles}
          title="Discard edits and revert to original files"
        >Reset</button>
        <button
          type="button"
          className="ide-topbar-btn"
          onClick={handleReload}
          disabled={!originalFiles}
          title="Reload Spyglass from scratch"
        >Reload</button>

        <span className="ide-status">
          {fileName ? `${fileName} — ${fileCount} files` : 'no pack loaded'}
          {hasUnsaved && <span className="ide-unsaved"> · unsaved edits</span>}
          <span className={`ide-spyglass-status ${spyglassStatus}`} title="Spyglass language service">
            {spyglassStatus === 'ready' ? 'Spyglass ✓' : spyglassStatus === 'loading' ? 'Spyglass…' : spyglassStatus === 'failed' ? 'Spyglass ✗' : ''}
          </span>
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
                key={`${activePath}::${spyglassReady ? 'ready' : 'init'}`}
                path={`file:///pack/${activePath}`}
                beforeMount={beforeMount}
                onMount={handleMount}
                language={langFor(activePath)}
                value={activeContent}
                onChange={(value) => handleEdited(activePath, value)}
                theme="minex-dark"
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

          <div
            className="ide-panel-resize"
            role="separator"
            aria-orientation="horizontal"
            aria-label="Resize panel"
            onPointerDown={startResize}
          />

          <div
            className={`ide-bottom${panelCollapsed ? ' collapsed' : ''}`}
            ref={panelRef}
            style={panelHeight != null ? { flexBasis: `${panelHeight}px` } : undefined}
          >
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
                className={`ide-panel-tab${panel === 'problems' ? ' active' : ''}`}
                role="tab"
                aria-selected={panel === 'problems'}
                onClick={() => setPanel('problems')}
              >
                Problems
                {problems.length > 0 && <span className="ide-panel-count">{problems.length}</span>}
              </button>
              <button
                className={`ide-panel-tab${panel === 'output' ? ' active' : ''}`}
                role="tab"
                aria-selected={panel === 'output'}
                onClick={() => setPanel('output')}
              >
                Output
                {log.length > 0 && <span className="ide-panel-count">{log.length}</span>}
              </button>
              {panel === 'problems' && (
                <input
                  className="ide-problem-filter"
                  type="search"
                  placeholder="Filter (message or path)"
                  aria-label="Filter problems"
                  value={problemFilter}
                  onChange={e => setProblemFilter(e.target.value)}
                  spellCheck={false}
                />
              )}
              <button
                type="button"
                className="ide-panel-collapse"
                title={panelCollapsed ? 'Expand panel' : 'Collapse panel'}
                onClick={() => setPanelCollapsed(v => !v)}
              >
                {panelCollapsed ? '▲' : '▼'}
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

              {panel === 'problems' && (
                <div className="ide-panel-scroll">
                  {problemGroups.length === 0 ? (
                    <div className="ide-output-empty">
                      {analyzeAllMode
                        ? 'No problems found across the entire datapack.'
                        : problemFilter
                          ? 'No problems match the filter.'
                          : 'No problems detected in open files.'}
                      {!spyglassReady && ' Spyglass is still initializing…'}
                    </div>
                  ) : (
                    <div className="ide-problems">
                      {problemGroups.map(group => {
                        const isGroupCollapsed = problemsCollapsed.has(group.path)
                        const dir = group.path.includes('/')
                          ? group.path.slice(0, group.path.lastIndexOf('/'))
                          : ''
                        return (
                          <div key={group.path} className="ide-problem-group">
                            <button
                              type="button"
                              className="ide-problem-file"
                              onClick={() => setProblemsCollapsed(prev => {
                                const next = new Set(prev)
                                if (next.has(group.path)) next.delete(group.path)
                                else next.add(group.path)
                                return next
                              })}
                            >
                              <span className="ide-problem-caret">{isGroupCollapsed ? '▸' : '▾'}</span>
                              <span className="ide-problem-file-icon" aria-hidden>📄</span>
                              <span className="ide-problem-file-name" title={group.path}>
                                {group.path.split('/').pop()}
                              </span>
                              {dir && <span className="ide-problem-file-dir">{dir}</span>}
                              <span className="ide-problem-file-count">{group.markers.length}</span>
                            </button>
                            {!isGroupCollapsed && group.markers.map((marker, i) => (
                              <button
                                key={`${group.path}:${i}`}
                                type="button"
                                className="ide-problem"
                                onClick={() => handleJump(group.path, marker.startLineNumber, marker.startColumn)}
                                title={`${marker.severity}: ${marker.message}`}
                              >
                                <span className={`ide-problem-icon sev-${marker.severity}`}>
                                  {marker.severity === 'error' ? '✕' : marker.severity === 'warning' ? '⚠' : marker.severity === 'info' ? 'ℹ' : '·'}
                                </span>
                                <span className="ide-problem-msg">{marker.message}</span>
                                <span className="ide-problem-source">spyglassmc</span>
                                <span className="ide-problem-loc">[Ln {marker.startLineNumber}, Col {marker.startColumn}]</span>
                              </button>
                            ))}
                          </div>
                        )
                      })}
                    </div>
                  )}
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

          <div className="ide-statusbar">
            <span className="ide-statusbar-item">
              <span className={`ide-statusbar-spyglass ${spyglassStatus}`}>
                {spyglassStatus === 'ready' ? 'Spyglass ✓' : spyglassStatus === 'loading' ? 'Spyglass…' : spyglassStatus === 'failed' ? 'Spyglass ✗' : 'Spyglass'}
              </span>
            </span>
            <span className="ide-statusbar-item ide-statusbar-version" title="Target Minecraft version">
              MC {selectedGameVersion === 'Auto' ? 'Auto' : selectedGameVersion}
            </span>
            <span className="ide-statusbar-item ide-statusbar-file" title={activePath ?? undefined}>
              {activePath ? activePath.split('/').pop() : 'no file open'}
            </span>
            <span className="ide-statusbar-spacer" />
            {activePath && (
              <span className="ide-statusbar-item">{langFor(activePath)}</span>
            )}
            <span className="ide-statusbar-item">Ln {cursor.lineNumber}, Col {cursor.column}</span>
          </div>
        </div>
      </div>
    </div>
  )
}