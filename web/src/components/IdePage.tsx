import { useMemo, useState, useCallback, useEffect, useRef, type ReactNode } from 'react'
import Editor, { type BeforeMount, type OnMount } from '@monaco-editor/react'
import type { languages as MonacoLanguages } from 'monaco-editor'
import PackSelector from './PackSelector'
import CheckPanel from './CheckPanel'
import Results from './Results'
import McmetaEditor from './editors/McmetaEditor'
import McdocEditor from './editors/McdocEditor'
import type { PackFileMap, Mode, McmetaVersion, CheckResponse, FixPreview } from '../api'
import { toFixPreviewV2, type FixPreviewV2, type FixFileChange } from '../../../src/fix-preview'
import { applyFixPreview } from '../../../src/fix-apply'
import { computeLineDiff } from '../ide/fix-diff'
import { fetchRecipeIds, fetchRecipePreset } from '../ide/presets'
import type { JsonValue, SimplifiedMcdocType } from '../ide/mcdoc-edit'
import { exportZip } from '../api'
import { SpyglassService, type IdeMarker } from '../engine/spyglass-service'
import { registerSpyglassMonaco } from '../ide/monaco-spyglass'
import { readDroppedFiles } from '../ide/pack-io'
import { buildWorkspaceFiles, computeContentHash } from '../workspace'
import { validatePackMetadata } from '../ide/metadata-validation'
import {
  createIdbDraftStore,
  createMemoryDraftStore,
  DRAFT_DB,
  DRAFT_SCHEMA_VERSION,
  type DraftSnapshot,
  type DraftStoreLike,
} from '../ide/idb-draft'
import { findReferencesTo, isPathTraversal, validateFileName } from '../ide/file-lifecycle'

