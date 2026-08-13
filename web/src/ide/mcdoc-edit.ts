/**
 * mcdoc-edit — Dependency-free editing engine for the generic visual mcdoc
 * form (Milestone 3.1).
 *
 * This module knows nothing about Spyglass, React, or Monaco. It operates on a
 * SimplifiedMcdocType schema and plain JSON values: schema-driven defaults,
 * immutable JSON-pointer-style path edits, union membership selection, subtree
 * serialization, and version gating. The McdocEditor renderer and the
 * SpyglassService type extractor build on top of these pure functions.
 */

// ─── Simplified schema model ────────────────────────────────────────────────

export interface SimplifiedMcdocField {
  key: string
  type: SimplifiedMcdocType
  required: boolean
  since?: string
  until?: string
}

export type SimplifiedMcdocType =
  | { kind: 'struct'; fields: SimplifiedMcdocField[]; since?: string; until?: string }
  | { kind: 'union'; options: SimplifiedMcdocType[]; since?: string; until?: string }
  | { kind: 'list'; item: SimplifiedMcdocType; since?: string; until?: string }
  | { kind: 'tuple'; items: SimplifiedMcdocType[]; since?: string; until?: string }
  | { kind: 'enum'; values: string[]; since?: string; until?: string }
  | { kind: 'literal'; value: string | number | boolean; since?: string; until?: string }
  | { kind: 'map'; value: SimplifiedMcdocType; key?: SimplifiedMcdocType; since?: string; until?: string }
  | { kind: 'primitive'; name: string; since?: string; until?: string; registry?: string }

export type JsonValue = string | number | boolean | null | JsonValue[] | { [k: string]: JsonValue }

/** A JSON-pointer path: object keys are strings, array indices are numbers. */
export type PathSegment = string | number
export type JsonPath = PathSegment[]

// ─── Version gating ─────────────────────────────────────────────────────────

/** Compare two version-ish strings ("1.20", "1.20.3"). Returns -1/0/1. */
export function compareVersions(a: string, b: string): number {
  const pa = parseVersion(a)
  const pb = parseVersion(b)
  for (let i = 0; i < 3; i++) {
    const da = pa[i] ?? 0
    const db = pb[i] ?? 0
    if (da !== db) return da < db ? -1 : 1
  }
  return 0
}

function parseVersion(v: string): number[] {
  const parts = v.split('.')
  return parts.map(p => {
    const n = parseInt(p, 10)
    return Number.isFinite(n) ? n : 0
  })
}

/** Is a type (with since/until) visible for the given game version string? */
export function typeVisibleAt(type: { since?: string; until?: string }, version: string): boolean {
  if (type.since && compareVersions(version, type.since) < 0) return false
  if (type.until && compareVersions(version, type.until) > 0) return false
  return true
}

// ─── Path safety ────────────────────────────────────────────────────────────

/** A path is JSON-pointer-safe when every segment is non-empty and array
 *  indices (when known) are non-negative integers. */
export function isJsonPointerSafe(path: JsonPath): boolean {
  return path.every(seg => {
    if (typeof seg === 'number') return Number.isInteger(seg) && seg >= 0
    return typeof seg === 'string' && seg.length > 0
  })
}

// ─── Immutable path reads/writes on plain JSON ─────────────────────────────

export function getAtPath(root: JsonValue | undefined, path: JsonPath): JsonValue | undefined {
  let cur: JsonValue | undefined = root
  for (const seg of path) {
    if (cur === null || typeof cur !== 'object') return undefined
    if (Array.isArray(cur)) {
      const idx = typeof seg === 'number' ? seg : parseInt(seg, 10)
      if (!Number.isInteger(idx)) return undefined
      cur = cur[idx]
    } else {
      cur = (cur as Record<string, JsonValue>)[String(seg)]
    }
  }
  return cur
}

function cloneNode(v: JsonValue | undefined): JsonValue | undefined {
  if (v === undefined) return undefined
  return JSON.parse(JSON.stringify(v)) as JsonValue
}

/** Immutable set at a path, creating missing ancestor containers. Returns a
 *  new root; the original is never mutated. */
