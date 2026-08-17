import { useCallback, useEffect, useRef, useState } from 'react'
import Editor, { type BeforeMount, type OnMount } from '@monaco-editor/react'
import type { JsonValue, JsonPath, SimplifiedMcdocType } from '../../ide/mcdoc-edit'
import type { McmetaVersion, Mode } from '../../api'
import type { SpyglassService } from '../../engine/spyglass-service'
import { useResolvedMcdocType } from '../../ide/use-mcdoc-type'
import RecipeEditor from './specialized/RecipeEditor'
import AdvancementEditor from './specialized/AdvancementEditor'
import LootTableEditor from './specialized/LootTableEditor'
import PredicateEditor from './specialized/PredicateEditor'
import TagEditor from './specialized/TagEditor'
import McmetaEditor from './McmetaEditor'

export type SplitKind = 'recipe' | 'advancement' | 'loot_table' | 'predicate' | 'tag' | 'mcmeta'
export type ViewMode = 'split' | 'source' | 'gui'

interface SplitEditorProps {
  activePath: string
  initialContent: string
  kind: SplitKind
  versions: McmetaVersion[]
  mode: Mode
  /** True once the Spyglass language service is ready to resolve mcdoc types. */
  spyglassReady: boolean
  /** Shared Spyglass service ref used to resolve the mcdoc root type. */
  serviceRef: React.MutableRefObject<SpyglassService | null>
  /** Concrete Minecraft version used for since/until field gating in the form. */
  version: string
  /** Width of the JSON (left) pane as a percentage; lifted to the parent so it
   *  persists across file switches (mirrors the bottom panel splitter). */
  leftPct: number
  onLeftPctChange: (pct: number) => void
  onCommit: (next: string) => void
  beforeMount: BeforeMount
  onMount: OnMount
}

const COMMIT_MS = 250

function safeParse(text: string): JsonValue {
  try {
    return JSON.parse(text) as JsonValue
  } catch {
    return {}
  }
}

function setAtPath(root: JsonValue, segments: JsonPath, value: JsonValue): JsonValue {
  if (segments.length === 0) return value
  const [head, ...rest] = segments
  if (typeof head === 'number') {
    const arr: JsonValue[] = Array.isArray(root) ? (root as JsonValue[]).slice() : []
    while (arr.length <= head) arr.push(null)
    arr[head] = setAtPath((arr[head] as JsonValue) ?? null, rest, value)
    return arr
  }
  const obj: Record<string, JsonValue> =
    root && typeof root === 'object' && !Array.isArray(root)
      ? { ...(root as Record<string, JsonValue>) }
      : {}
  obj[head] = setAtPath((obj[head] as JsonValue) ?? null, rest, value)
  return obj
}

