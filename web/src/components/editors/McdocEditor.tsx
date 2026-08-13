import { useEffect, useMemo, useRef, useState } from 'react'
import {
  defaultValue,
  insertInList,
  moveListItem,
  removeAtPath,
  selectUnionOption,
  setAtPath,
  typeVisibleAt,
  type JsonPath,
  type JsonValue,
  type SimplifiedMcdocField,
  type SimplifiedMcdocType,
} from '../../ide/mcdoc-edit'
import { buildFormState, commitEdit } from './mcdoc-editor-logic'

const COMMIT_DEBOUNCE_MS = 300

interface McdocEditorProps {
  content: string
  /** Resolved root type, already version-filtered by the bridge. null = still resolving. */
  type: SimplifiedMcdocType | null
  version: string
  onChange: (next: string) => void
  onShowJson: () => void
}

interface EditorCtx {
  version: string
  setValue: (path: JsonPath, value: JsonValue) => void
  removeValue: (path: JsonPath) => void
  insertValue: (path: JsonPath, index: number, value: JsonValue) => void
  moveValue: (path: JsonPath, from: number, to: number) => void
  renameKey: (path: JsonPath, oldKey: string, newKey: string, value: JsonValue) => void
}

/** A human-readable label for a union member, leaning on a `type` discriminator
 *  field when present (recipe-style unions) and falling back to the kind. */
function unionOptionLabel(opt: SimplifiedMcdocType): string {
  if (opt.kind === 'literal') return `= ${String(opt.value)}`
  if (opt.kind === 'enum') {
    const head = opt.values.slice(0, 3).join(' | ')
    return `enum (${head}${opt.values.length > 3 ? '…' : ''})`
  }
  if (opt.kind === 'struct') {
    const disc = opt.fields.find(f => f.key === 'type')
    if (disc) {
      if (disc.type.kind === 'enum') return String(disc.type.values[0] ?? 'object')
      if (disc.type.kind === 'literal') return String(disc.type.value)
    }
    return 'object'
  }
  if (opt.kind === 'list') return 'list'
  if (opt.kind === 'map') return 'map'
  if (opt.kind === 'tuple') return 'tuple'
  if (opt.kind === 'primitive') return opt.name
  return opt.kind
}

function VersionBadges({ since, until }: { since?: string; until?: string }) {
  if (!since && !until) return null
  return (
    <span className="mcdoc-badges">
      {since && <span className="mcdoc-badge mcdoc-badge-since">since {since}</span>}
      {until && <span className="mcdoc-badge mcdoc-badge-until">until {until}</span>}
    </span>
  )
}

function pathsEqual(a: JsonPath | undefined, b: JsonPath | undefined): boolean {
  if (!a || !b) return false
  if (a.length !== b.length) return false
  return a.every((s, i) => s === b[i])
}