export function setAtPath(root: JsonValue, path: JsonPath, value: JsonValue): JsonValue {
  if (!isJsonPointerSafe(path)) throw new Error('Unsafe JSON path')
  const copy = cloneNode(root) as JsonValue
  let cur: any = copy
  for (let i = 0; i < path.length - 1; i++) {
    const seg = path[i]
    const next = path[i + 1]
    const isNextArray = typeof next === 'number'
    let child = (cur as any)[seg]
    if (child === null || typeof child !== 'object') {
      child = isNextArray ? [] : {}
      ;(cur as any)[seg] = child
    }
    cur = child
  }
  const last = path[path.length - 1]
  ;(cur as any)[last] = cloneNode(value)
  return copy
}

/** Immutable deletion at a path. Returns a new root (or the original root when
 *  nothing was found at that path). */
export function removeAtPath(root: JsonValue, path: JsonPath): JsonValue {
  if (path.length === 0) return root
  if (!isJsonPointerSafe(path)) throw new Error('Unsafe JSON path')
  const copy = cloneNode(root) as JsonValue
  let cur: any = copy
  for (let i = 0; i < path.length - 1; i++) {
    const child = (cur as any)[path[i]]
    if (child === null || typeof child !== 'object') return root
    cur = child
  }
  const last = path[path.length - 1]
  if (Array.isArray(cur)) {
    const idx = typeof last === 'number' ? last : parseInt(String(last), 10)
    if (Number.isInteger(idx) && idx >= 0 && idx < cur.length) cur.splice(idx, 1)
    else return root
  } else if (last in cur) {
    delete cur[last]
  } else {
    return root
  }
  return copy
}

/** Insert a value into an array at an index (negative/out-of-range clamps). */
export function insertInList(root: JsonValue, path: JsonPath, index: number, value: JsonValue): JsonValue {
  const arr = getAtPath(root, path)
  if (!Array.isArray(arr)) return root
  const copy = cloneNode(root) as JsonValue
  const target = getAtPath(copy, path) as JsonValue[]
  const idx = Math.max(0, Math.min(index, target.length))
  target.splice(idx, 0, cloneNode(value) as JsonValue)
  return copy
}

/** Move an array item from one index to another (within bounds). */
export function moveListItem(root: JsonValue, path: JsonPath, from: number, to: number): JsonValue {
  const arr = getAtPath(root, path)
  if (!Array.isArray(arr)) return root
  if (from < 0 || from >= arr.length) return root
  const copy = cloneNode(root) as JsonValue
  const target = getAtPath(copy, path) as JsonValue[]
  const [item] = target.splice(from, 1)
  const dest = Math.max(0, Math.min(to, target.length))
  target.splice(dest, 0, item)
  return copy
}

// ─── Schema defaults ────────────────────────────────────────────────────────

export interface DefaultOptions {
  /** When a union picks an option by index (default: first non-null). */
  unionOption?: number
  /** Enums resolve to this value when given (default: first value). */
  enumValue?: string
}

/** Produce a schema-conforming default for a type. Never mutates the type. */
export function defaultValue(type: SimplifiedMcdocType, opts: DefaultOptions = {}): JsonValue {
  switch (type.kind) {
    case 'struct': {
      const out: Record<string, JsonValue> = {}
      for (const f of type.fields) {
        if (f.required) out[f.key] = defaultValue(f.type, opts)
      }
      return out
    }
    case 'union': {
      if (type.options.length === 0) return null
      const preferNonNull = opts.unionOption ?? type.options.findIndex(o => o.kind !== 'literal')
      const idx = Math.min(Math.max(preferNonNull === -1 ? 0 : preferNonNull, 0), type.options.length - 1)
      return defaultValue(type.options[idx], opts)
    }
    case 'list':
      return []
    case 'tuple':
      return type.items.map(t => defaultValue(t, opts))
    case 'enum':
      return opts.enumValue ?? type.values[0] ?? ''
    case 'literal':
      return type.value
    case 'map':
      return {}
    case 'primitive':
      return primitiveDefault(type.name)
    default:
      return null
  }
}

