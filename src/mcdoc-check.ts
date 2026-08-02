import { readFileSync } from 'node:fs'
import { getNodeJsExternals } from '@spyglassmc/core/lib/nodejs.js'
import { getVanillaMcdoc } from '@spyglassmc/java-edition/lib/dependency/index.js'
import * as zlib from 'node:zlib'
import { getCache, setCache } from './cache.js'

// ---------------------------------------------------------------------------
// Version comparison (mcdoc uses the same release naming as Spyglass versions,
// e.g. "1.20.5", "26.1"). `until` is an EXCLUSIVE upper bound.
// ---------------------------------------------------------------------------

function parseVer(v: string): number[] | null {
  const m = v.match(/^(\d+)(?:\.(\d+))?(?:\.(\d+))?/)
  if (!m) return null
  return [parseInt(m[1], 10), m[2] ? parseInt(m[2], 10) : 0, m[3] ? parseInt(m[3], 10) : 0]
}

/** True when `v` has a trailing suffix after its numeric prefix (e.g. "26.3 Snapshot 1"). */
function hasVersionSuffix(v: string): boolean {
  const m = v.match(/^(\d+(?:\.\d+)*)/)
  if (!m) return false
  return m[0].length < v.trim().length
}

export function cmpVer(a: string, b: string): number {
  const pa = parseVer(a)
  const pb = parseVer(b)
  if (pa && pb) {
    for (let i = 0; i < 3; i++) {
      if (pa[i] !== pb[i]) return pa[i] < pb[i] ? -1 : 1
    }
    // Numerically equal: a suffix means pre-release (less than bare version)
    const aSuffix = hasVersionSuffix(a)
    const bSuffix = hasVersionSuffix(b)
    if (aSuffix && !bSuffix) return -1
    if (!aSuffix && bSuffix) return 1
    return 0
  }
  // Fall back to string compare for snapshots / unparsable values.
  return a < b ? -1 : a > b ? 1 : 0
}

/** True when `version` is within [since, until) — `until` exclusive. */
export function inRange(version: string, since?: string, until?: string): boolean {
  if (since && cmpVer(version, since) < 0) return false
  if (until && cmpVer(version, until) >= 0) return false
  return true
}

// ---------------------------------------------------------------------------
// Type model
// ---------------------------------------------------------------------------

export type TypeExpr =
  | { t: 'ref'; name: string }
  | { t: 'list'; of: TypeExpr }
  | { t: 'union'; opts: { since?: string; until?: string; of: TypeExpr }[] }
  | { t: 'prim' }
  | { t: 'literal' }

export interface FieldSpec {
  name: string
  optional: boolean
  since?: string
  until?: string
  type: TypeExpr
}

export interface StructDef {
  fields: FieldSpec[]
  spreads: string[] // ...Name references (resolved recursively)
  dispatchSpreads: { dispatch: string; key: string }[]
  allowUnknown: boolean // true if any spread/index-signature could not be resolved
}

export interface EnumVal {
  name: string
  literal: string
  since?: string
  until?: string
}

export interface EnumDef {
  values: EnumVal[]
}

export interface VariantOpt {
  since?: string
  until?: string
  struct?: StructDef
  ref?: string
}

export interface Variant {
  since?: string // tag-level gating (from #[] before `dispatch`)
  until?: string
  opts: VariantOpt[]
}

export interface DispatchDef {
  id: string
  variants: Map<string, Variant>
}

export interface SymbolTable {
  structs: Map<string, StructDef>
  enums: Map<string, EnumDef>
  typeAliases: Map<string, TypeExpr>
  dispatches: Map<string, DispatchDef>
}

// ---------------------------------------------------------------------------
// Raw tarball fetch + untar (always latest = self-updating)
// ---------------------------------------------------------------------------

async function fetchMcdocSources(): Promise<Map<string, string>> {
  const ext = getNodeJsExternals()
  const logger = {
    info() {}, warn() {}, error() {}, debug() {},
    children() { return this },
  } as any
  const dep: any = await getVanillaMcdoc(ext, logger)
  const buf = zlib.gunzipSync(Buffer.from(dep.data))
  const files = new Map<string, string>()
  let off = 0
  while (off + 512 <= buf.length) {
    const name = buf.toString('utf8', off, off + 100).replace(/\0.*$/, '')
    const sizeStr = buf.toString('utf8', off + 124, off + 136).replace(/\0.*$/, '')
    const size = parseInt(sizeStr.trim(), 8) || 0
    const typeflag = buf.toString('utf8', off + 156, off + 157)
    off += 512
    if (!name) break
    if (typeflag === '0' || typeflag === '') {
      files.set(name, buf.toString('utf8', off, off + size))
    }
    off += Math.ceil(size / 512) * 512
  }
  return files
}

// ---------------------------------------------------------------------------
// Parsing helpers
// ---------------------------------------------------------------------------

/** Split `str` by `sep` only at depth 0 (ignoring () [] {} and quotes). */
function splitTop(str: string, sep: string): string[] {
  const out: string[] = []
  let depth = 0
  let inStr: string | null = null
  let cur = ''
  for (let i = 0; i < str.length; i++) {
    const c = str[i]
    if (inStr) {
      cur += c
      if (c === inStr && str[i - 1] !== '\\') inStr = null
      continue
    }
    if (c === '"' || c === "'") { inStr = c; cur += c; continue }
    if (c === '(' || c === '[' || c === '{') depth++
    else if (c === ')' || c === ']' || c === '}') depth--
    if (depth === 0 && str.startsWith(sep, i)) {
      out.push(cur)
      cur = ''
      i += sep.length - 1
      continue
    }
    cur += c
  }
  if (cur.trim() !== '' || out.length > 0) out.push(cur)
  return out
}