interface Props {
  originalFiles: PackFileMap | null
  editedFiles: PackFileMap
  onEditedFilesChange: (files: PackFileMap) => void
  deletedFiles: Set<string>
  onDeletedFilesChange: (next: Set<string>) => void
  revision: number
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
  resultStale: boolean
  checkDuration: number
  onRun: () => void
  onPortTo: (versionName: string) => void
  fixTarget: string
  onFixTargetChange: (v: string) => void
  fixSource: string
  onFixSourceChange: (v: string) => void
  fixPreview: FixPreview | null
  previewStale: boolean
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

// Recipe files live at data/<namespace>/recipe/<name>.json. Real packs nest
// arbitrarily deep under the category (data/x/recipe/blocks/bulk/...), and the
// engine's fileKindFromPath only recognizes the `minecraft` namespace, so we
// use a broader gate here: any namespace, any depth under recipe/.
function isRecipePath(path: string): boolean {
  return /^data\/[^/]+\/recipe\/.+\.json$/.test(path)
}

// Monaco 0.56 dropped editor.getTheme() from the standalone API, so the
// readonly flag below replaces that guard (defineTheme itself is idempotent).
let minexDarkDefined = false

function FixFileDiffCard({
  change,
  isExpanded,
  onToggle,
}: {
  change: FixFileChange
  isExpanded: boolean
  onToggle: () => void
}) {
  const diff = useMemo(
    () => computeLineDiff(change.before, change.after),
    [change.before, change.after]
  )

  const gutterWidth = Math.max(String(diff.rows.length).length, 2)

  return (
    <div className={`fix-file${isExpanded ? ' expanded' : ''}`}>
      <div
        className="fix-file-header clickable"
        role="button"
        tabIndex={0}
        aria-expanded={isExpanded}
        onClick={onToggle}
        onKeyDown={e => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            onToggle()
          }
        }}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
          flexWrap: 'wrap',
          cursor: 'pointer',
          padding: '6px 10px',
        }}
      >
        <span className="fix-file-icon" style={{ fontSize: '0.75rem' }}>{isExpanded ? '▼' : '▶'}</span>
        <span className="fix-file-path" style={{ fontWeight: 600, fontFamily: 'monospace', fontSize: '0.85rem' }}>{change.file}</span>
        <span
          className={`fix-confidence-badge conf-${change.confidence}`}
          style={{
            fontSize: '0.68rem',
            padding: '2px 7px',
            borderRadius: '4px',
            textTransform: 'uppercase',
            fontWeight: 700,
            letterSpacing: '0.04em',
            background:
              change.confidence === 'high'
                ? 'rgba(34, 197, 94, 0.16)'
                : change.confidence === 'low'
                ? 'rgba(239, 68, 68, 0.16)'
                : 'rgba(59, 130, 246, 0.16)',
            color:
              change.confidence === 'high'
                ? '#22c55e'
                : change.confidence === 'low'
                ? '#ef4444'
                : '#3b82f6',
            border: `1px solid ${
              change.confidence === 'high'
                ? 'rgba(34, 197, 94, 0.35)'
                : change.confidence === 'low'
                ? 'rgba(239, 68, 68, 0.35)'
                : 'rgba(59, 130, 246, 0.35)'
            }`,
          }}
        >
          {change.confidence} confidence
        </span>
        {change.reason && (
          <span
            className="fix-reason-text"
            style={{
              fontSize: '0.75rem',
              color: 'var(--ink-dim, #94a3b8)',
              marginLeft: 'auto',
              maxWidth: '380px',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
            title={change.reason}
          >
            {change.reason}
          </span>
        )}
        {!change.skipped && (
          <span className="diff-stat" style={{ fontSize: '0.72rem', fontFamily: 'monospace', marginLeft: change.reason ? undefined : 'auto' }}>
            <span className="add" style={{ color: '#22c55e', fontWeight: 600 }}>+{diff.additions}</span>
            <span className="sep" style={{ margin: '0 2px', opacity: 0.4 }}>/</span>
            <span className="del" style={{ color: '#ef4444', fontWeight: 600 }}>−{diff.deletions}</span>
          </span>
        )}
        {change.skipped && (
          <span style={{ fontSize: '0.72rem', color: '#f59e0b', fontWeight: 600, marginLeft: change.reason ? undefined : 'auto' }}>
            Skipped
          </span>
        )}
      </div>

      {isExpanded && (
        <div className="fix-diff-area" style={{ marginTop: '4px', padding: '0 4px 6px' }}>
          {change.skipped ? (
            <div
              className="fix-skipped-banner"
              style={{
                padding: '8px 12px',
                background: 'rgba(245, 158, 11, 0.1)',
                color: '#f59e0b',
                borderRadius: '4px',
                fontSize: '0.8rem',
                border: '1px solid rgba(245, 158, 11, 0.25)',
              }}
            >
              ⚠️ Skipped: {change.skipReason || 'Registry or format not supported in target version.'}
            </div>
          ) : diff.rows.length === 0 ? (
            <div className="diff-empty" style={{ padding: '8px 12px', fontSize: '0.8rem', color: 'var(--ink-dim, #94a3b8)' }}>
              No line content differences.
            </div>
          ) : (
            <div className="diff-panel" style={{ borderRadius: '4px', overflow: 'hidden', border: '1px solid var(--hairline-soft, #1e293b)' }}>
              <div
                className="diff-view"
                style={{
                  maxHeight: '280px',
                  overflowY: 'auto',
                  overflowX: 'auto',
                  fontFamily: 'Consolas, Monaco, monospace',
                  fontSize: '12px',
                  background: 'var(--bg-inset, #0b0f17)',
                  padding: '4px 0',
                }}
              >
                {diff.rows.map((row, idx) => {
                  const lineNum = row.kind === 'added' ? row.outLine : row.srcLine
                  const numStr = lineNum != null ? String(lineNum).padStart(gutterWidth, ' ') : ' '.repeat(gutterWidth)
                  const op = row.kind === 'added' ? '+' : row.kind === 'removed' ? '-' : ' '
                  const bg =
                    row.kind === 'added'
                      ? 'rgba(34, 197, 94, 0.15)'
                      : row.kind === 'removed'
                      ? 'rgba(239, 68, 68, 0.15)'
                      : 'transparent'
                  const color =
                    row.kind === 'added'
                      ? '#4ade80'
                      : row.kind === 'removed'
                      ? '#f87171'
                      : 'inherit'

                  if (row.kind === 'gap') {
                    return (
                      <div
                        key={idx}
                        className="diff-line gap"
                        style={{
                          opacity: 0.6,
                          padding: '2px 8px',
                          fontStyle: 'italic',
                          background: 'rgba(255, 255, 255, 0.02)',
                        }}
                      >
                        <span className="diff-text">{row.text}</span>
                      </div>
                    )
                  }

                  return (
                    <div
                      key={idx}
                      className={`diff-line ${row.kind}`}
                      style={{
                        display: 'flex',
                        background: bg,
                        color,
                        padding: '1px 8px',
                        lineHeight: '1.45',
                        whiteSpace: 'pre-wrap',
                        wordBreak: 'break-all',
                      }}
                    >
                      <span
                        className="diff-ln"
                        style={{
                          opacity: 0.45,
                          userSelect: 'none',
                          marginRight: '8px',
                          minWidth: `${gutterWidth}ch`,
                          textAlign: 'right',
                          flexShrink: 0,
                        }}
                      >
                        {numStr}
                      </span>
                      <span
                        className="diff-op"
                        style={{
                          userSelect: 'none',
                          marginRight: '8px',
                          fontWeight: 'bold',
                          flexShrink: 0,
                        }}
                      >
                        {op}
                      </span>
                      <span className="diff-text" style={{ flex: 1 }}>
                        {row.text}
                      </span>
                    </div>
                  )
                })}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export default function IdePage({
  originalFiles,
  editedFiles,
  onEditedFilesChange,
  deletedFiles,
  onDeletedFilesChange,
  revision,
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
  result, resultStale, checkDuration,
  onRun, onPortTo,
  fixTarget, onFixTargetChange,
  fixSource, onFixSourceChange,
  fixPreview, previewStale, onPreview, onDownload,
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

  // 1.2 — File operations: create/rename/delete
  // deletedFiles is now a prop owned by App so check/fix/analyze/export all
  // share the same buildWorkspaceFiles derivation. Local refs mirror the live
  // workspace so draft persistence and restore run against current values.
  const originalFilesRef = useRef(originalFiles)
  originalFilesRef.current = originalFiles
  const editedFilesRef = useRef(editedFiles)
  editedFilesRef.current = editedFiles
  const deletedFilesRef = useRef(deletedFiles)
  deletedFilesRef.current = deletedFiles

  // Draft persistence (Milestone 1): a stored draft can be restored after a
  // reload, but only after confirmation when the source pack changed shape.
  const draftStoreRef = useRef<DraftStoreLike | null>(null)
  const draftPromptedRef = useRef<string | null>(null)
  const [draftRestore, setDraftRestore] = useState<DraftSnapshot | null>(null)
  const [renamingPath, setRenamingPath] = useState<string | null>(null)
  const [newFileTarget, setNewFileTarget] = useState<string | null>(null) // null = root; string = folder path
  const [newFileName, setNewFileName] = useState('')
  const newFileInputRef = useRef<HTMLInputElement | null>(null)
  const renameInputRef = useRef<HTMLInputElement | null>(null)
  const [pendingDelete, setPendingDelete] = useState<string | null>(null)
  const [renameError, setRenameError] = useState<string | null>(null)

  // 2b.5 — Drag-to-move state
  const [dragPath, setDragPath] = useState<string | null>(null)
  const [dropFolderPath, setDropFolderPath] = useState<string | null>(null)

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

  // 3.5 — pack.mcmeta GUI: toggles the root pack.mcmeta between the form and
  // the raw Monaco JSON view. Lifted here so Monaco's existing wiring (the
  // <Editor> below) is never duplicated or remounted unexpectedly.
  const [mcmetaView, setMcmetaView] = useState<'form' | 'json'>('form')

  // 3.1 — Recipe GUI: same form/json toggle pattern as pack.mcmeta, but for
  // data/<ns>/recipe/*.json. The resolved mcdoc type is async (Spyglass needs
  // to settle), so we track it plus a resolving/ready flag. While resolving we
  // pass null to McdocEditor, which shows its own "Resolving type…" state; if
  // the type comes back null we fall back to Monaco instead of the form.
  const [recipeView, setRecipeView] = useState<'form' | 'json'>('form')
  const [recipeType, setRecipeType] = useState<SimplifiedMcdocType | null>(null)
  const [recipeTypeState, setRecipeTypeState] = useState<'idle' | 'resolving' | 'ready'>('idle')

  // 3.1 — Vanilla recipe preset picker: the ID list for the current version is
  // fetched lazily when a recipe file is open. presetSelected is the dropdown's
  // current value (reset on file switch so it never echoes a stale choice).
  const [presetIds, setPresetIds] = useState<string[]>([])
  const [presetLoading, setPresetLoading] = useState(false)
  const [presetSelected, setPresetSelected] = useState('')

  // 2b.4 — Drag-and-drop merge state
  const [isDragging, setIsDragging] = useState(false)
  const dragCounterRef = useRef(0)

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

  const metadataProblems = useMemo(() => {
    if (!originalFiles) return []
    return validatePackMetadata(originalFiles, mode)
  }, [originalFiles, mode])

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
    if (metadataProblems.length > 0) {
      const metadataMarkers: IdeMarker[] = metadataProblems.map(problem => ({
        severity: problem.severity,
        message: problem.message,
        startLineNumber: 1,
        startColumn: 1,
        endLineNumber: 1,
        endColumn: 1,
      }))
      const filtered = problemFilter.trim().toLowerCase()
      if (!filtered || metadataMarkers.some(marker => marker.message.toLowerCase().includes(filtered))) {
        const metadataIndex = groups.findIndex(group => group.path === 'pack.mcmeta')
        const existing = metadataIndex >= 0 ? groups.splice(metadataIndex, 1)[0].markers : []
        groups.unshift({ path: 'pack.mcmeta', markers: [
          ...(filtered ? metadataMarkers.filter(marker => marker.message.toLowerCase().includes(filtered)) : metadataMarkers),
          ...existing,
        ] })
      }
    }
    return groups
  }, [problems, problemFilter, metadataProblems])

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

  // 1.2 — Build tree from merged set (original + edited) minus deleted.
  // New files appear, renamed files move, deleted files vanish.
  const tree = useMemo(
    () => {
      if (!originalFiles) return null
      const merged = { ...originalFiles, ...editedFiles }
      for (const d of deletedFiles) delete merged[d]
      return buildTree(Object.keys(merged))
    },
    [originalFiles, editedFiles, deletedFiles],
  )

  // M1.5 — flattened, depth-first, render-order list of currently visible
  // tree rows (collapsed folders omit descendants). Used for ArrowUp/Down nav.
  const visibleRows = useMemo(() => {
    if (!tree) return [] as { path: string; kind: 'folder' | 'file' }[]
    const out: { path: string; kind: 'folder' | 'file' }[] = []
    const walk = (node: TreeNode) => {
      for (const child of node.children) {
        out.push({ path: child.path, kind: child.isDir ? 'folder' : 'file' })
        if (child.isDir && !collapsed.has(child.path)) walk(child)
      }
    }
    walk(tree)
    return out
  }, [tree, collapsed])

  const activeContent = useMemo(() => {
    if (!activePath) return ''
    if (editedFiles[activePath] !== undefined) return editedFiles[activePath]
    return originalFiles?.[activePath] ?? ''
  }, [activePath, editedFiles, originalFiles])

  // Dispatch flags for the recipe visual editor. recipeFormActive is true while
  // the type is still resolving (McdocEditor shows its own spinner via type=null)
  // and once a real type has resolved; it goes false only when the type resolved
  // to null (fall back to Monaco) or the user toggled to the raw JSON view.
  const isRecipe = !!activePath && isRecipePath(activePath)
  const recipeFormActive =
    isRecipe && recipeView === 'form' &&
    (recipeTypeState === 'resolving' || recipeType !== null)

  // 3.5 — Opening the root pack.mcmeta always starts in the form view; the
  // JSON view is an explicit opt-in the user toggles into.
  useEffect(() => {
    if (activePath === 'pack.mcmeta') setMcmetaView('form')
  }, [activePath])

  // 3.1 — Opening a recipe file always starts in the form view, and any
  // lingering preset selection is cleared so the dropdown reflects "no choice".
  useEffect(() => {
    if (activePath && isRecipePath(activePath)) {
      setRecipeView('form')
      setPresetSelected('')
    }
  }, [activePath])

  // The checker attaches a per-recipe-type struct (shaped carries pattern+key,
  // shapeless carries ingredients) chosen from the "type" value at parse time.
  // The schema must therefore re-resolve when that discriminator changes —
  // e.g. a preset load switches shaped -> shapeless and the old struct would
  // otherwise keep rendering pattern/key against the new content.
  const recipeDiscriminator = useMemo(() => {
    if (!activePath || !isRecipePath(activePath)) return null
    try {
      const v = JSON.parse(activeContent) as { type?: unknown }
      return typeof v?.type === 'string' ? v.type : null
    } catch {
      return null
    }
  }, [activePath, activeContent])

  // 3.1 — Resolve the mcdoc root type for the open recipe file. Re-runs when
  // the file, the view, Spyglass readiness, or the recipe type discriminator
  // changes. A cancelled flag drops stale resolves when the user flips away
  // mid-flight.
  useEffect(() => {
    if (!activePath || !isRecipePath(activePath) || recipeView !== 'form' || !spyglassReady) {
      setRecipeTypeState('idle')
      setRecipeType(null)
      return
    }
    let cancelled = false
    setRecipeTypeState('resolving')
    setRecipeType(null)
    const svc = serviceRef.current
    if (!svc) return
    ;(async () => {
      // The service's own content sync is debounced 100ms, so push the current
      // text first. The mcdoc schema also loads lazily on the first bind — a
      // parse that lands mid-load yields a typeDef-less node, so re-parse
      // until the checker attaches one.
      for (let attempt = 0; attempt < 6 && !cancelled; attempt++) {
        await svc.updateFile(activePath, activeContent)
        const t = await svc.getSimplifiedRootType(activePath)
        if (cancelled) return
        if (t !== null) {
          setRecipeType(t)
          setRecipeTypeState('ready')
          return
        }
        await new Promise(r => setTimeout(r, 400))
      }
      setRecipeType(null)
      setRecipeTypeState('ready')
    })()
    return () => { cancelled = true }
  }, [activePath, recipeView, spyglassReady, recipeDiscriminator])

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

  // M1.5 — move keyboard focus between visible tree rows (ArrowUp/Down) and
  // expand/collapse folders (ArrowRight/Left). Enter opens a file.
  const handleTreeKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (visibleRows.length === 0) return
    const target = e.target as HTMLElement
    const currentPath = target.getAttribute('data-tree-path')
    const idx = currentPath ? visibleRows.findIndex(r => r.path === currentPath) : -1

    if (e.key === 'ArrowDown') {
      e.preventDefault()
      const next = visibleRows[Math.min(idx + 1, visibleRows.length - 1)] ?? visibleRows[0]
      document.querySelector<HTMLElement>(`[data-tree-path="${CSS.escape(next.path)}"]`)?.focus()
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      const prev = visibleRows[Math.max(idx - 1, 0)] ?? visibleRows[visibleRows.length - 1]
      document.querySelector<HTMLElement>(`[data-tree-path="${CSS.escape(prev.path)}"]`)?.focus()
    } else if (e.key === 'ArrowRight' || e.key === 'Enter') {
      const row = currentPath ? visibleRows[idx] : undefined
      if (row?.kind === 'folder') {
        if (collapsed.has(row.path)) {
          e.preventDefault()
          toggleFolder(row.path)
        } else if (e.key === 'ArrowRight') {
          // already expanded: move into first child
          e.preventDefault()
          const firstChild = visibleRows[idx + 1]
          if (firstChild) document.querySelector<HTMLElement>(`[data-tree-path="${CSS.escape(firstChild.path)}"]`)?.focus()
        }
      } else if (row?.kind === 'file' && e.key === 'Enter') {
        e.preventDefault()
        openFile(row.path)
      }
    } else if (e.key === 'ArrowLeft') {
      const row = currentPath ? visibleRows[idx] : undefined
      if (row?.kind === 'folder' && !collapsed.has(row.path)) {
        e.preventDefault()
        toggleFolder(row.path)
      }
    }
  }, [visibleRows, collapsed, toggleFolder, openFile])

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
    setDraftRestore(null)
    draftPromptedRef.current = null

    await onLoad(entries, name)
    addLog('success', `loaded ${name} (${Object.keys(entries).length} files)`)
  }, [addLog, onLoad])

  const handleClear = useCallback(() => {
    setOpenTabs([])
    setActivePath(null)
    onEditedFilesChange({})
    onDeletedFilesChange(new Set())
    setRenamingPath(null)
    setNewFileTarget(null)
    setNewFileName('')
    onClear()
    draftStoreRef.current?.clear().catch(() => {})
    addLog('info', 'pack cleared')
  }, [addLog, onClear, onEditedFilesChange, onDeletedFilesChange])

  const handlePortTo = useCallback((versionName: string) => {
    setPanel('fix')
    addLog('run', `port to ${versionName} requested`)
    onPortTo(versionName)
  }, [addLog, onPortTo])

  // --- Milestone 1: draft persistence -------------------------------------

  const buildDraft = useCallback((): DraftSnapshot | null => {
    const originals = originalFilesRef.current
    if (!originals) return null
    return {
      schemaVersion: DRAFT_SCHEMA_VERSION,
      packName: fileName || 'pack',
      contentHash: computeContentHash(originals),
      editedFiles: editedFilesRef.current,
      deletedFiles: [...deletedFilesRef.current],
      openTabs,
      activePath,
      selectedVersion: selectedGameVersion,
      sourceVersion: selectedGameVersion,
      panel,
      panelHeight,
      panelCollapsed,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }
  }, [openTabs, activePath, selectedGameVersion, panel, panelHeight, panelCollapsed, fileName])

  // Keep a live handle to the latest buildDraft so the one-shot store-init
  // effect can save the current workspace once IndexedDB is open, even if the
  // user already typed before the async open resolved.
  const buildDraftRef = useRef(buildDraft)
  useEffect(() => { buildDraftRef.current = buildDraft })

  // Debounced save so rapid typing doesn't hammer IndexedDB.
  useEffect(() => {
    const store = draftStoreRef.current
    if (!originalFiles || !store) return
    const timer = setTimeout(() => {
      const draft = buildDraft()
      if (draft) store.save(draft).catch(() => {})
    }, 600)
    return () => clearTimeout(timer)
  }, [originalFiles, editedFiles, deletedFiles, openTabs, activePath, selectedGameVersion, panel, panelHeight, panelCollapsed, buildDraft])

  // On mount, open the store and offer the latest draft — but only when the
  // live workspace is empty, so returning from the hub doesn't re-prompt for a
  // draft you are already editing.
  const maybePromptRestore = useCallback((store: DraftStoreLike) => {
    const originals = originalFilesRef.current
    if (!originals) return
    // Edits already in memory: no prompt; make sure the latest work is saved.
    if (Object.keys(editedFilesRef.current).length > 0 || deletedFilesRef.current.size > 0) {
      const d = buildDraftRef.current()
      if (d) store.save(d).catch(() => {})
      return
    }
    const currentHash = computeContentHash(originals)
    if (draftPromptedRef.current === currentHash) return
    store.load().then(d => {
      if (!d) return
      draftPromptedRef.current = currentHash
      setDraftRestore(d)
    }).catch(() => {})
  }, [])

  useEffect(() => {
    let cancelled = false
    createIdbDraftStore(DRAFT_DB)
      .then(store => {
        if (cancelled) return
        draftStoreRef.current = store
        maybePromptRestore(store)
      })
      .catch(() => {
        if (cancelled) return
        draftStoreRef.current = createMemoryDraftStore()
      })
    return () => { cancelled = true }
  }, [maybePromptRestore])

  // Re-check when a pack is loaded into an otherwise-empty workspace (fresh
  // page load path, since the store may not have been open at mount time).
  useEffect(() => {
    if (!originalFiles) return
    const store = draftStoreRef.current
    if (!store) return
    maybePromptRestore(store)
  }, [originalFiles, maybePromptRestore])

  const handleRestoreDraft = useCallback(() => {
    const d = draftRestore
    if (!d) return
    onEditedFilesChange(d.editedFiles)
    onDeletedFilesChange(new Set(d.deletedFiles))
    setOpenTabs(d.openTabs)
    setActivePath(d.activePath)
    if (d.selectedVersion) setSelectedGameVersion(d.selectedVersion)
    if (d.panel === 'analysis' || d.panel === 'fix' || d.panel === 'problems' || d.panel === 'output') {
      setPanel(d.panel)
    }
    setPanelHeight(d.panelHeight)
    setPanelCollapsed(d.panelCollapsed)
    setDraftRestore(null)
    addLog('success', `draft for "${d.packName}" restored`)
  }, [draftRestore, onEditedFilesChange, onDeletedFilesChange, addLog])

  const handleDiscardDraft = useCallback(() => {
    setDraftRestore(null)
    draftStoreRef.current?.clear().catch(() => {})
    addLog('info', 'stored draft discarded')
  }, [addLog])

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

  // The preset CDN tags its summary branches with the version ID (e.g.
  // "26.3-snapshot-7-summary"), not the display name ("26.3 Snapshot 7").
  // 'Auto' maps to the latest known version from the selector list.
  const recipePresetVersion = useMemo(() => {
    if (selectedGameVersion === 'Auto') return sortedVersions[0]?.id ?? ''
    return sortedVersions.find(v => v.name === selectedGameVersion)?.id ?? selectedGameVersion
  }, [selectedGameVersion, sortedVersions])

  // 3.1 — Lazily fetch the vanilla recipe ID list for the current version
  // whenever a recipe file is opened or the version changes. Failures surface
  // as an empty list (the dropdown shows "No presets available"), never an
  // error wall.
  useEffect(() => {
    if (!activePath || !isRecipePath(activePath) || !recipePresetVersion) {
      setPresetIds([])
      setPresetLoading(false)
      return
    }
    let cancelled = false
    setPresetLoading(true)
    fetchRecipeIds(recipePresetVersion).then(ids => {
      if (cancelled) return
      setPresetIds(ids)
      setPresetLoading(false)
    })
    return () => { cancelled = true }
  }, [activePath, recipePresetVersion])

  // 3.1 — Load a vanilla preset: replace the file content with the preset's
  // pretty-printed JSON through the same path as any other edit, then snap back
  // to the form view so the new structure is visible immediately.
  const handleLoadRecipePreset = useCallback(async (id: string) => {
    if (!id || !activePath) return
    setPresetSelected(id)
    const preset = await fetchRecipePreset(recipePresetVersion, id)
    if (!preset) {
      // Fetch failed — don't leave the dropdown claiming a loaded preset.
      setPresetSelected('')
      return
    }
    handleEdited(activePath, JSON.stringify(preset as JsonValue, null, 2))
    setRecipeView('form')
  }, [activePath, recipePresetVersion, handleEdited])

  // --- 1.7 Analyze Datapack ----------------------------------------------
  // Single derivation shared with App's check/fix; every analyze run stamps
  // the revision it started from so a superseded or stale result is ignored.
  const mergedFiles = useMemo<PackFileMap | null>(
    () => buildWorkspaceFiles({ originalFiles, editedFiles, deletedFiles }),
    [originalFiles, editedFiles, deletedFiles],
  )
  const analyzeGenRef = useRef(0)
  const revisionRef = useRef(revision)
  useEffect(() => { revisionRef.current = revision }, [revision])

  const handleAnalyzeAll = useCallback(async () => {
    if (!serviceRef.current || !mergedFiles) return
    const gen = ++analyzeGenRef.current
    const runRevision = revisionRef.current
    setPanel('problems')
    setAnalyzeAllMode(true)
    addLog('run', 'analyzing full datapack…')
    try {
      const results = await serviceRef.current.analyzeAll(mergedFiles)
      // A newer run or a workspace edit while this was in flight means these
      // markers no longer match the live tree — drop them, don't overwrite.
      if (gen !== analyzeGenRef.current || revisionRef.current !== runRevision) {
        addLog('info', 'analyze result skipped (workspace changed during run)')
        return
      }
      setProblems(results)
      addLog('success', `analyze complete — ${results.length} problem${results.length !== 1 ? 's' : ''}`)
    } catch (err) {
      addLog('error', `analyze failed: ${err instanceof Error ? err.message : String(err)}`)
      setAnalyzeAllMode(false)
    }
  }, [mergedFiles, addLog])

  // --- M2 (slice C): Fix Preview V2, rollback-safe Apply & Undo ----------
  const lastFixBackupRef = useRef<Record<string, string> | null>(null)
  const [hasFixBackup, setHasFixBackup] = useState(false)
  const [confirmingApply, setConfirmingApply] = useState(false)
  const [expandedFixFiles, setExpandedFixFiles] = useState<Set<string>>(new Set())

  const fixPreviewV2 = useMemo<FixPreviewV2 | null>(() => {
    if (!fixPreview) return null
    const workspace = mergedFiles || originalFiles || {}
    return toFixPreviewV2(fixPreview, workspace)
  }, [fixPreview, mergedFiles, originalFiles])

  // Reset confirmation and auto-expand changed files whenever a new fix preview arrives
  useEffect(() => {
    setConfirmingApply(false)
    if (fixPreviewV2 && fixPreviewV2.changes.length > 0) {
      setExpandedFixFiles(new Set(fixPreviewV2.changes.map(c => c.file)))
    } else {
      setExpandedFixFiles(new Set())
    }
  }, [fixPreviewV2])

  const handleApplyClick = useCallback(() => {
    setConfirmingApply(true)
  }, [])

  const handleCancelApply = useCallback(() => {
    setConfirmingApply(false)
  }, [])

  const handleConfirmApply = useCallback(() => {
    if (!fixPreviewV2) return
    const workspace = mergedFiles || originalFiles || {}
    const { backup } = applyFixPreview(fixPreviewV2, workspace)
    lastFixBackupRef.current = backup
    setHasFixBackup(Object.keys(backup).length > 0)

    const nextEdited = { ...editedFiles }
    for (const change of fixPreviewV2.changes) {
      if (!change.skipped) {
        nextEdited[change.file] = change.after
      }
    }
    onEditedFilesChange(nextEdited)
    setConfirmingApply(false)
    addLog('success', `Applied fix preview to ${Object.keys(backup).length} file(s)`)
    onRun()
  }, [fixPreviewV2, mergedFiles, originalFiles, editedFiles, onEditedFilesChange, addLog, onRun])

  const handleUndoFix = useCallback(() => {
    const backup = lastFixBackupRef.current
    if (!backup) return
    const nextEdited = { ...editedFiles }
    for (const [file, content] of Object.entries(backup)) {
      nextEdited[file] = content
    }
    onEditedFilesChange(nextEdited)
    lastFixBackupRef.current = null
    setHasFixBackup(false)
    addLog('info', `Rolled back last fix (${Object.keys(backup).length} file(s) restored)`)
    onRun()
  }, [editedFiles, onEditedFilesChange, addLog, onRun])

  // --- 1.8 Reset / Reload ------------------------------------------------
  const handleReset = useCallback(() => {
    if (!window.confirm('Discard all edits and reset to original files?')) return
    setOpenTabs([])
    setActivePath(null)
    onEditedFilesChange({})
    onDeletedFilesChange(new Set())
    draftStoreRef.current?.clear().catch(() => {})
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

  // --- 2b.4 Drag-and-drop merge -------------------------------------------
  const handleDragEnter = useCallback((e: React.DragEvent) => {
    if (!e.dataTransfer.types.includes('Files')) return
    dragCounterRef.current++
    if (dragCounterRef.current === 1) setIsDragging(true)
  }, [])

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    dragCounterRef.current--
    if (dragCounterRef.current <= 0) {
      dragCounterRef.current = 0
      setIsDragging(false)
    }
  }, [])

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
  }, [])

  const handleMergeDrop = useCallback(async (e: React.DragEvent) => {
    e.preventDefault()
    dragCounterRef.current = 0
    setIsDragging(false)

    // If no pack loaded, fall back to initial load
    if (!originalFiles) {
      const incoming = await readDroppedFiles(e.dataTransfer)
      if (incoming) {
        const name = Object.keys(incoming).find(k => k.endsWith('pack.mcmeta'))
          ?.replace(/\/?pack\.mcmeta$/, '') || 'dropped-pack'
        await onLoad(incoming, name)
      }
      return
    }

    const incoming = await readDroppedFiles(e.dataTransfer)
    if (!incoming) {
      addLog('error', 'Drop a .zip or a folder')
      return
    }

    const current = mergedFiles ?? { ...originalFiles, ...editedFiles }
    const conflicts = Object.keys(incoming).filter(k => k in current)

    if (conflicts.length > 0) {
      const preview = conflicts.slice(0, 6).map(p => `\u2022 ${p}`).join('\n')
      const more = conflicts.length > 6 ? `\n\u2022 …and ${conflicts.length - 6} more` : ''
      const ok = window.confirm(
        `${conflicts.length} file(s) already exist:\n${preview}${more}\n\nOverwrite these files?`
      )
      if (!ok) {
        addLog('info', 'merge cancelled')
        return
      }
    }

    onEditedFilesChange({ ...editedFiles, ...incoming })

    // Dropped paths that were previously deleted come back on merge.
    const droppedKeys = new Set(Object.keys(incoming))
    const restored = new Set(deletedFiles)
    let changed = false
    for (const d of restored) {
      if (droppedKeys.has(d)) { restored.delete(d); changed = true }
    }
    if (changed) onDeletedFilesChange(restored)

    addLog('success', `merged ${Object.keys(incoming).length} file(s)`)
  }, [originalFiles, editedFiles, deletedFiles, mergedFiles, onLoad, onEditedFilesChange, onDeletedFilesChange, addLog])

  // --- 1.12 Export pack as zip -------------------------------------------
  const handleExport = useCallback(async () => {
    if (!originalFiles) return
    // Use the single source of truth so deletions are honored by export too
    // (previously export ignored deletions while check/fix/analyze did not).
    const merged = buildWorkspaceFiles({ originalFiles, editedFiles, deletedFiles })
    if (!merged) return
    const safeName = (fileName || 'datapack').replace(/\.zip$/i, '')
    const filename = `${safeName}_edited.zip`
    try {
      const blob = await exportZip(merged)
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = filename
      a.click()
      URL.revokeObjectURL(url)
      addLog('success', `exported ${filename}`)
    } catch (err) {
      addLog('error', `export failed: ${err instanceof Error ? err.message : String(err)}`)
    }
  }, [originalFiles, editedFiles, deletedFiles, fileName, addLog])

  // M1.5 — Global keyboard shortcuts: Ctrl/Cmd+S export, Ctrl+Shift+A run check,
  // Escape closes the active tab or cancels the delete-confirm dialog.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName
      const isEditableField =
        tag === 'INPUT' || tag === 'TEXTAREA' || (e.target as HTMLElement)?.isContentEditable

      // Ctrl/Cmd+S — export the pack. Never steal from text fields.
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 's') {
        if (isEditableField) return
        e.preventDefault()
        handleExport()
        return
      }

      // Ctrl+Shift+A (or Ctrl+Enter) — run whole-pack analysis.
      if (
        ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 'a') ||
        ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key === 'Enter')
      ) {
        if (isEditableField) return
        e.preventDefault()
        handleRun()
        return
      }

      // Escape — only act when no text field is focused (let fields keep their
      // own Escape handling for newfile/rename inputs). Closes the active tab
      // or cancels the pending delete confirmation.
      if (e.key === 'Escape' && !isEditableField) {
        if (pendingDelete) {
          e.preventDefault()
          setPendingDelete(null)
          addLog('info', 'delete cancelled')
          return
        }
        if (activePath) {
          e.preventDefault()
          closeTab(activePath)
          return
        }
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [handleExport, handleRun, pendingDelete, activePath, closeTab, addLog])

  // --- 1.2 File operations: create / rename / delete --------------------

  /** Collect all unique folder paths from the merged file set. */
  const folderPaths = useMemo(() => {
    if (!originalFiles) return []
    const folders = new Set<string>()
    for (const p of Object.keys({ ...originalFiles, ...editedFiles })) {
      const parts = p.split('/')
      let acc = ''
      for (let i = 0; i < parts.length - 1; i++) {
        acc = acc ? acc + '/' + parts[i] : parts[i]
        folders.add(acc)
      }
    }
    return [...folders].sort()
  }, [originalFiles, editedFiles])

  /** Open the new-file input after the DOM updates. */
  useEffect(() => {
    if (newFileTarget !== null) {
      // Defer so the input is mounted
      queueMicrotask(() => newFileInputRef.current?.focus())
    }
  }, [newFileTarget])

  /** Focus the rename input when a file enters rename mode. */
  useEffect(() => {
    if (renamingPath !== null) {
      queueMicrotask(() => renameInputRef.current?.focus())
    }
  }, [renamingPath])

  const handleCreateFile = useCallback(() => {
    const raw = newFileName.trim()
    if (!raw) return
    const nameErr = validateFileName(raw)
    if (nameErr) {
      addLog('error', nameErr)
      return
    }
    if (isPathTraversal(raw)) {
      addLog('error', 'File name must not traverse paths')
      return
    }
    const folder = newFileTarget ?? ''
    const path = folder ? `${folder}/${raw}` : raw
    // Ensure uniqueness across merged set
    const all = { ...originalFiles, ...editedFiles }
    if (all[path] !== undefined || deletedFiles.has(path)) {
      addLog('error', `File "${path}" already exists`)
      return
    }
    // Determine content from extension
    const ext = raw.split('.').pop()?.toLowerCase()
    let content = ''
    if (path.endsWith('pack.mcmeta')) {
      content = JSON.stringify({ pack: { pack_format: 48, description: 'My Pack' } }, null, 2)
    } else if (ext === 'mcmeta') {
      content = JSON.stringify({ pack: { pack_format: 1, description: '' } }, null, 2)
    } else if (ext === 'json') {
      content = '{}'
    }
    onEditedFilesChange({ ...editedFiles, [path]: content })
    setNewFileTarget(null)
    setNewFileName('')
    openFile(path)
    addLog('success', `created ${path}`)
  }, [newFileName, newFileTarget, originalFiles, editedFiles, deletedFiles, onEditedFilesChange, openFile, addLog])

  const handleRenameCommit = useCallback((oldPath: string, newName: string) => {
    setRenamingPath(null)
    setRenameError(null)
    const raw = newName.trim()
    if (!raw || raw === oldPath.split('/').pop()) return // no change or empty
    const nameErr = validateFileName(raw)
    if (nameErr) {
      setRenameError(nameErr)
      return
    }
    if (raw.includes('/') || raw.includes('\\')) {
      setRenameError('File name must not contain path separators')
      return
    }
    const dir = oldPath.includes('/') ? oldPath.slice(0, oldPath.lastIndexOf('/')) : ''
    const newPath = dir ? `${dir}/${raw}` : raw
    const all = { ...originalFiles, ...editedFiles }
    if ((all[newPath] !== undefined && newPath !== oldPath) || deletedFiles.has(newPath)) {
      setRenameError(`File "${newPath}" already exists`)
      return
    }
    // Move the editedFiles entry (or create one if the file was only in originalFiles)
    const content = editedFiles[oldPath] ?? originalFiles?.[oldPath] ?? ''
    const newEdited = { ...editedFiles }
    delete newEdited[oldPath]
    newEdited[newPath] = content
    onEditedFilesChange(newEdited)
    // If old file was only in originalFiles and hasn't been edited, we still
    // need to add it to editedFiles (which the line above does with the new key).
    // If the file was deleted from originalFiles only, add to deletedFiles too.
    if (originalFiles?.[oldPath] !== undefined && editedFiles[oldPath] === undefined) {
      // The original content was moved — mark old as "deleted" so tree hides it
      onDeletedFilesChange(new Set(deletedFiles).add(oldPath))
    }
    // Warn about references
    const refs = findReferencesTo(oldPath, all)
    if (refs.length > 0) {
      addLog('info', `renamed ${oldPath} → ${newPath} — ${refs.length} reference(s) in: ${[...new Set(refs.map(r => r.file))].join(', ')}`)
    }
    // Update tabs
    setOpenTabs(prev => prev.map(p => p === oldPath ? newPath : p))
    if (activePath === oldPath) {
      setActivePath(newPath)
    }
    addLog('info', `renamed ${oldPath} → ${newPath}`)
  }, [originalFiles, editedFiles, deletedFiles, activePath, onEditedFilesChange, onDeletedFilesChange, addLog])

  // --- 2b.5 File move via drag onto folder --------------------------------
  const handleDragStart = useCallback((path: string) => {
    setDragPath(path)
  }, [])

  const handleDragEnd = useCallback(() => {
    setDragPath(null)
    setDropFolderPath(null)
  }, [])

  const handleFolderDragOver = useCallback((e: React.DragEvent, folderPath: string) => {
    e.preventDefault()
    e.stopPropagation()
    setDropFolderPath(folderPath)
  }, [])

  const handleFolderDragLeave = useCallback((e: React.DragEvent) => {
    e.stopPropagation()
    setDropFolderPath(null)
  }, [])

  const handleMoveFile = useCallback((folderPath: string) => {
    const oldPath = dragPath
    if (!oldPath) return
    setDragPath(null)
    setDropFolderPath(null)

    const fileName = oldPath.split('/').pop()!
    const newPath = folderPath ? `${folderPath}/${fileName}` : fileName
    if (newPath === oldPath) {
      addLog('info', 'file is already in that folder')
      return
    }
    const all = { ...originalFiles, ...editedFiles }
    if (all[newPath] !== undefined || deletedFiles.has(newPath)) {
      addLog('error', `File "${newPath}" already exists`)
      return
    }
    // Move content — editedFiles takes priority (unsaved edits preserved)
    const content = editedFiles[oldPath] ?? originalFiles?.[oldPath] ?? ''
    const newEdited = { ...editedFiles }
    delete newEdited[oldPath]
    newEdited[newPath] = content
    onEditedFilesChange(newEdited)
    // Track deletion for originalFiles-only files
    if (originalFiles?.[oldPath] !== undefined && editedFiles[oldPath] === undefined) {
      onDeletedFilesChange(new Set(deletedFiles).add(oldPath))
    }
    // Update tabs
    setOpenTabs(prev => prev.map(p => p === oldPath ? newPath : p))
    if (activePath === oldPath) {
      setActivePath(newPath)
    }
    addLog('info', `moved ${oldPath} → ${newPath}`)
  }, [dragPath, originalFiles, editedFiles, deletedFiles, activePath, onEditedFilesChange, onDeletedFilesChange, addLog])

  const handleDeleteFile = useCallback((path: string) => {
    const all = { ...originalFiles, ...editedFiles }
    const refs = findReferencesTo(path, all)
    setPendingDelete(path)
    if (refs.length > 0) {
      addLog('info', `delete "${path}" — ${refs.length} reference(s) in: ${[...new Set(refs.map(r => r.file))].join(', ')}`)
    }
  }, [originalFiles, editedFiles, addLog])

  const confirmDelete = useCallback(() => {
    const path = pendingDelete
    if (!path) return
    setPendingDelete(null)
    // Remove from editedFiles
    const newEdited = { ...editedFiles }
    delete newEdited[path]
    onEditedFilesChange(newEdited)
    // Track deletion for originalFiles-only files
    if (originalFiles?.[path] !== undefined && editedFiles[path] === undefined) {
      onDeletedFilesChange(new Set(deletedFiles).add(path))
    }
    // Close tab if open
    setOpenTabs(prev => {
      const next = prev.filter(p => p !== path)
      if (activePath === path) setActivePath(next[next.length - 1] ?? null)
      return next
    })
    addLog('info', `deleted ${path}`)
  }, [pendingDelete, originalFiles, editedFiles, deletedFiles, activePath, onEditedFilesChange, onDeletedFilesChange, addLog])

  const cancelDelete = useCallback(() => {
    setPendingDelete(null)
    addLog('info', 'delete cancelled')
  }, [addLog])

  function renderTree(node: TreeNode, depth: number): ReactNode {
    return node.children.map(child => {
      if (child.isDir) {
        const isCollapsed = collapsed.has(child.path)
        const isDropTarget = dragPath !== null && dropFolderPath === child.path
        return (
          <div key={child.path}>
            <button
              type="button"
              data-tree-path={child.path}
              data-tree-kind="folder"
              aria-expanded={!isCollapsed}
              className={`ide-tree-row ide-folder${isCollapsed ? ' collapsed' : ''}${isDropTarget ? ' drop-target' : ''}`}
              style={{ paddingLeft: depth * 14 + 6 }}
              onClick={() => toggleFolder(child.path)}
              onDragOver={e => handleFolderDragOver(e, child.path)}
              onDragLeave={handleFolderDragLeave}
              onDrop={() => handleMoveFile(child.path)}
            >
              <span className="ide-caret">{isCollapsed ? '▶' : '▼'}</span>
              <span className="ide-folder-icon">{isDropTarget ? '📂' : '📁'}</span>
              <span className="ide-folder-name">{child.name}</span>
            </button>
            {!isCollapsed && renderTree(child, depth + 1)}
          </div>
        )
      }
      const isActive = activePath === child.path
      const isEdited = editedFiles[child.path] !== undefined
      const isRenaming = renamingPath === child.path
      const isBeingDragged = dragPath === child.path
      const fileName = child.name

      if (isRenaming) {
        return (
          <div
            key={child.path}
            className="ide-tree-row ide-file renaming"
            style={{ paddingLeft: depth * 14 + 24 }}
          >
            <span className="ide-file-icon">{'·'}</span>
            <input
              ref={renameInputRef}
              className="ide-rename-input"
              type="text"
              defaultValue={fileName}
              aria-label={`Rename ${fileName}`}
              autoFocus
              onClick={e => e.stopPropagation()}
              onKeyDown={e => {
                e.stopPropagation()
                if (e.key === 'Enter') handleRenameCommit(child.path, e.currentTarget.value)
                if (e.key === 'Escape') setRenamingPath(null)
              }}
              onBlur={e => handleRenameCommit(child.path, e.target.value)}
            />
            {renameError && <span className="ide-rename-error">{renameError}</span>}
          </div>
        )
      }

      return (
        <button
          key={child.path}
          type="button"
          data-tree-path={child.path}
          data-tree-kind="file"
          aria-selected={isActive}
          className={`ide-tree-row ide-file${isActive ? ' active' : ''}${isBeingDragged ? ' dragging' : ''}`}
          style={{ paddingLeft: depth * 14 + 24 }}
          draggable
          onDragStart={() => handleDragStart(child.path)}
          onDragEnd={handleDragEnd}
          onClick={() => openFile(child.path)}
          onDoubleClick={() => setRenamingPath(child.path)}
          title={child.path}
        >
          <span className="ide-file-icon">{isEdited ? '●' : '·'}</span>
          <span className="ide-file-name">{fileName}</span>
          <span className="ide-file-actions">
            <span
              className="ide-file-action"
              role="button"
              tabIndex={-1}
              title="Rename"
              aria-label={`Rename ${fileName}`}
              onClick={e => { e.stopPropagation(); setRenamingPath(child.path) }}
            >✎</span>
            <span
              className="ide-file-action"
              role="button"
              tabIndex={-1}
              title="Delete"
              aria-label={`Delete ${fileName}`}
              onClick={e => { e.stopPropagation(); handleDeleteFile(child.path) }}
            >✕</span>
          </span>
        </button>
      )
    })
  }

  const hasUnsaved = Object.keys(editedFiles).length > 0

  return (
    <div
      className="ide"
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDragOver={handleDragOver}
      onDrop={handleMergeDrop}
    >
      {draftRestore && (
        <div className="ide-draft-banner" role="alert">
          <div className="ide-draft-banner-text">
            <strong>Restore unsaved work?</strong>{' '}
            {draftRestore.contentHash !== computeContentHash(originalFiles ?? {})
              ? 'The source pack changed since this draft was saved.'
              : `A saved draft for "${draftRestore.packName}" is available.`}
          </div>
          <div className="ide-draft-banner-actions">
            <button type="button" onClick={handleRestoreDraft}>Restore</button>
            <button type="button" className="secondary" onClick={handleDiscardDraft}>Discard</button>
          </div>
        </div>
      )}
      {pendingDelete && (
        <div className="ide-draft-banner" role="alertdialog" aria-label="Confirm delete">
          <div className="ide-draft-banner-text">
            <strong>Delete "{pendingDelete.split('/').pop()}"?</strong> This action can be undone only by reloading the pack.
          </div>
          <div className="ide-draft-banner-actions">
            <button type="button" onClick={confirmDelete} autoFocus aria-label="Confirm delete">Delete</button>
            <button type="button" className="secondary" onClick={cancelDelete} aria-label="Cancel delete">Keep</button>
          </div>
        </div>
      )}
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
        <button
          type="button"
          className="ide-topbar-btn"
          onClick={handleExport}
          disabled={!originalFiles}
          title="Export pack as zip (Ctrl+S)"
        >Export</button>

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
                <div
                  className="ide-tree"
                  role="tree"
                  aria-label="Pack files"
                  onKeyDown={handleTreeKeyDown}
                >
                  {tree.children.length > 0 ? renderTree(tree, 0) : (
                    <div className="ide-tree-empty">Empty pack</div>
                  )}
                  {/* New file row */}
                  {newFileTarget !== null ? (
                    <div className="ide-tree-newfile">
                      <span className="ide-file-icon">{'·'}</span>
                      <select
                        className="ide-newfile-folder"
                        value={newFileTarget}
                        aria-label="Target folder"
                        onChange={e => setNewFileTarget(e.target.value)}
                      >
                        <option value="">Root</option>
                        {folderPaths.map(fp => (
                          <option key={fp} value={fp}>{fp}</option>
                        ))}
                      </select>
                      <input
                        ref={newFileInputRef}
                        className="ide-newfile-input"
                        type="text"
                        placeholder="name.ext"
                        aria-label="New file name"
                        value={newFileName}
                        onChange={e => setNewFileName(e.target.value)}
                        onKeyDown={e => {
                          if (e.key === 'Enter') handleCreateFile()
                          if (e.key === 'Escape') { setNewFileTarget(null); setNewFileName('') }
                        }}
                      />
                      <span className="ide-file-actions visible">
                        <span
                          className="ide-file-action"
                          role="button"
                          tabIndex={-1}
                          title="Create"
                          aria-label="Create file"
                          onClick={handleCreateFile}
                        >✓</span>
                        <span
                          className="ide-file-action"
                          role="button"
                          tabIndex={-1}
                          title="Cancel"
                          aria-label="Cancel"
                          onClick={() => { setNewFileTarget(null); setNewFileName('') }}
                        >✕</span>
                      </span>
                    </div>
                  ) : (
                    <button
                      type="button"
                      className="ide-tree-newfile-btn"
                      onClick={() => { setNewFileTarget(''); setNewFileName('') }}
                      title="Create a new file"
                    >+ New file</button>
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
            {!activePath ? (
              <div className="ide-editor-empty">
                {originalFiles
                  ? 'No file open — pick one from the explorer.'
                  : 'Load a datapack or resource pack to start editing.'}
              </div>
            ) : isRecipe ? (
              <>
                <div className="ide-recipe-bar">
                  <span className="ide-recipe-bar-label">Load preset</span>
                  <select
                    className="ide-recipe-select"
                    value={presetSelected}
                    disabled={presetLoading || presetIds.length === 0}
                    onChange={e => handleLoadRecipePreset(e.target.value)}
                    aria-label="Load a vanilla recipe preset"
                  >
                    <option value="">
                      {presetLoading
                        ? 'Loading presets…'
                        : presetIds.length === 0
                          ? 'No presets available'
                          : 'Choose a vanilla recipe…'}
                    </option>
                    {presetIds.map(id => (
                      <option key={id} value={id}>{id}</option>
                    ))}
                  </select>
                </div>
                {recipeFormActive ? (
                  <McdocEditor
                    content={activeContent}
                    type={recipeType}
                    version={recipePresetVersion}
                    onChange={(next) => handleEdited(activePath, next)}
                    onShowJson={() => setRecipeView('json')}
                  />
                ) : (
                  <>
                    {recipeView === 'json' && (
                      <div className="ide-form-toggle">
                        <span className="ide-form-toggle-label">Editing raw JSON</span>
                        <button
                          type="button"
                          className="ide-form-toggle-btn"
                          onClick={() => setRecipeView('form')}
                        >Show Form</button>
                      </div>
                    )}
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
                  </>
                )}
              </>
            ) : activePath === 'pack.mcmeta' && mcmetaView === 'form' ? (
              <McmetaEditor
                content={activeContent}
                onChange={(next) => handleEdited('pack.mcmeta', next)}
                versions={versions}
                mode={mode}
                onShowJson={() => setMcmetaView('json')}
              />
            ) : (
              <>
                {activePath === 'pack.mcmeta' && mcmetaView === 'json' && (
                  <div className="ide-form-toggle">
                    <span className="ide-form-toggle-label">Editing raw JSON</span>
                    <button
                      type="button"
                      className="ide-form-toggle-btn"
                      onClick={() => setMcmetaView('form')}
                    >Show Form</button>
                  </div>
                )}
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
              </>
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
                      {!progress && !loading && (originalFiles ? <span className="kbd">Ctrl+Shift+A</span> : 'upload a pack first')}
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
                    <>
                      {resultStale && (
                        <div className="ide-stale">Workspace changed after this check started — results are stale. Run the check again.</div>
                      )}
                      <Results result={result.result} mode={result.mode} duration={checkDuration} onPortTo={handlePortTo} />
                    </>
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
                  <div className="card animate-in-d3">
                    <h2>Auto-Fix / Port <span className="sub">rewrites commands, fixes JSON, updates pack.mcmeta</span></h2>

                    <div className="grid-2">
                      <div className="field">
                        <label>Target version</label>
                        <select value={fixTarget} onChange={e => { onFixTargetChange(e.target.value) }}>
                          <option value="">— select target —</option>
                          {versions.map(v => (
                            <option key={v.id} value={v.name}>{v.name}</option>
                          ))}
                        </select>
                      </div>
                      <div className="field">
                        <label>Source version (optional)</label>
                        <select value={fixSource} onChange={e => { onFixSourceChange(e.target.value) }}>
                          <option value="">— auto-detect —</option>
                          {versions.map(v => (
                            <option key={v.id} value={v.name}>{v.name}</option>
                          ))}
                        </select>
                        <div className="hint">Auto-detected from the pack.mcmeta load range if left blank.</div>
                      </div>
                    </div>

                    <div className="fix-actions" style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap', marginTop: '12px' }}>
                      {!originalFiles && <span className="run-hint">Upload a pack first</span>}
                      <button
                        className="btn btn-primary"
                        onClick={handlePreview}
                        disabled={loading || !originalFiles || !fixTarget}
                        aria-busy={loading}
                      >
                        {loading ? <><span className="spinner" /> Generating…</> : 'Preview Changes'}
                      </button>

                      {fixPreviewV2 && fixPreviewV2.changes.length > 0 && (
                        confirmingApply ? (
                          <div style={{ display: 'inline-flex', gap: '6px', alignItems: 'center' }}>
                            <button
                              className="btn btn-primary"
                              style={{ background: 'var(--sev-warn, #f59e0b)', borderColor: 'var(--sev-warn, #f59e0b)', color: '#000', fontWeight: 600 }}
                              onClick={handleConfirmApply}
                              disabled={loading}
                            >
                              ⚠️ Confirm Apply
                            </button>
                            <button
                              className="btn btn-ghost"
                              onClick={handleCancelApply}
                              disabled={loading}
                            >
                              Cancel
                            </button>
                          </div>
                        ) : (
                          <button
                            className="btn btn-primary"
                            onClick={handleApplyClick}
                            disabled={loading}
                          >
                            Apply Fixes to Workspace
                          </button>
                        )
                      )}

                      <button
                        className="btn btn-ghost"
                        onClick={handleUndoFix}
                        disabled={loading || !hasFixBackup}
                        title={hasFixBackup ? 'Rollback the last applied fix' : 'No previous fix to rollback'}
                      >
                        ↩ Undo last fix
                      </button>

                      {fixPreview && (
                        <button
                          className="btn btn-success btn-lg"
                          onClick={handleDownload}
                          disabled={loading}
                          aria-busy={loading}
                          style={{ marginLeft: 'auto' }}
                        >
                          {loading ? <><span className="spinner" /> Downloading…</> : '⬇ Download Ported .zip'}
                        </button>
                      )}
                    </div>

                    {previewStale && (
                      <div className="ide-stale" style={{ marginTop: '12px' }}>
                        Workspace changed after this preview — regenerate before applying or downloading.
                      </div>
                    )}

                    {fixPreviewV2 && (
                      <div className="porting-plan" style={{ marginTop: 16 }}>
                        <div className="plan-header">
                          <span className={`plan-direction ${fixPreview?.plan?.direction === 'forward' ? 'fwd' : 'bwd'}`}>
                            {fixPreview?.plan?.direction === 'forward' ? 'Upgrade' : 'Backport'}
                          </span>
                          <span className="plan-versions">
                            {fixPreview?.plan?.sourceVersion || 'Current'} → {fixPreviewV2.version || fixTarget}
                          </span>
                          <span className="plan-file-count">
                            {fixPreviewV2.changes.length} file{fixPreviewV2.changes.length !== 1 ? 's' : ''} changed
                          </span>
                        </div>

                        <div className="stats" style={{ marginBottom: 14, marginTop: 14 }}>
                          <div className="stat blue">
                            <div className="num">{fixPreviewV2.changes.length}</div>
                            <div className="label">Files changed</div>
                          </div>
                          <div className="stat blue">
                            <div className="num">{fixPreview?.summary?.totalPatches ?? fixPreviewV2.changes.length}</div>
                            <div className="label">Total patches</div>
                          </div>
                          {Boolean(fixPreview?.plan?.summary?.commandRewrites && fixPreview.plan.summary.commandRewrites > 0) && (
                            <div className="stat green">
                              <div className="num">{fixPreview?.plan?.summary?.commandRewrites}</div>
                              <div className="label">Command rewrites</div>
                            </div>
                          )}
                          {Boolean(fixPreview?.plan?.summary?.jsonFixes && fixPreview.plan.summary.jsonFixes > 0) && (
                            <div className="stat purple">
                              <div className="num">{fixPreview?.plan?.summary?.jsonFixes}</div>
                              <div className="label">JSON fixes</div>
                            </div>
                          )}
                          {Boolean(fixPreview?.plan?.summary?.manualAttention && fixPreview.plan.summary.manualAttention > 0) && (
                            <div className="stat red">
                              <div className="num">{fixPreview?.plan?.summary?.manualAttention}</div>
                              <div className="label">Manual</div>
                            </div>
                          )}
                        </div>

                        {fixPreview?.summary?.errors && fixPreview.summary.errors.length > 0 && (
                          <div className="error" style={{ marginBottom: 14 }}>
                            <span>!</span>
                            <span>{fixPreview.summary.errors.join('; ')}</span>
                          </div>
                        )}

                        {fixPreviewV2.skipped.length > 0 && (
                          <div
                            className="fix-skipped-summary"
                            style={{
                              padding: '10px 14px',
                              background: 'rgba(245, 158, 11, 0.1)',
                              border: '1px solid rgba(245, 158, 11, 0.25)',
                              borderRadius: 'var(--r-sm, 4px)',
                              marginBottom: 14,
                              fontSize: '0.82rem',
                            }}
                          >
                            <strong style={{ color: '#f59e0b' }}>⚠️ {fixPreviewV2.skipped.length} file(s) skipped:</strong>
                            <ul style={{ margin: '6px 0 0 18px', padding: 0 }}>
                              {fixPreviewV2.skipped.map((s, idx) => (
                                <li key={idx} style={{ color: 'var(--ink-dim, #cbd5e1)' }}>
                                  <code>{s.file}</code> — {s.reason}
                                </li>
                              ))}
                            </ul>
                          </div>
                        )}

                        {fixPreviewV2.changes.length > 0 ? (
                          <>
                            <div className="fix-toolbar" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                              <span className="fix-toolbar-title">Changed files ({fixPreviewV2.changes.length})</span>
                              <button
                                className="btn btn-ghost btn-sm"
                                onClick={() => setExpandedFixFiles(new Set(fixPreviewV2.changes.map(c => c.file)))}
                              >
                                Expand all
                              </button>
                              <button
                                className="btn btn-ghost btn-sm"
                                onClick={() => setExpandedFixFiles(new Set())}
                              >
                                Collapse all
                              </button>
                            </div>

                            <div className="scl-box fix-file-list" style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                              {fixPreviewV2.changes.map((change) => {
                                const isExpanded = expandedFixFiles.has(change.file)
                                return (
                                  <FixFileDiffCard
                                    key={change.file}
                                    change={change}
                                    isExpanded={isExpanded}
                                    onToggle={() => {
                                      setExpandedFixFiles(prev => {
                                        const next = new Set(prev)
                                        if (next.has(change.file)) next.delete(change.file)
                                        else next.add(change.file)
                                        return next
                                      })
                                    }}
                                  />
                                )
                              })}
                            </div>
                          </>
                        ) : (
                          <div className="empty-ok">
                            <span className="ok-icon">✓</span>
                            <p>No changes needed — the pack is already compatible with <b>{fixTarget}</b>.</p>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
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
                                <span className="ide-problem-source">{group.path === 'pack.mcmeta' ? 'metadata' : 'spyglassmc'}</span>
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

      {isDragging && (
        <div className="ide-drop-overlay" role="region" aria-label="Drop files to merge">
          <div className="ide-drop-card">
            <span className="ide-drop-icon">+</span>
            <span>Drop to merge into open pack</span>
            <span className="ide-drop-hint">Conflicts will ask before overwriting</span>
          </div>
        </div>
      )}
    </div>
  )
}