export default function McdocEditor({
  content,
  type,
  version,
  onChange,
  onShowJson,
}: McdocEditorProps) {
  const parsed = useMemo(() => buildFormState(content, type), [content, type])

  // Keep the latest content in a ref so a debounced commit always splices into
  // the most recent document text rather than a stale snapshot.
  const contentRef = useRef(content)
  contentRef.current = content
  const lastCommittedRef = useRef(content)

  const rootRef = useRef<JsonValue>(parsed.value ?? null)
  const [root, setRoot] = useState<JsonValue>(parsed.value ?? null)
  const pendingRef = useRef<{ timer?: number; path?: JsonPath; value?: JsonValue }>({})

  const doCommit = (path: JsonPath, value: JsonValue) => {
    const next = commitEdit(contentRef.current, type, path, value, rootRef.current)
    lastCommittedRef.current = next
    onChange(next)
  }

  // Edits to different paths within one debounce window must not clobber each
  // other: flush the previous path immediately before scheduling the new one.
  const scheduleCommit = (path: JsonPath, value: JsonValue) => {
    const pending = pendingRef.current
    if (pending.timer !== undefined && pending.path && !pathsEqual(pending.path, path)) {
      clearTimeout(pending.timer)
      pending.timer = undefined
      if (pending.value !== undefined) doCommit(pending.path, pending.value)
    }
    pendingRef.current = {
      timer: window.setTimeout(() => {
        pendingRef.current.timer = undefined
        doCommit(path, value)
      }, COMMIT_DEBOUNCE_MS),
      path,
      value,
    }
  }

  const applyOp = (
    path: JsonPath,
    value: JsonValue,
    op: 'set' | 'remove' | 'insert' | 'move' | 'rename',
    extra?: { index?: number; from?: number; to?: number; oldKey?: string; newKey?: string },
  ) => {
    // A null root (new/empty file, or type that resolved after mount) needs a
    // schema-conforming base before the first edit can be applied.
    if (rootRef.current === null) {
      rootRef.current = type ? defaultValue(type) : {}
    }
    let newRoot: JsonValue
    switch (op) {
      case 'set':
        newRoot = setAtPath(rootRef.current, path, value)
        break
      case 'remove':
        newRoot = removeAtPath(rootRef.current, path)
        break
      case 'insert':
        newRoot = insertInList(rootRef.current, path, extra?.index ?? 0, value)
        break
      case 'move':
        newRoot = moveListItem(rootRef.current, path, extra?.from ?? 0, extra?.to ?? 0)
        break
      case 'rename': {
        const without = removeAtPath(rootRef.current, [...path, extra?.oldKey as string])
        newRoot = setAtPath(without, [...path, extra?.newKey as string], value)
        break
      }
    }
    rootRef.current = newRoot
    setRoot(newRoot)
    scheduleCommit(path, value)
  }

  const ctx: EditorCtx = {
    version,
    setValue: (path, value) => applyOp(path, value, 'set'),
    removeValue: path => applyOp(path, null, 'remove'),
    insertValue: (path, index, value) => applyOp(path, value, 'insert', { index }),
    moveValue: (path, from, to) => applyOp(path, null, 'move', { from, to }),
    renameKey: (path, oldKey, newKey, value) => applyOp(path, value, 'rename', { oldKey, newKey }),
  }

  // Re-sync from external content changes (JSON toggle round-trip, version
  // switch that rewrote the doc) but never while a local edit is in flight.
  useEffect(() => {
    if (pendingRef.current.timer !== undefined) return
    if (content === lastCommittedRef.current) return
    const fresh = buildFormState(content, type)
    if (fresh.error) return
    rootRef.current = fresh.value
    setRoot(fresh.value)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [content])

  // Flush any pending edit on unmount so the last keystrokes are not lost.
  useEffect(() => {
    return () => {
      const pending = pendingRef.current
      if (pending.timer !== undefined) {
        clearTimeout(pending.timer)
        pending.timer = undefined
        if (pending.value !== undefined && pending.path) doCommit(pending.path, pending.value)
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ── States that short-circuit the form ──────────────────────────────────

  if (type === null) {
    return (
      <div className="mcdoc-form">
        <McdocHeader onShowJson={onShowJson} />
        <div className="mcdoc-form-body">
          <div className="mcdoc-resolving" role="status">
            <span className="mcdoc-resolving-dot" />
            Resolving type…
          </div>
        </div>
      </div>
    )
  }

  if (parsed.error) {
    return (
      <div className="mcdoc-form">
        <McdocHeader onShowJson={onShowJson} />
        <div className="mcdoc-form-body">
          <div className="mcdoc-error" role="alert">
            <span className="mcdoc-error-icon">!</span>
            <div className="mcdoc-error-body">
              <div className="mcdoc-error-title">This file is not valid JSON</div>
              <div className="mcdoc-error-detail">{parsed.error}</div>
            </div>
            <button type="button" className="mcdoc-btn-ghost" onClick={onShowJson}>
              Open in JSON view
            </button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="mcdoc-form">
      <McdocHeader onShowJson={onShowJson} />
      <div className="mcdoc-form-body">
        {renderNode(type, root, [], ctx)}
      </div>
    </div>
  )
}

function McdocHeader({ onShowJson }: { onShowJson: () => void }) {
  return (
    <div className="mcdoc-form-head">
      <div className="mcdoc-form-title">
        <span className="mcdoc-form-name">mcdoc</span>
        <span className="mcdoc-badge mcdoc-badge-schema">schema form</span>
      </div>
      <button type="button" className="mcdoc-btn-ghost" onClick={onShowJson}>
        Show JSON
      </button>
    </div>
  )
}

// ── Recursive renderer ─────────────────────────────────────────────────────

function renderNode(
  type: SimplifiedMcdocType,
  value: JsonValue,
  path: JsonPath,
  ctx: EditorCtx,
) {
  // A missing/null value gets a schema-conforming placeholder so every input
  // has something controlled to bind to.
  const v: JsonValue = value === undefined || value === null ? defaultValue(type) : value

  switch (type.kind) {
    case 'struct':
      return renderStruct(type, v, path, ctx)
    case 'union':
      return renderUnion(type, v, path, ctx)
    case 'list':
      return renderList(type, v, path, ctx)
    case 'tuple':
      return renderTuple(type, v, path, ctx)
    case 'enum':
      return renderEnum(type, v, path, ctx)
    case 'literal':
      return (
        <span className="mcdoc-literal-chip" key={pathKey(path)}>
          {String(type.value)}
        </span>
      )
    case 'map':
      return renderMap(type, v, path, ctx)
    case 'primitive':
      return renderPrimitive(type, v, path, ctx, false)
  }
}

function pathKey(path: JsonPath): string {
  return path.length ? path.join('.') : '$'
}

function renderStruct(
  type: SimplifiedMcdocType & { kind: 'struct' },
  value: JsonValue,
  path: JsonPath,
  ctx: EditorCtx,
) {
  const obj: Record<string, JsonValue> =
    value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, JsonValue>) : {}
  const required = type.fields.filter(f => f.required && typeVisibleAt(f, ctx.version))
  const optional = type.fields.filter(f => !f.required && typeVisibleAt(f, ctx.version))

  return (
    <div className="mcdoc-struct" key={pathKey(path)}>
      {required.length > 0 && renderFieldGroup('Required', required, obj, path, ctx, false)}
      {optional.length > 0 && renderFieldGroup('Optional', optional, obj, path, ctx, true)}
      {required.length === 0 && optional.length === 0 && (
        <div className="mcdoc-muted">No fields.</div>
      )}
    </div>
  )
}

function renderFieldGroup(
  label: string,
  fields: SimplifiedMcdocField[],
  obj: Record<string, JsonValue>,
  path: JsonPath,
  ctx: EditorCtx,
  optionalGroup: boolean,
) {
  return (
    <div className="mcdoc-group">
      <div className="mcdoc-group-label">{label}</div>
      {fields.map(field => {
        const fieldPath = [...path, field.key]
        const present = field.key in obj
        return (
          <div className="mcdoc-field" key={field.key}>
            <div className="mcdoc-field-head">
              <label className="mcdoc-field-label">{field.key}</label>
              <VersionBadges since={field.since} until={field.until} />
              <span className="mcdoc-field-actions">
                {optionalGroup && !present && (
                  <button
                    type="button"
                    className="mcdoc-icon-btn"
                    title={`Add ${field.key}`}
                    onClick={() => ctx.setValue(fieldPath, defaultValue(field.type))}
                  >
                    +
                  </button>
                )}
                {optionalGroup && present && (
                  <button
                    type="button"
                    className="mcdoc-icon-btn"
                    title={`Remove ${field.key}`}
                    onClick={() => ctx.removeValue(fieldPath)}
                  >
                    ×
                  </button>
                )}
              </span>
            </div>
            {present ? (
              renderNode(field.type, obj[field.key], fieldPath, ctx)
            ) : (
              <div className="mcdoc-muted">absent</div>
            )}
          </div>
        )
      })}
    </div>
  )
}

function renderUnion(
  type: SimplifiedMcdocType & { kind: 'union' },
  value: JsonValue,
  path: JsonPath,
  ctx: EditorCtx,
) {
  const currentIdx = selectUnionOption(type, value)
  const safeIdx = currentIdx >= 0 && currentIdx < type.options.length ? currentIdx : 0

  return (
    <div className="mcdoc-union" key={pathKey(path)}>
      <select
        className="mcdoc-select"
        value={safeIdx}
        onChange={e => {
          const i = Number(e.target.value)
          ctx.setValue(path, defaultValue(type.options[i]))
        }}
      >
        {type.options.map((o, i) => (
          <option key={i} value={i} disabled={!typeVisibleAt(o, ctx.version)}>
            {unionOptionLabel(o)}
            {o.since ? ` (since ${o.since})` : ''}
            {o.until ? ` (until ${o.until})` : ''}
          </option>
        ))}
      </select>
      {renderNode(type.options[safeIdx], value, path, ctx)}
    </div>
  )
}

function renderList(
  type: SimplifiedMcdocType & { kind: 'list' },
  value: JsonValue,
  path: JsonPath,
  ctx: EditorCtx,
) {
  const arr = Array.isArray(value) ? value : []
  return (
    <div className="mcdoc-list" key={pathKey(path)}>
      {arr.map((item, i) => (
        <div className="mcdoc-list-row" key={i}>
          <span className="mcdoc-list-controls">
            <button
              type="button"
              className="mcdoc-icon-btn"
              title="Move up"
              disabled={i === 0}
              onClick={() => ctx.moveValue(path, i, i - 1)}
            >
              ↑
            </button>
            <button
              type="button"
              className="mcdoc-icon-btn"
              title="Move down"
              disabled={i === arr.length - 1}
              onClick={() => ctx.moveValue(path, i, i + 1)}
            >
              ↓
            </button>
            <button
              type="button"
              className="mcdoc-icon-btn"
              title="Remove"
              onClick={() => ctx.removeValue([...path, i])}
            >
              ×
            </button>
          </span>
          {renderNode(type.item, item, [...path, i], ctx)}
        </div>
      ))}
      <button
        type="button"
        className="mcdoc-add"
        onClick={() => ctx.insertValue(path, arr.length, defaultValue(type.item))}
      >
        + Add item
      </button>
    </div>
  )
}

function renderTuple(
  type: SimplifiedMcdocType & { kind: 'tuple' },
  value: JsonValue,
  path: JsonPath,
  ctx: EditorCtx,
) {
  const arr = Array.isArray(value) ? value : []
  return (
    <div className="mcdoc-tuple" key={pathKey(path)}>
      {type.items.map((item, i) => (
        <div className="mcdoc-tuple-row" key={i}>
          <span className="mcdoc-tuple-idx">[{i}]</span>
          {renderNode(item, arr[i], [...path, i], ctx)}
        </div>
      ))}
    </div>
  )
}

function renderEnum(
  type: SimplifiedMcdocType & { kind: 'enum' },
  value: JsonValue,
  path: JsonPath,
  ctx: EditorCtx,
) {
  const current = typeof value === 'string' ? value : type.values[0] ?? ''
  return (
    <select
      className="mcdoc-select"
      key={pathKey(path)}
      value={current}
      onChange={e => ctx.setValue(path, e.target.value)}
    >
      {type.values.map(v => (
        <option key={v} value={v}>
          {v}
        </option>
      ))}
    </select>
  )
}

function renderMap(
  type: SimplifiedMcdocType & { kind: 'map' },
  value: JsonValue,
  path: JsonPath,
  ctx: EditorCtx,
) {
  const obj: Record<string, JsonValue> =
    value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, JsonValue>) : {}
  const keys = Object.keys(obj)
  return (
    <div className="mcdoc-map" key={pathKey(path)}>
      {keys.map(k => (
        <div className="mcdoc-map-row" key={k}>
          <input
            className="mcdoc-input mcdoc-map-key"
            value={k}
            spellCheck={false}
            onChange={e => {
              const nk = e.target.value
              if (nk && nk !== k) ctx.renameKey(path, k, nk, obj[k])
            }}
          />
          <button
            type="button"
            className="mcdoc-icon-btn"
            title="Remove entry"
            onClick={() => ctx.removeValue([...path, k])}
          >
            ×
          </button>
          {renderNode(type.value, obj[k], [...path, k], ctx)}
        </div>
      ))}
      <button
        type="button"
        className="mcdoc-add"
        onClick={() => {
          const nk = `key${keys.length + 1}`
          ctx.setValue([...path, nk], defaultValue(type.value))
        }}
      >
        + Add entry
      </button>
    </div>
  )
}

// Registry hints: the current SimplifiedMcdocType model does NOT carry a
// registry id (no `registry` field on primitives or struct fields), so we
// render plain text/number inputs for id-ish strings. When the bridge starts
// attaching registry hints, this is where a <select> populated from
// fetchRegistries(version) would replace the text input.
function renderPrimitive(
  type: SimplifiedMcdocType & { kind: 'primitive' },
  value: JsonValue,
  path: JsonPath,
  ctx: EditorCtx,
  optional: boolean,
) {
  const name = type.name.toLowerCase()

  if (name.includes('bool')) {
    const checked = value === true
    return (
      <input
        key={pathKey(path)}
        type="checkbox"
        className="mcdoc-check"
        checked={checked}
        onChange={e => ctx.setValue(path, e.target.checked)}
      />
    )
  }

  if (name.includes('int') || name.includes('float') || name.includes('double') || name.includes('long')) {
    const num = typeof value === 'number' ? value : ''
    return (
      <input
        key={pathKey(path)}
        type="number"
        className="mcdoc-input"
        value={num}
        spellCheck={false}
        onChange={e => {
          const raw = e.target.value
          if (raw === '') {
            if (optional) ctx.removeValue(path)
            else ctx.setValue(path, 0)
          } else {
            ctx.setValue(path, Number(raw))
          }
        }}
      />
    )
  }

  const str = typeof value === 'string' ? value : ''
  return (
    <input
      key={pathKey(path)}
      type="text"
      className="mcdoc-input"
      value={str}
      spellCheck={false}
      onChange={e => {
        const raw = e.target.value
        if (raw === '' && optional) ctx.removeValue(path)
        else ctx.setValue(path, raw)
      }}
    />
  )
}