function stripComments(s: string): string {
  return s
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/\/\/\/[^\n]*/g, ' ')
    .replace(/\/\/[^\n]*/g, ' ')
}

/** id attributes (`#[id]`, `#[id="x"]`, `#[id(...)]`) carry registry info only —
 *  the structural checker doesn't need them, but they must be stripped so
 *  trailing names parse as plain refs/prims. */
const ID_ATTR_RE = /#\[id(?:=(?:"[^"]*"|\([^)]*\)))?\]|#\[id\([^)]*\)\]/g

function stripAttrs(s: string): { attrs: { since?: string; until?: string }; rest: string } {
  const attrs: { since?: string; until?: string } = {}
  let rest = s
  const re = /#\[(since|until)="([^"]+)"\]/g
  let m: RegExpMatchArray | null
  while ((m = re.exec(s)) !== null) {
    attrs[m[1] as 'since' | 'until'] = m[2]
  }
  rest = rest.replace(re, '').replace(ID_ATTR_RE, '').trim()
  return { attrs, rest }
}

/** Like stripAttrs, but only consumes `#[...]` at the very START of the
 *  string. Used for fields, where `#[...]` inside the type (e.g. union branches)
 *  must NOT be applied to the field itself. */
function stripLeadingAttrs(s: string): { attrs: { since?: string; until?: string }; rest: string } {
  const attrs: { since?: string; until?: string } = {}
  let rest = s
  let m: RegExpMatchArray | null
  while ((m = rest.match(/^(?:#\[(?:since|until)="[^"]+"\]|#\[id(?:=(?:"[^"]*"|\([^)]*\)))?\]|#\[id\([^)]*\)\])\s*/)) !== null) {
    const attrText = m[0]
    const am = /#\[(since|until)="([^"]+)"\]/.exec(attrText)
    if (am) attrs[am[1] as 'since' | 'until'] = am[2]
    rest = rest.slice(m[0].length)
  }
  return { attrs, rest }
}

/** Extract the balanced `{ ... }` body starting at the first `{`. */
function extractBraceBody(s: string): string | null {
  const start = s.indexOf('{')
  if (start < 0) return null
  let depth = 0
  for (let i = start; i < s.length; i++) {
    const c = s[i]
    if (c === '{') depth++
    else if (c === '}') {
      depth--
      if (depth === 0) return s.slice(start + 1, i)
    }
  }
  return null
}

function isBalanced(s: string): boolean {
  let depth = 0
  let inStr: string | null = null
  for (let i = 0; i < s.length; i++) {
    const c = s[i]
    if (inStr) {
      if (c === inStr && s[i - 1] !== '\\') inStr = null
      continue
    }
    if (c === '"' || c === "'") { inStr = c; continue }
    if (c === '{' || c === '(' || c === '[') depth++
    else if (c === '}' || c === ')' || c === ']') depth--
  }
  return depth === 0
}

/** Build a prim node. The concrete primitive name is stashed as a
 *  NON-enumerable property: tests assert `toEqual({ t: 'prim' })`, and
 *  non-enumerable props survive both toEqual and JSON.stringify (the latter
 *  deliberately drops them, so cached symbol tables just lose prim-kind and
 *  fall back to tolerant validation). */
function primNode(kind: string): TypeExpr {
  const node: TypeExpr = { t: 'prim' }
  Object.defineProperty(node, 'kind', {
    value: kind,
    enumerable: false,
    writable: false,
    configurable: true,
  })
  return node
}

/** Primitive kind of a type node, or undefined for non-prims / cached tables. */
function primKindOf(t: TypeExpr): string | undefined {
  return (t as { kind?: string }).kind
}

export function parseType(str: string): TypeExpr {
  const s = stripLeadingAttrs(stripComments(str)).rest.trim()
  if (s === '') return { t: 'prim' }
  if (s.startsWith('[') && s.endsWith(']')) {
    return { t: 'list', of: parseType(s.slice(1, -1)) }
  }
  if (s.startsWith('(') && s.endsWith(')')) {
    const inner = s.slice(1, -1)
    // Skip empty branches: upstream mcdoc files sometimes end unions with a
    // trailing `|` (e.g. instrument's use_duration), which would otherwise
    // produce a catch-all branch that swallows type validation.
    const opts = splitTop(inner, '|')
      .map(b => stripAttrs(b))
      .filter(({ rest }) => rest.trim() !== '')
      .map(({ attrs, rest }) => ({ since: attrs.since, until: attrs.until, of: parseType(rest) }))
    return { t: 'union', opts }
  }
  // string literal type
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
    return { t: 'literal' }
  }
  const primRe = /^(string|int|float|double|long|short|byte|bool|boolean|any|json|uint|literal)\b/
  const primMatch = primRe.exec(s)
  if (primMatch) return primNode(primMatch[1])
  // strip trailing generic args like Vector3<float>
  const name = s.replace(/<[^>]*>$/, '').trim()
  const primMatch2 = primRe.exec(name)
  if (primMatch2) return primNode(primMatch2[1])
  return { t: 'ref', name }
}

function parseStructBody(body: string): StructDef {
  const def: StructDef = { fields: [], spreads: [], dispatchSpreads: [], allowUnknown: false }
  const cleaned = stripComments(body)
  const chunks = splitTop(cleaned, ',').map(c => c.trim()).filter(c => c !== '')
  for (let chunk of chunks) {
    const { attrs, rest } = stripLeadingAttrs(chunk)
    if (rest === '') continue
    // dispatch spread: ...minecraft:X[[key]]
    let m = rest.match(/^\.\.\.(minecraft:[\w:]+)\[\[([^\]]*)\]\]/)
    if (m) {
      def.dispatchSpreads.push({ dispatch: m[1], key: m[2] })
      continue
    }
    // plain spread: ...Name
    if (rest.startsWith('...')) {
      def.spreads.push(rest.slice(3).trim())
      continue
    }
    // index signature: [ ... ]: Type  -> arbitrary keys allowed
    if (rest.startsWith('[')) {
      def.allowUnknown = true
      continue
    }
    // field: name? : type
    const fm = rest.match(/^([\w$]+)(\?)?\s*:\s*([\s\S]+)$/)
    if (fm) {
      def.fields.push({
        name: fm[1],
        optional: fm[2] === '?',
        since: attrs.since,
        until: attrs.until,
        type: parseType(fm[3]),
      })
      continue
    }
    // tolerate anything else (e.g. lone attribute line)
  }
  return def
}

function parseEnumBody(body: string): EnumDef {
  const def: EnumDef = { values: [] }
  const cleaned = stripComments(body)
  const cleaned2 = cleaned.replace(/enum\([^)]*\)/, '')
  const entries = splitTop(cleaned2, ',').map(c => c.trim()).filter(c => c !== '')
  for (const e of entries) {
    const { attrs, rest } = stripAttrs(e)
    const em = rest.match(/^([\w$]+)\s*=\s*("([^"]*)"|'([^']*)'|(\d+)|(-?\d+\.?\d*))/)
    if (em) {
      def.values.push({
        name: em[1],
        literal: em[3] ?? em[4] ?? em[5] ?? em[6] ?? em[1],
        since: attrs.since,
        until: attrs.until,
      })
    }
  }
  return def
}