function primitiveDefault(name: string): JsonValue {
  const n = name.toLowerCase()
  if (n.includes('bool')) return false
  if (n.includes('float') || n.includes('double')) return 0
  if (n.includes('int')) return 0
  return ''
}

/** Default for a struct field, honoring required-ness. */
export function defaultForField(field: SimplifiedMcdocField, opts: DefaultOptions = {}): JsonValue | undefined {
  return field.required ? defaultValue(field.type, opts) : undefined
}

// ─── Union membership ───────────────────────────────────────────────────────

/** Return a stable option index whose shape best matches a plain JSON value,
 *  so switching union branches preserves what the user already typed. */
export function selectUnionOption(type: SimplifiedMcdocType, value: JsonValue | undefined): number {
  if (type.kind !== 'union') return 0
  if (value === undefined || value === null) {
    const idx = type.options.findIndex(o => o.kind === 'literal' && o.value === null)
    return idx >= 0 ? idx : 0
  }
  const score = (o: SimplifiedMcdocType): number => {
    switch (o.kind) {
      case 'struct': {
        if (Array.isArray(value) || typeof value !== 'object' || value === null) return 0
        const keys = Object.keys(value)
        if (keys.length === 0) return 2
        // Prefer the branch whose fields actually overlap the value's keys,
        // e.g. {"id": ...} should select ItemStackTemplate over ItemResult.
        const overlap = keys.filter(k => o.fields.some(f => f.key === k)).length
        return 2 + overlap
      }
      case 'list': return Array.isArray(value) ? 2 : 0
      case 'map': return !Array.isArray(value) && typeof value === 'object' ? 2 : 0
      case 'tuple': return Array.isArray(value) ? 2 : 0
      case 'enum': return typeof value === 'string' && o.values.includes(value) ? 3 : 0
      case 'literal': return value === o.value ? 3 : 0
      case 'primitive':
        if (o.name.toLowerCase().includes('bool')) return typeof value === 'boolean' ? 2 : 0
        if (o.name.toLowerCase().includes('int') || o.name.toLowerCase().includes('float')) {
          return typeof value === 'number' ? 2 : 0
        }
        return typeof value === 'string' ? 2 : (typeof value === 'number' || typeof value === 'boolean' ? 1 : 0)
      default: return 0
    }
  }
  let best = 0
  let bestScore = -1
  type.options.forEach((o, i) => {
    const s = score(o)
    if (s > bestScore) { bestScore = s; best = i }
  })
  return best
}

// ─── Type walking ───────────────────────────────────────────────────────────

/**
 * Follow a path through the type tree and return the sub-type at that position
 * (mirrors how the plain JSON is traversed). Falls back to the representative
 * option for a union and the last item type for a tuple.
 */
export function typeAtPath(type: SimplifiedMcdocType, path: JsonPath): SimplifiedMcdocType {
  let cur = type
  for (const seg of path) {
    if (cur.kind === 'union') {
      cur = cur.options.find(o => o.kind !== 'literal') ?? cur.options[0] ?? { kind: 'primitive', name: 'unknown' }
    }
    if (cur.kind === 'struct') {
      const f = cur.fields.find(x => x.key === String(seg))
      cur = f ? f.type : cur
      continue
    }
    if (cur.kind === 'list') {
      cur = cur.item
      continue
    }
    if (cur.kind === 'tuple') {
      const idx = typeof seg === 'number' ? seg : parseInt(String(seg), 10)
      cur = cur.items[idx] ?? cur.items[cur.items.length - 1] ?? cur
      continue
    }
    if (cur.kind === 'map') {
      cur = cur.value
      continue
    }
    break
  }
  return cur
}

// ─── Serialization ──────────────────────────────────────────────────────────

/** Serialize the whole value (or a subtree) as indented JSON with a trailing
 *  newline, matching the project's pack file style. */
export function serializeJson(value: JsonValue, indent = 2): string {
  return JSON.stringify(value, null, indent) + '\n'
}

/** Serialize exactly one node to keep write-backs byte-stable where possible. */
export function serializeNode(value: JsonValue): string {
  return JSON.stringify(value)
}