// misode-style dual view: left = raw JSON (Monaco), right = visual form, both
// kept in sync. Typing on either side is debounced before being committed to
// the parent, so the rest of the IDE does not re-render on every keystroke.
//
// The visual form is rendered by the mcdoc-driven McdocEditor whenever the
// mcdoc root type is available — this builds a complete, schema-accurate form
// straight from the resolved type (exactly how misode generates its GUI view,
// so every field in the JSON is editable). If the type cannot be resolved
// (e.g. the language service is unavailable), we fall back to the hand-written
// editor so the form still works.
export default function SplitEditor({
  activePath,
  initialContent,
  kind,
  versions,
  mode,
  spyglassReady,
  serviceRef,
  version,
  leftPct,
  onLeftPctChange,
  onCommit,
  beforeMount,
  onMount,
}: SplitEditorProps) {
  const [viewMode, setViewMode] = useState<ViewMode>('split')
  const [jsonText, setJsonText] = useState(initialContent)
  const [formDoc, setFormDoc] = useState<JsonValue>(() => safeParse(initialContent))
  const [parseError, setParseError] = useState<string | null>(null)
  // Width of the left (JSON) pane comes from the parent (leftPct) so the split
  // position persists across file switches, like the bottom panel splitter.
  const bodyRef = useRef<HTMLDivElement | null>(null)

  const jsonTextRef = useRef(jsonText)
  jsonTextRef.current = jsonText
  const commitTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const onCommitRef = useRef(onCommit)
  onCommitRef.current = onCommit

  const scheduleCommit = useCallback((text: string) => {
    if (commitTimer.current) clearTimeout(commitTimer.current)
    commitTimer.current = setTimeout(() => onCommitRef.current(text), COMMIT_MS)
  }, [])

  // Drag the divider between the JSON pane and the form pane to resize them.
  const startSplitResize = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault()
    const bodyEl = bodyRef.current
    if (!bodyEl) return
    const rect = bodyEl.getBoundingClientRect()
    const startX = e.clientX
    const startPct = leftPct
    const onMove = (ev: PointerEvent) => {
      const dx = ev.clientX - startX
      const pct = Math.min(Math.max(startPct + (dx / rect.width) * 100, 20), 80)
      onLeftPctChange(pct)
    }
    const onUp = () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }, [leftPct, onLeftPctChange])

  // Resolve the mcdoc root type for this file (recipe / advancement / loot_table /
  // predicate / tag). This is the same type misode uses to build its form.
  // mcdoc type resolution is intentionally NOT consumed: the mcdoc-driven
  // McdocEditor does not render reliably once Spyglass loads, so the editor
  // keeps using the hand-written fallback editors (pre-Spyglass behaviour).
  useResolvedMcdocType({
    path: activePath,
    formView: viewMode !== 'source',
    spyglassReady,
    serviceRef,
    content: jsonText,
  })

  // Parse JSON without throwing; returns null on invalid input so callers
  // can decide whether to apply the result (we don't want a transient typo
  // while typing to blank out the visual form).
  const tryParse = (text: string): JsonValue | null => {
    try {
      return JSON.parse(text) as JsonValue
    } catch {
      return null
    }
  }

  const handleJsonChange = useCallback(
    (value: string | undefined) => {
      const next = value ?? ''
      setJsonText(next)
      // Keep the hand-written fallback form (used when the mcdoc type is
      // unavailable) in sync with the JSON the user is typing. Without this,
      // editing the JSON pane never reflected in the visual form.
      const parsed = tryParse(next)
      if (parsed !== null) setFormDoc(parsed)
      setParseError(null)
      scheduleCommit(next)
    },
    [scheduleCommit],
  )

  // The mcdoc / mcmeta editors emit a full JSON string on every edit.
  const handleFormStringChange = useCallback(
    (next: string) => {
      setJsonText(next)
      const parsed = tryParse(next)
      if (parsed !== null) setFormDoc(parsed)
      setParseError(null)
      scheduleCommit(next)
    },
    [scheduleCommit],
  )

  // The hand-written fallback editors emit partial edits as (path, value).
  const handleFormChange = useCallback(
    (path: JsonPath, value: JsonValue) => {
      setFormDoc(prev => {
        const next = setAtPath(prev, path, value)
        const serialized = JSON.stringify(next, null, 2)
        setJsonText(serialized)
        scheduleCommit(serialized)
        return next
      })
    },
    [scheduleCommit],
  )

  // Re-sync when the parent swaps the active file or the JSON is changed
  // externally (e.g. recipe preset load, format button).
  useEffect(() => {
    setJsonText(initialContent)
    setFormDoc(safeParse(initialContent))
    setParseError(null)
  }, [initialContent])

  // Flush a pending edit when switching files so the last keystrokes are kept.
  useEffect(() => {
    return () => {
      if (commitTimer.current) clearTimeout(commitTimer.current)
      onCommitRef.current(jsonTextRef.current)
    }
  }, [])

  const renderForm = () => {
    if (kind === 'mcmeta') {
      return (
        <McmetaEditor
          content={jsonText}
          onChange={handleFormStringChange}
          versions={versions}
          mode={mode}
          onShowJson={() => {}}
        />
      )
    }
    // Hand-written editors for every specialized file kind. The mcdoc-driven
    // McdocEditor is intentionally disabled: after Spyglass loads it does not
    // render reliably, whereas these fallback editors behave exactly as they
    // did before Spyglass loaded.
    switch (kind) {
      case 'recipe':
        return <RecipeEditor type={null} value={formDoc} path={[]} onChange={handleFormChange} onRemove={() => {}} />
      case 'advancement':
        return <AdvancementEditor type={null} value={formDoc} path={[]} onChange={handleFormChange} onRemove={() => {}} />
      case 'loot_table':
        return <LootTableEditor type={null} value={formDoc} path={[]} onChange={handleFormChange} onRemove={() => {}} />
      case 'predicate':
        return <PredicateEditor type={null} value={formDoc} path={[]} onChange={handleFormChange} onRemove={() => {}} />
      case 'tag':
        return <TagEditor type={null} value={formDoc} path={[]} onChange={handleFormChange} onRemove={() => {}} />
    }
    return <div className="mcdoc-loading">No schema available for this file.</div>
  }

  return (
    <div className={`ide-split ide-split-${viewMode}`}>
      <div className="ide-split-bar">
        <div className="ide-split-modes" role="group" aria-label="Editor view mode">
          <button
            type="button"
            className={viewMode === 'split' ? 'active' : ''}
            onClick={() => setViewMode('split')}
            title="Show JSON and form side by side"
          >
            Split
          </button>
          <button
            type="button"
            className={viewMode === 'source' ? 'active' : ''}
            onClick={() => setViewMode('source')}
            title="Show raw JSON only"
          >
            Source
          </button>
          <button
            type="button"
            className={viewMode === 'gui' ? 'active' : ''}
            onClick={() => setViewMode('gui')}
            title="Show visual form only"
          >
            GUI
          </button>
        </div>
        {parseError && <span className="ide-split-parse-error">{parseError}</span>}
      </div>
      <div className="ide-split-body" ref={bodyRef}>
      {viewMode !== 'gui' && (
        <div
          className="ide-split-left"
          style={viewMode === 'split' ? { flex: `0 0 ${leftPct}%`, maxWidth: `${leftPct}%` } : undefined}
        >
          <Editor
            path={`file:///pack/${activePath}`}
            beforeMount={beforeMount}
            onMount={onMount}
            language="json"
            value={jsonText}
            onChange={handleJsonChange}
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
        </div>
      )}
      {viewMode === 'split' && (
        <div
          className="ide-split-divider"
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize JSON and form panes"
          onPointerDown={startSplitResize}
        />
      )}
      {viewMode !== 'source' && (
        <div className="ide-split-right" style={viewMode === 'split' ? { flex: '1 1 auto' } : undefined}>
          {renderForm()}
        </div>
      )}
      </div>
    </div>
  )
}