/** Parse `dispatch ... to <rest>` into a Variant. */
function parseDispatchRest(rest: string, tagSince?: string, tagUntil?: string): Variant {
  const variant: Variant = { since: tagSince, until: tagUntil, opts: [] }
  const r = rest.trim()

  const parseOptBody = (body: string): VariantOpt => {
    const b = body.trim()
    if (b === '' || b === 'struct {}') return {}
    // inline struct?
    const braceStart = b.indexOf('{')
    if (b.startsWith('struct') && braceStart >= 0) {
      const inner = extractBraceBody(b)
      if (inner !== null) return { struct: parseStructBody(inner) }
    }
    if (b === 'struct') return {}
    // ref to a struct / alias
    const refName = b.replace(/^struct\s+/, '').replace(/\s*\{[^]*$/, '').trim()
    if (refName && /^[A-Za-z_]\w*$/.test(refName)) return { ref: refName }
    return {}
  }

  if (r.startsWith('(') && r.endsWith(')')) {
    const inner = r.slice(1, -1)
    const branches = splitTop(inner, '|')
    for (const br of branches) {
      const { attrs, rest: brRest } = stripAttrs(br)
      if (brRest.trim() === '') continue
      variant.opts.push({ since: attrs.since, until: attrs.until, ...parseOptBody(brRest) })
    }
    return variant
  }

  // Variant-level gating comes ONLY from the `#[...]` that preceded `dispatch`
  // (passed in as tagSince/tagUntil). Do NOT strip attrs from the whole body —
  // inner union branches carry their own gating, handled by parseStructBody.
  variant.opts.push({ since: tagSince, until: tagUntil, ...parseOptBody(r) })
  return variant
}

// ---------------------------------------------------------------------------
// Build the symbol table from all .mcdoc files
// ---------------------------------------------------------------------------

function buildSymbolTable(files: Map<string, string>): SymbolTable {
  const table: SymbolTable = {
    structs: new Map(),
    enums: new Map(),
    typeAliases: new Map(),
    dispatches: new Map(),
  }

  for (const content of files.values()) {
    let text = stripComments(content)
    // strip `use` statements (just alias imports; global lookup by simple name is enough)
    text = text.replace(/^\s*use\s+[^\n]*/gm, '')
    const lines = text.split('\n')

    // Top-level dispatch declarations (may span multiple lines until `to ...`)
    let i = 0
    let pendingAttrs = '' // a `#[since]/#[until]` line that precedes a definition
    while (i < lines.length) {
      const line = lines[i]
      // A line that is ONLY attribute(s) feeds the immediately following definition.
      if (/^\s*(#\[[^\]]*\]\s*)+$/.test(line)) {
        pendingAttrs = line
        i++
        continue
      }
      const fullLine = pendingAttrs + line
      pendingAttrs = ''

      const dispMatch = fullLine.match(
        /^(#\[[^\]]*\]\s*)*dispatch\s+(minecraft:[\w:]+)\[([^\]]*)\]\s+to\s+([\s\S]*)$/,
      )
      if (dispMatch) {
        const attrsRaw = dispMatch[1] ?? ''
        const { attrs } = stripAttrs(attrsRaw + ' dispatch')
        const id = dispMatch[2]
        const tag = dispMatch[3]
        let rest = dispMatch[4]
        // gather continuation lines until the `to ...` body is brace/paren-balanced
        while (i + 1 < lines.length && !isBalanced(rest)) {
          i++
          rest += '\n' + lines[i]
        }
        try {
          if (!table.dispatches.has(id)) table.dispatches.set(id, { id, variants: new Map() })
          const dd = table.dispatches.get(id)!
          dd.variants.set(tag, parseDispatchRest(rest, attrs.since, attrs.until))
        } catch { /* tolerate */ }
        i++
        continue
      }

      const structMatch = line.match(/^(?:export\s+)?(struct|interface)\s+([\w$]+)\s*(\{|<)/)
      if (structMatch) {
        const name = structMatch[2]
        // start the body AT the opening brace (don't slice it off)
        let body = line.slice(line.indexOf('{'))
        while (i + 1 < lines.length && extractBraceBody(body) === null) {
          i++
          body += '\n' + lines[i]
        }
        const inner = extractBraceBody(body)
        if (inner !== null) {
          try { table.structs.set(name, parseStructBody(inner)) } catch { /* tolerate */ }
        }
        i++
        continue
      }

      const enumMatch = line.match(/^enum\([^)]*\)\s+([\w$]+)\s*\{/)
      if (enumMatch) {
        const name = enumMatch[1]
        let body = line.slice(line.indexOf('{'))
        while (i + 1 < lines.length && extractBraceBody(body) === null) {
          i++
          body += '\n' + lines[i]
        }
        const inner = extractBraceBody(body)
        if (inner !== null) {
          try { table.enums.set(name, parseEnumBody(inner)) } catch { /* tolerate */ }
        }
        i++
        continue
      }

      const typeMatch = line.match(/^type\s+([\w$]+)\s*=\s*([\s\S]*)$/)
      if (typeMatch) {
        const name = typeMatch[1]
        let rest = typeMatch[2]
        // continue until the type expression is brace/paren-balanced
        while (i + 1 < lines.length && !isBalanced(rest)) {
          i++
          rest += '\n' + lines[i]
        }
        try { table.typeAliases.set(name, parseType(rest.replace(/;\s*$/, ''))) } catch { /* tolerate */ }
        i++
        continue
      }

      i++
    }
  }

  return table
}

// ---------------------------------------------------------------------------
// Public: get (cached) symbol table
// ---------------------------------------------------------------------------

let cachedTable: SymbolTable | null = null

/** Maps don't survive JSON.stringify, so convert to plain objects for caching.
 *  Prim nodes carry their concrete kind as a non-enumerable prop, which
 *  JSON.stringify drops — so primitives are re-serialized explicitly here and
 *  restored as non-enumerable again in plainToTable. */
function typeToPlain(t: TypeExpr): any {
  if (t.t === 'prim') {
    const kind = primKindOf(t)
    return kind ? { t: 'prim', kind } : { t: 'prim' }
  }
  if (t.t === 'list') return { t: 'list', of: typeToPlain(t.of) }
  if (t.t === 'union') return { t: 'union', opts: t.opts.map(o => ({ since: o.since, until: o.until, of: typeToPlain(o.of) })) }
  return t
}

function typeFromPlain(x: any): TypeExpr {
  if (x?.t === 'prim') return typeof x.kind === 'string' ? primNode(x.kind) : { t: 'prim' }
  if (x?.t === 'list') return { t: 'list', of: typeFromPlain(x.of) }
  if (x?.t === 'union') return { t: 'union', opts: x.opts.map((o: any) => ({ since: o.since, until: o.until, of: typeFromPlain(o.of) })) }
  return x as TypeExpr
}

function structToPlain(s: StructDef): any {
  return {
    fields: s.fields.map(f => ({ ...f, type: typeToPlain(f.type) })),
    spreads: s.spreads,
    dispatchSpreads: s.dispatchSpreads,
    allowUnknown: s.allowUnknown,
  }
}

function structFromPlain(s: any): StructDef {
  return {
    fields: (s.fields as any[]).map((f: any) => ({ ...f, type: typeFromPlain(f.type) })),
    spreads: s.spreads,
    dispatchSpreads: s.dispatchSpreads,
    allowUnknown: s.allowUnknown,
  }
}

function tableToPlain(t: SymbolTable): any {
  const structs: Record<string, any> = {}
  for (const [k, v] of t.structs) structs[k] = structToPlain(v)
  const aliases: Record<string, any> = {}
  for (const [k, v] of t.typeAliases) aliases[k] = typeToPlain(v)
  const dispatches: Record<string, any> = {}
  for (const [id, d] of t.dispatches) {
    const variants: Record<string, any> = {}
    for (const [tag, v] of d.variants) {
      variants[tag] = {
        since: v.since,
        until: v.until,
        opts: v.opts.map(o => ({
          since: o.since,
          until: o.until,
          struct: o.struct ? structToPlain(o.struct) : undefined,
          ref: o.ref,
        })),
      }
    }
    dispatches[id] = { id, variants }
  }
  return { structs, enums: Object.fromEntries(t.enums), typeAliases: aliases, dispatches }
}

function plainToTable(p: any): SymbolTable {
  const t: SymbolTable = {
    structs: new Map(),
    enums: new Map(),
    typeAliases: new Map(),
    dispatches: new Map(),
  }
  for (const [k, v] of Object.entries(p.structs)) t.structs.set(k, structFromPlain(v) as StructDef)
  for (const [k, v] of Object.entries(p.enums)) t.enums.set(k, v as EnumDef)
  for (const [k, v] of Object.entries(p.typeAliases)) t.typeAliases.set(k, typeFromPlain(v))
  for (const [id, d] of Object.entries(p.dispatches)) {
    const variants = new Map<string, Variant>()
    for (const [tag, v] of Object.entries((d as any).variants as Record<string, any>)) {
      variants.set(tag, {
        since: v.since,
        until: v.until,
        opts: (v.opts as any[]).map((o: any) => ({
          since: o.since,
          until: o.until,
          struct: o.struct ? structFromPlain(o.struct) : undefined,
          ref: o.ref,
        })),
      })
    }
    t.dispatches.set(id, { id, variants })
  }
  return t
}

export async function getMcdocSymbols(): Promise<SymbolTable | null> {
  if (cachedTable) return cachedTable
  const cached = getCache<any>('mcdoc_symbols')
  if (cached) {
    cachedTable = plainToTable(cached)
    return cachedTable
  }
  try {
    const files = await fetchMcdocSources()
    const table = buildSymbolTable(files)
    setCache('mcdoc_symbols', tableToPlain(table))
    cachedTable = table
    return table
  } catch {
    return null
  }
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

export interface FixMcdocResult {
  data: unknown
  removed: string[]
}

export interface StructuralIssue {
  file: string
  issue: string
  source?: 'mcdoc' | 'format'
}

function resolveStruct(ref: string, table: SymbolTable): StructDef | null {
  const s = table.structs.get(ref)
  if (s) return s
  const alias = table.typeAliases.get(ref)
  if (alias && alias.t === 'ref') return resolveStruct(alias.name, table)
  return null
}

function normalizeTag(tag: string): string {
  return tag.startsWith('minecraft:') ? tag.slice('minecraft:'.length) : tag
}

function resolveDispatch(
  table: SymbolTable,
  dispatchId: string,
  tag: string,
  version: string,
  ignoreVersion = false,
): StructDef | null {
  const dd = table.dispatches.get(dispatchId)
  if (!dd) return null
  const v = dd.variants.get(normalizeTag(tag))
  if (!v) return null
  // choose opt valid for this version
  for (const opt of v.opts) {
    const since = opt.since ?? v.since
    const until = opt.until ?? v.until
    if (ignoreVersion || inRange(version, since, until)) {
      if (opt.struct) return opt.struct
      if (opt.ref) return resolveStruct(opt.ref, table)
      return null
    }
  }
  return null
}

function dispatchTagKnownInvalid(
  table: SymbolTable,
  dispatchId: string,
  tag: string,
  version: string,
): string | null {
  const dd = table.dispatches.get(dispatchId)
  if (!dd) return null
  const v = dd.variants.get(normalizeTag(tag))
  if (!v) return null // unknown tag -> game tolerates via %unknown
  const since = v.since
  const until = v.until
  if (since && cmpVer(version, since) < 0) return `requires >= ${since}`
  if (until && cmpVer(version, until) >= 0) return `was removed in ${until}`
  return null
}

interface Collected {
  fields: Map<string, FieldSpec>
  allowUnknown: boolean
  dispatchSpreads: { dispatch: string; key: string }[]
}

function collectFields(
  def: StructDef,
  version: string,
  table: SymbolTable,
  seen: Set<StructDef>,
): Collected {
  const fields = new Map<string, FieldSpec>()
  let allowUnknown = def.allowUnknown
  const dispatchSpreads = [...def.dispatchSpreads]
  if (seen.has(def)) return { fields, allowUnknown, dispatchSpreads }
  seen.add(def)
  for (const f of def.fields) {
    if (inRange(version, f.since, f.until)) fields.set(f.name, f)
  }
  for (const sp of def.spreads) {
    const sdef = resolveStruct(sp, table)
    if (sdef) {
      const sub = collectFields(sdef, version, table, seen)
      for (const [k, v] of sub.fields) fields.set(k, v)
      allowUnknown = allowUnknown || sub.allowUnknown
      for (const d of sub.dispatchSpreads) dispatchSpreads.push(d)
    } else {
      allowUnknown = true
    }
  }
  return { fields, allowUnknown, dispatchSpreads }
}

/** Loose shape check used to pick a union branch: prefer the branch the value
 *  actually looks like, so unions like `(int | [int, int])` or `(ItemStack |
 *  string)` validate against the right alternative instead of blindly the first. */
function shapeFits(val: unknown, t: TypeExpr): boolean {
  if (t.t === 'list') return Array.isArray(val)
  if (t.t === 'union') return t.opts.some(o => shapeFits(val, o.of))
  if (t.t === 'prim') {
    if (val === null || val === undefined) return true
    const kind = primKindOf(t)
    if (!kind || kind === 'any' || kind === 'json' || kind === 'literal') return typeof val !== 'object'
    if (kind === 'string') return typeof val === 'string'
    if (kind === 'bool' || kind === 'boolean') return typeof val === 'boolean'
    if (kind === 'int' || kind === 'uint' || kind === 'long' || kind === 'short' || kind === 'byte' || kind === 'float' || kind === 'double') {
      return typeof val === 'number'
    }
    return false
  }
  if (t.t === 'literal') return typeof val === 'string'
  // ref: only claim object values (structs); prim-like values go to prim branches
  return val !== null && val !== undefined && typeof val === 'object' && !Array.isArray(val)
}

function checkEnumValue(
  val: string,
  name: string,
  edef: EnumDef,
  version: string,
  path: string,
  issues: StructuralIssue[],
): void {
  // tag refs / selectors are game-defined
  if (val.startsWith('#') || val.startsWith('@')) return
  const stripped = val.startsWith('minecraft:') ? val.slice('minecraft:'.length) : val
  if (stripped.includes(':')) return // foreign namespace
  const lc = stripped.toLowerCase()
  if (edef.values.some(v => inRange(version, v.since, v.until) && v.literal.toLowerCase() === lc)) return
  const valid = edef.values.filter(v => inRange(version, v.since, v.until)).map(v => v.literal)
  const shown = valid.slice(0, 10).join(', ') + (valid.length > 10 ? ', ...' : '')
  issues.push({
    file: '',
    issue: `At ${path}: unknown value "${val}" for enum ${name} (valid in ${version}: ${shown})`,
  })
}

function validateValue(
  val: unknown,
  type: TypeExpr,
  version: string,
  path: string,
  issues: StructuralIssue[],
  table: SymbolTable,
  depth: number,
): void {
  if (depth > 10) return
  if (type.t === 'list') {
    if (Array.isArray(val)) {
      for (let i = 0; i < val.length; i++) {
        validateValue(val[i], type.of, version, `${path}[${i}]`, issues, table, depth + 1)
      }
    }
    return
  }
  if (type.t === 'union') {
    const cands = type.opts.filter(o => inRange(version, o.since, o.until))
    if (cands.length === 0) return
    const pick = cands.find(o => shapeFits(val, o.of)) ?? cands[0]
    validateValue(val, pick.of, version, path, issues, table, depth + 1)
    return
  }
  if (type.t === 'ref') {
    const alias = table.typeAliases.get(type.name)
    if (alias) {
      validateValue(val, alias, version, path, issues, table, depth + 1)
      return
    }
    if (typeof val === 'string') {
      const edef = table.enums.get(type.name)
      if (edef) {
        checkEnumValue(val, type.name, edef, version, path, issues)
        return
      }
    }
    const sdef = table.structs.get(type.name)
    if (sdef && val && typeof val === 'object' && !Array.isArray(val)) {
      validateObject(val as Record<string, unknown>, sdef, version, path, issues, table, depth)
    }
    return
  }
  if (type.t === 'prim') {
    const kind = primKindOf(type)
    if (kind && kind !== 'any' && kind !== 'json' && kind !== 'literal' && val !== null && val !== undefined) {
      const got = Array.isArray(val) ? 'array' : typeof val
      const ok =
        kind === 'string' ? typeof val === 'string'
        : kind === 'bool' || kind === 'boolean' ? typeof val === 'boolean'
        : kind === 'int' || kind === 'uint' || kind === 'long' || kind === 'short' || kind === 'byte' || kind === 'float' || kind === 'double'
          ? typeof val === 'number'
          : true
      if (!ok) {
        issues.push({
          file: '',
          issue: `At ${path}: expected ${kind}, got ${got} (this is ${version})`,
        })
      }
    }
    return
  }
  // literal -> tolerate
  return
}

function validateObject(
  obj: Record<string, unknown>,
  def: StructDef,
  version: string,
  path: string,
  issues: StructuralIssue[],
  table: SymbolTable,
  depth: number,
): void {
  if (depth > 10) return
  const { fields, allowUnknown, dispatchSpreads } = collectFields(def, version, table, new Set())

  // resolve dispatch spreads by their key value
  const resolvedStructs: StructDef[] = []
  for (const ds of dispatchSpreads) {
    const keyVal = obj[ds.key]
    if (typeof keyVal === 'string') {
      const vstruct = resolveDispatch(table, ds.dispatch, keyVal, version)
      if (vstruct) {
        resolvedStructs.push(vstruct)
      } else {
        const bad = dispatchTagKnownInvalid(table, ds.dispatch, keyVal, version)
        if (bad) {
          issues.push({
            file: '',
            issue: `At ${path}: ${ds.key} "${keyVal}" ${bad} (this is ${version})`,
          })
          // Merge the variant's fields anyway (version-agnostic) so its
          // legitimate fields aren't double-reported as "unknown".
          const agnostic = resolveDispatch(table, ds.dispatch, keyVal, version, true)
          if (agnostic) resolvedStructs.push(agnostic)
        }
      }
    }
  }
  // merge resolved variant fields
  const merged = new Map(fields)
  for (const rs of resolvedStructs) {
    const sub = collectFields(rs, version, table, new Set())
    for (const [k, v] of sub.fields) merged.set(k, v)
  }
  const allFields = merged

  // check each key
  for (const key of Object.keys(obj)) {
    if (dispatchSpreads.some(d => d.key === key)) continue
    const spec = allFields.get(key)
    if (!spec) {
      if (allowUnknown) continue
      issues.push({
        file: '',
        issue: `At ${path}: unknown field "${key}" (not valid in ${version})`,
      })
    } else {
      if (spec.since && cmpVer(version, spec.since) < 0) {
        issues.push({
          file: '',
          issue: `At ${path}: field "${key}" requires >= ${spec.since} (this is ${version})`,
        })
      }
      if (spec.until && cmpVer(version, spec.until) >= 0) {
        issues.push({
          file: '',
          issue: `At ${path}: field "${key}" was removed in ${spec.until} (this is ${version})`,
        })
      }
    }
  }

  // recurse into values
  for (const [key, val] of Object.entries(obj)) {
    if (dispatchSpreads.some(d => d.key === key)) continue
    const spec = allFields.get(key)
    if (spec) validateValue(val, spec.type, version, `${path}.${key}`, issues, table, depth + 1)
  }
}

// ---------------------------------------------------------------------------
// Public: validate one datapack JSON file for a given version
// ---------------------------------------------------------------------------

const KIND_TO_RESOURCE: Record<string, string> = {
  // === Datapack types (already covered) ===
  recipe: 'recipe',
  loot_table: 'loot_table',
  advancement: 'advancement',
  predicate: 'predicate',
  item_modifier: 'item_modifier',

  // === New datapack types (simple registry file types) ===
  damage_type: 'damage_type',
  enchantment: 'enchantment',
  jukebox_song: 'jukebox_song',
  chat_type: 'chat_type',
  trim_pattern: 'trim_pattern',
  trim_material: 'trim_material',
  banner_pattern: 'banner_pattern',
  wolf_variant: 'wolf_variant',
  pig_variant: 'pig_variant',
  cat_variant: 'cat_variant',
  frog_variant: 'frog_variant',
  painting_variant: 'painting_variant',
  instrument: 'instrument',
  dimension_type: 'dimension_type',
  dimension: 'dimension',
  trial_spawner: 'trial_spawner',
  trade_set: 'trade_set',
  villager_trade: 'villager_trade',
  dialog: 'dialog',
  enchantment_provider: 'enchantment_provider',
  decorated_pot_pattern: 'decorated_pot_pattern',
  cow_variant: 'cow_variant',
  chicken_variant: 'chicken_variant',
  zombie_nautilus_variant: 'zombie_nautilus_variant',

  // === Newer types (1.21.5+) ===
  sulfur_cube_archetype: 'sulfur_cube_archetype',
  timeline: 'timeline',
  world_clock: 'world_clock',
  test_instance: 'test_instance',
  test_environment: 'test_environment',
  number_provider: 'number_provider',
  slot_source: 'slot_source',

  // === Sound variants (1.21.5+) ===
  cat_sound_variant: 'cat_sound_variant',
  cow_sound_variant: 'cow_sound_variant',
  chicken_sound_variant: 'chicken_sound_variant',
  pig_sound_variant: 'pig_sound_variant',
  wolf_sound_variant: 'wolf_sound_variant',

  // === Texture metadata (.png.mcmeta) ===
  texture_meta: 'texture_meta',

  // === Worldgen types (two-level paths, quoted tags in mcdoc) ===
  'worldgen/world_preset': '"worldgen/world_preset"',
  'worldgen/template_pool': '"worldgen/template_pool"',
  'worldgen/structure_set': '"worldgen/structure_set"',
  'worldgen/structure': '"worldgen/structure"',
  'worldgen/processor_list': '"worldgen/processor_list"',
  'worldgen/placed_feature': '"worldgen/placed_feature"',
  'worldgen/noise_settings': '"worldgen/noise_settings"',
  'worldgen/noise': '"worldgen/noise"',
  'worldgen/multi_noise_biome_source_parameter_list': '"worldgen/multi_noise_biome_source_parameter_list"',
  'worldgen/material_rule': '"worldgen/material_rule"',
  'worldgen/material_condition': '"worldgen/material_condition"',
  'worldgen/flat_level_generator_preset': '"worldgen/flat_level_generator_preset"',
  'worldgen/feature': '"worldgen/feature"',
  'worldgen/density_function': '"worldgen/density_function"',
  'worldgen/configured_surface_builder': '"worldgen/configured_surface_builder"',
  'worldgen/configured_structure_feature': '"worldgen/configured_structure_feature"',
  'worldgen/configured_feature': '"worldgen/configured_feature"',
  'worldgen/configured_carver': '"worldgen/configured_carver"',
  'worldgen/carver': '"worldgen/carver"',
  'worldgen/biome': '"worldgen/biome"',

  // === Resource pack types ===
  models: 'model',
  blockstates: 'block_definition',
  atlases: 'atlas',
  particles: 'particle',
  lang: 'lang',
  font: 'font',
  shaders: 'shader',
  'shaders/post': 'post_effect',
  items: 'item_definition',
  equipment: 'equipment',
  waypoint_style: 'waypoint_style',
}

/** Map sounds.json filename and .mcmeta extension */
const FILE_TO_RESOURCE: Record<string, string> = {
  'sounds.json': 'sounds',
  'credits.json': 'credits',
  'gpu_warnlist.json': 'gpu_warnlist',
  'regional_compliancies.json': 'regional_compliancies',
}

/** All worldgen prefixes that could precede a sub-type (for multi-segment matching). */
const WORLDGEN_PREFIXES = new Set(['worldgen'])

export function fileKindFromPath(relPath: string): string | null {
  const segs = relPath.split('/')
  const fileName = segs[segs.length - 1]
  // Skip files in tags/ directories — tags have a simple format (values + replace)
  // and shouldn't be validated against resource schemas.
  for (let i = 0; i < segs.length; i++) {
    if (segs[i] === 'tags') return null
  }
  // Skip non-minecraft namespaces to avoid false positives on mod content.
  // Datapack: data/<namespace>/..., Resource pack: assets/<namespace>/...
  const nsIdx = segs[0] === 'data' || segs[0] === 'assets' ? 1 : -1
  if (nsIdx >= 0 && segs[nsIdx] && segs[nsIdx] !== 'minecraft') return null
  // Check for specific filenames (sounds.json)
  if (fileName in FILE_TO_RESOURCE) return FILE_TO_RESOURCE[fileName]
  // Check for .mcmeta files (texture metadata) — treat as texture_meta
  if (fileName.endsWith('.png.mcmeta')) return 'texture_meta'
  // Check consecutive segment pairs first (worldgen/xxx, etc.)
  for (let i = 0; i < segs.length - 1; i++) {
    const pair = segs[i] + '/' + segs[i + 1]
    if (pair in KIND_TO_RESOURCE) return pair
  }
  // Check single segments
  for (const seg of segs) {
    if (seg in KIND_TO_RESOURCE) return seg
  }
  return null
}

export function checkMcdocFile(
  file: string,
  relPath: string,
  version: string,
  table: SymbolTable,
): StructuralIssue[] {
  const issues: StructuralIssue[] = []
  // The mcdoc schema only covers 1.16+; older packs would just produce noise.
  if (cmpVer(version, '1.16') < 0) return issues
  const kind = fileKindFromPath(relPath)
  if (!kind) return issues
  let data: unknown
  try {
    data = JSON.parse(readFileSync(file, 'utf-8'))
  } catch {
    return issues
  }
  if (!data || typeof data !== 'object') return issues

  const dd = table.dispatches.get('minecraft:resource')
  // Some mcdoc tags are quoted ("instrument", "shader", worldgen kinds) and
  // some are not; try both forms so no kind silently skips validation.
  const tag = KIND_TO_RESOURCE[kind]
  const variant = tag ? dd?.variants.get(tag) ?? dd?.variants.get(`"${tag}"`) : undefined
  if (!variant) return issues

  // Resolve the root variant (single struct or ref/alias)
  let rootStruct: StructDef | null = null
  for (const opt of variant.opts) {
    if (inRange(version, opt.since, opt.until)) {
      if (opt.struct) rootStruct = opt.struct
      else if (opt.ref) rootStruct = resolveStruct(opt.ref, table)
      break
    }
  }
  if (!rootStruct) {
    // union/alias root (e.g. predicate = LootCondition | [LootCondition])
    const refName = variant.opts[0]?.ref
    if (refName) {
      const alias = table.typeAliases.get(refName)
      if (alias) {
        validateValue(data, alias, version, '$', issues, table, 0)
        attachFile(issues, relPath, 'mcdoc')
        return issues
      }
    }
    return issues
  }

  validateObject(data as Record<string, unknown>, rootStruct, version, '$', issues, table, 0)
  attachFile(issues, relPath, 'mcdoc')
  return issues
}

function attachFile(issues: StructuralIssue[], relPath: string, source: 'mcdoc' | 'format'): void {
  for (const iss of issues) {
    iss.file = relPath
    iss.source = source
  }
}

// ---------------------------------------------------------------------------
// Fix: walk JSON and remove fields invalid for target version
// ---------------------------------------------------------------------------

function fixObjectInPlace(
  obj: Record<string, unknown>,
  def: StructDef,
  version: string,
  path: string,
  table: SymbolTable,
  removed: string[],
  depth = 0,
): void {
  if (depth > 10) return

  const { fields, allowUnknown, dispatchSpreads } = collectFields(def, version, table, new Set())

  // resolve dispatch spreads so variant fields are known
  const merged = new Map(fields)
  for (const ds of dispatchSpreads) {
    const keyVal = obj[ds.key]
    if (typeof keyVal === 'string') {
      const vstruct = resolveDispatch(table, ds.dispatch, keyVal, version, true)
      if (vstruct) {
        const sub = collectFields(vstruct, version, table, new Set())
        for (const [k, v] of sub.fields) merged.set(k, v)
      }
    }
  }

  // check each key in the object
  const keysToDelete: string[] = []
  for (const key of Object.keys(obj)) {
    if (dispatchSpreads.some(d => d.key === key)) continue
    const spec = merged.get(key)

    if (!spec) {
      if (!allowUnknown) {
        keysToDelete.push(key)
        removed.push(`${path}.${key}: removed (not valid in ${version})`)
      }
    } else if (!inRange(version, spec.since, spec.until)) {
      // Field exists in schema but is version-gated out for this version
      const reason = spec.since && cmpVer(version, spec.since) < 0
        ? `requires >= ${spec.since}`
        : `was removed in ${spec.until}`
      keysToDelete.push(key)
      removed.push(`${path}.${key}: removed (${reason}, this is ${version})`)
    }
  }

  // apply deletions
  for (const key of keysToDelete) {
    delete obj[key]
  }

  // recurse into remaining values
  for (const [key, val] of Object.entries(obj)) {
    if (dispatchSpreads.some(d => d.key === key)) continue
    const spec = merged.get(key)
    if (!spec) continue
    if (val && typeof val === 'object') {
      fixValueInPlace(val, spec.type, version, `${path}.${key}`, table, removed, depth + 1)
    }
  }
}

function fixValueInPlace(
  val: unknown,
  type: TypeExpr,
  version: string,
  path: string,
  table: SymbolTable,
  removed: string[],
  depth: number,
): void {
  if (depth > 10 || val === null || val === undefined) return

  if (type.t === 'list') {
    if (Array.isArray(val)) {
      for (let i = 0; i < val.length; i++) {
        fixValueInPlace(val[i], type.of, version, `${path}[${i}]`, table, removed, depth + 1)
      }
    }
    return
  }

  if (type.t === 'union') {
    for (const opt of type.opts) {
      if (inRange(version, opt.since, opt.until)) {
        fixValueInPlace(val, opt.of, version, path, table, removed, depth + 1)
        return
      }
    }
    return
  }

  if (type.t === 'ref') {
    const alias = table.typeAliases.get(type.name)
    if (alias) {
      fixValueInPlace(val, alias, version, path, table, removed, depth + 1)
      return
    }
    const sdef = table.structs.get(type.name)
    if (sdef && typeof val === 'object' && !Array.isArray(val)) {
      fixObjectInPlace(val as Record<string, unknown>, sdef, version, path, table, removed, depth)
    }
    return
  }

  // prim / literal -> nothing to fix
}

export function fixMcdocFileData(
  data: unknown,
  relPath: string,
  version: string,
  table: SymbolTable,
): FixMcdocResult {
  const removed: string[] = []
  const kind = fileKindFromPath(relPath)
  if (!kind) return { data, removed }
  if (!data || typeof data !== 'object') return { data, removed }

  const dd = table.dispatches.get('minecraft:resource')
  if (!dd) return { data, removed }

  // try both direct and quoted lookup for the resource dispatch tag
  let resourceTag = KIND_TO_RESOURCE[kind]
  let variant = dd.variants.get(resourceTag)

  if (!variant) {
    resourceTag = `"${kind}"`
    variant = dd.variants.get(resourceTag)
  }

  if (!variant) return { data, removed }

  // resolve root struct for target version
  let rootStruct: StructDef | null = null
  for (const opt of variant.opts) {
    if (inRange(version, opt.since, opt.until)) {
      if (opt.struct) rootStruct = opt.struct
      else if (opt.ref) rootStruct = resolveStruct(opt.ref, table)
      break
    }
  }

  if (!rootStruct) {
    // union/alias root (e.g. predicate = LootCondition | [LootCondition])
    for (const opt of variant.opts) {
      if (inRange(version, opt.since, opt.until)) {
        if (opt.ref) {
          const alias = table.typeAliases.get(opt.ref)
          if (alias) {
            fixValueInPlace(data, alias, version, '$', table, removed, 0)
            return { data, removed }
          }
        }
        break
      }
    }
    return { data, removed }
  }

  fixObjectInPlace(data as Record<string, unknown>, rootStruct, version, '$', table, removed)
  return { data, removed }
}
