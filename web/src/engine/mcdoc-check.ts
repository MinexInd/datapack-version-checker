import { getCache, setCache } from './cache'

function parseVer(v: string): number[] | null {
  const m = v.match(/^(\d+)(?:\.(\d+))?(?:\.(\d+))?/)
  if (!m) return null
  return [parseInt(m[1], 10), m[2] ? parseInt(m[2], 10) : 0, m[3] ? parseInt(m[3], 10) : 0]
}

export function cmpVer(a: string, b: string): number {
  const pa = parseVer(a)
  const pb = parseVer(b)
  if (pa && pb) {
    for (let i = 0; i < 3; i++) {
      if (pa[i] !== pb[i]) return pa[i] < pb[i] ? -1 : 1
    }
    return 0
  }
  return a < b ? -1 : a > b ? 1 : 0
}

function inRange(version: string, since?: string, until?: string): boolean {
  if (since && cmpVer(version, since) < 0) return false
  if (until && cmpVer(version, until) >= 0) return false
  return true
}

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
  spreads: string[]
  dispatchSpreads: { dispatch: string; key: string }[]
  allowUnknown: boolean
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
  since?: string
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

async function gunzip(data: ArrayBuffer): Promise<Uint8Array> {
  const ds = new DecompressionStream('gzip')
  const writer = ds.writable.getWriter()
  writer.write(new Uint8Array(data))
  writer.close()
  return new Uint8Array(await new Response(ds.readable).arrayBuffer())
}

async function fetchMcdocSources(): Promise<Map<string, string>> {
  const res = await fetch('https://api.spyglassmc.com/vanilla-mcdoc/tarball')
  const compressed = await res.arrayBuffer()
  const buf = await gunzip(compressed)
  const files = new Map<string, string>()
  let off = 0
  const decoder = new TextDecoder()
  while (off + 512 <= buf.length) {
    const name = decoder.decode(buf.slice(off, off + 100)).replace(/\0.*$/, '')
    const sizeStr = decoder.decode(buf.slice(off + 124, off + 136)).replace(/\0.*$/, '')
    const size = parseInt(sizeStr.trim(), 8) || 0
    const typeflag = decoder.decode(buf.slice(off + 156, off + 157))
    off += 512
    if (!name) break
    if (typeflag === '0' || typeflag === '') {
      files.set(name, decoder.decode(buf.slice(off, off + size)))
    }
    off += Math.ceil(size / 512) * 512
  }
  return files
}

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

function stripAttrs(s: string): { attrs: { since?: string; until?: string }; rest: string } {
  const attrs: { since?: string; until?: string } = {}
  let rest = s
  const re = /#\[(since|until)="([^"]+)"\]/g
  let m: RegExpMatchArray | null
  while ((m = re.exec(s)) !== null) {
    attrs[m[1] as 'since' | 'until'] = m[2]
  }
  rest = rest.replace(re, '').trim()
  return { attrs, rest }
}

function stripLeadingAttrs(s: string): { attrs: { since?: string; until?: string }; rest: string } {
  const attrs: { since?: string; until?: string } = {}
  let rest = s
  let m: RegExpMatchArray | null
  while ((m = rest.match(/^#\[(since|until)="([^"]+)"\]\s*/)) !== null) {
    attrs[m[1] as 'since' | 'until'] = m[2]
    rest = rest.slice(m[0].length)
  }
  return { attrs, rest }
}

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

function parseType(str: string): TypeExpr {
  const s = stripLeadingAttrs(stripComments(str)).rest.trim()
  if (s === '') return { t: 'prim' }
  if (s.startsWith('[') && s.endsWith(']')) {
    return { t: 'list', of: parseType(s.slice(1, -1)) }
  }
  if (s.startsWith('(') && s.endsWith(')')) {
    const inner = s.slice(1, -1)
    const branches = splitTop(inner, '|')
    const opts = branches
      .map(b => {
        const { attrs, rest } = stripAttrs(b)
        return { since: attrs.since, until: attrs.until, of: parseType(rest) }
      })
      .filter(o => o.of.t !== 'prim' || true)
    return { t: 'union', opts }
  }
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
    return { t: 'literal' }
  }
  const primRe = /^(string|int|float|double|long|short|byte|bool|boolean|any|json|uint|literal)\b/
  if (primRe.test(s)) return { t: 'prim' }
  const name = s.replace(/<[^>]*>$/, '').trim()
  if (primRe.test(name)) return { t: 'prim' }
  return { t: 'ref', name }
}

function parseStructBody(body: string): StructDef {
  const def: StructDef = { fields: [], spreads: [], dispatchSpreads: [], allowUnknown: false }
  const cleaned = stripComments(body)
  const chunks = splitTop(cleaned, ',').map(c => c.trim()).filter(c => c !== '')
  for (let chunk of chunks) {
    const { attrs, rest } = stripLeadingAttrs(chunk)
    if (rest === '') continue
    let m = rest.match(/^\.\.\.(minecraft:[\w:]+)\[\[([^\]]*)\]\]/)
    if (m) {
      def.dispatchSpreads.push({ dispatch: m[1], key: m[2] })
      continue
    }
    if (rest.startsWith('...')) {
      def.spreads.push(rest.slice(3).trim())
      continue
    }
    if (rest.startsWith('[')) {
      def.allowUnknown = true
      continue
    }
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

function parseDispatchRest(rest: string, tagSince?: string, tagUntil?: string): Variant {
  const variant: Variant = { since: tagSince, until: tagUntil, opts: [] }
  const r = rest.trim()

  const parseOptBody = (body: string): VariantOpt => {
    const b = body.trim()
    if (b === '' || b === 'struct {}') return {}
    const braceStart = b.indexOf('{')
    if (b.startsWith('struct') && braceStart >= 0) {
      const inner = extractBraceBody(b)
      if (inner !== null) return { struct: parseStructBody(inner) }
    }
    if (b === 'struct') return {}
    const refName = b.replace(/^struct\s+/, '').replace(/\s*\{[^]*$/, '').trim()
    if (refName && /^[A-Za-z_]\w*$/.test(refName)) return { ref: refName }
    return {}
  }

  if (r.startsWith('(') && r.endsWith(')')) {
    const inner = r.slice(1, -1)
    const branches = splitTop(inner, '|')
    for (const br of branches) {
      const { attrs, rest: brRest } = stripAttrs(br)
      variant.opts.push({ since: attrs.since, until: attrs.until, ...parseOptBody(brRest) })
    }
    return variant
  }

  variant.opts.push({ since: tagSince, until: tagUntil, ...parseOptBody(r) })
  return variant
}

function buildSymbolTable(files: Map<string, string>): SymbolTable {
  const table: SymbolTable = {
    structs: new Map(),
    enums: new Map(),
    typeAliases: new Map(),
    dispatches: new Map(),
  }

  for (const content of files.values()) {
    let text = stripComments(content)
    text = text.replace(/^\s*use\s+[^\n]*/gm, '')
    const lines = text.split('\n')

    let i = 0
    let pendingAttrs = ''
    while (i < lines.length) {
      const line = lines[i]
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
        while (i + 1 < lines.length && !isBalanced(rest)) {
          i++
          rest += '\n' + lines[i]
        }
        try {
          if (!table.dispatches.has(id)) table.dispatches.set(id, { id, variants: new Map() })
          const dd = table.dispatches.get(id)!
          dd.variants.set(tag, parseDispatchRest(rest, attrs.since, attrs.until))
        } catch {}
        i++
        continue
      }

      const structMatch = line.match(/^(?:export\s+)?(struct|interface)\s+([\w$]+)\s*(\{|<)/)
      if (structMatch) {
        const name = structMatch[2]
        let body = line.slice(line.indexOf('{'))
        while (i + 1 < lines.length && extractBraceBody(body) === null) {
          i++
          body += '\n' + lines[i]
        }
        const inner = extractBraceBody(body)
        if (inner !== null) {
          try { table.structs.set(name, parseStructBody(inner)) } catch {}
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
          try { table.enums.set(name, parseEnumBody(inner)) } catch {}
        }
        i++
        continue
      }

      const typeMatch = line.match(/^type\s+([\w$]+)\s*=\s*([\s\S]*)$/)
      if (typeMatch) {
        const name = typeMatch[1]
        let rest = typeMatch[2]
        while (i + 1 < lines.length && !isBalanced(rest)) {
          i++
          rest += '\n' + lines[i]
        }
        try { table.typeAliases.set(name, parseType(rest.replace(/;\s*$/, ''))) } catch {}
        i++
        continue
      }

      i++
    }
  }

  return table
}

let cachedTable: SymbolTable | null = null

function tableToPlain(t: SymbolTable): any {
  return {
    structs: Object.fromEntries(t.structs),
    enums: Object.fromEntries(t.enums),
    typeAliases: Object.fromEntries(t.typeAliases),
    dispatches: Object.fromEntries(
      [...t.dispatches].map(([id, d]) => [id, { id, variants: Object.fromEntries(d.variants) }]),
    ),
  }
}

function plainToTable(p: any): SymbolTable {
  const t: SymbolTable = {
    structs: new Map(),
    enums: new Map(),
    typeAliases: new Map(),
    dispatches: new Map(),
  }
  for (const [k, v] of Object.entries(p.structs)) t.structs.set(k, v as StructDef)
  for (const [k, v] of Object.entries(p.enums)) t.enums.set(k, v as EnumDef)
  for (const [k, v] of Object.entries(p.typeAliases)) t.typeAliases.set(k, v as TypeExpr)
  for (const [id, d] of Object.entries(p.dispatches)) {
    const variants = new Map(Object.entries((d as any).variants)) as Map<string, Variant>
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

export interface FixMcdocResult {
  data: unknown
  removed: string[]
}

export interface StructuralIssue {
  file: string
  issue: string
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
  if (!v) return null
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
    for (const o of type.opts) {
      if (inRange(version, o.since, o.until)) {
        validateValue(val, o.of, version, path, issues, table, depth + 1)
        return
      }
    }
    return
  }
  if (type.t === 'ref') {
    const alias = table.typeAliases.get(type.name)
    if (alias) {
      validateValue(val, alias, version, path, issues, table, depth + 1)
      return
    }
    const sdef = table.structs.get(type.name)
    if (sdef && val && typeof val === 'object' && !Array.isArray(val)) {
      validateObject(val as Record<string, unknown>, sdef, version, path, issues, table, depth)
    }
    return
  }
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
          const agnostic = resolveDispatch(table, ds.dispatch, keyVal, version, true)
          if (agnostic) resolvedStructs.push(agnostic)
        }
      }
    }
  }
  const merged = new Map(fields)
  for (const rs of resolvedStructs) {
    const sub = collectFields(rs, version, table, new Set())
    for (const [k, v] of sub.fields) merged.set(k, v)
  }
  const allFields = merged

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

  for (const [key, val] of Object.entries(obj)) {
    if (dispatchSpreads.some(d => d.key === key)) continue
    const spec = allFields.get(key)
    if (spec) validateValue(val, spec.type, version, `${path}.${key}`, issues, table, depth + 1)
  }
}

const KIND_TO_RESOURCE: Record<string, string> = {
  recipe: 'recipe',
  loot_table: 'loot_table',
  advancement: 'advancement',
  predicate: 'predicate',
  item_modifier: 'item_modifier',
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
  'worldgen/biome_source': '"worldgen/biome_source"',
  models: 'model',
  blockstates: 'block_definition',
  atlases: 'atlas',
  particles: 'particle',
  lang: 'lang',
  font: 'font',
  shaders: 'shader',
}

const FILE_TO_RESOURCE: Record<string, string> = {
  'sounds.json': 'sounds',
}

const WORLDGEN_PREFIXES = new Set(['worldgen'])

export function fileKindFromPath(relPath: string): string | null {
  const segs = relPath.split('/')
  const fileName = segs[segs.length - 1]
  for (let i = 0; i < segs.length; i++) {
    if (segs[i] === 'tags') return null
  }
  const nsIdx = segs[0] === 'data' || segs[0] === 'assets' ? 1 : -1
  if (nsIdx >= 0 && segs[nsIdx] && segs[nsIdx] !== 'minecraft') return null
  if (fileName in FILE_TO_RESOURCE) return FILE_TO_RESOURCE[fileName]
  if (fileName.endsWith('.png.mcmeta')) return 'texture_meta'
  for (let i = 0; i < segs.length - 1; i++) {
    const pair = segs[i] + '/' + segs[i + 1]
    if (pair in KIND_TO_RESOURCE) return pair
  }
  for (const seg of segs) {
    if (seg in KIND_TO_RESOURCE) return seg
  }
  return null
}

export function checkMcdocData(
  data: unknown,
  relPath: string,
  version: string,
  table: SymbolTable,
): StructuralIssue[] {
  const issues: StructuralIssue[] = []
  const kind = fileKindFromPath(relPath)
  if (!kind) return issues
  if (!data || typeof data !== 'object') return issues

  const dd = table.dispatches.get('minecraft:resource')
  const variant = dd?.variants.get(KIND_TO_RESOURCE[kind])
  if (!variant) return issues

  let rootStruct: StructDef | null = null
  for (const opt of variant.opts) {
    if (inRange(version, opt.since, opt.until)) {
      if (opt.struct) rootStruct = opt.struct
      else if (opt.ref) rootStruct = resolveStruct(opt.ref, table)
      break
    }
  }
  if (!rootStruct) {
    const refName = variant.opts[0]?.ref
    if (refName) {
      const alias = table.typeAliases.get(refName)
      if (alias) {
        validateValue(data, alias, version, '$', issues, table, 0)
        for (const iss of issues) iss.file = relPath
        return issues
      }
    }
    return issues
  }

  validateObject(data as Record<string, unknown>, rootStruct, version, '$', issues, table, 0)
  for (const iss of issues) iss.file = relPath
  return issues
}

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
      const reason = spec.since && cmpVer(version, spec.since) < 0
        ? `requires >= ${spec.since}`
        : `was removed in ${spec.until}`
      keysToDelete.push(key)
      removed.push(`${path}.${key}: removed (${reason}, this is ${version})`)
    }
  }

  for (const key of keysToDelete) {
    delete obj[key]
  }

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

  let resourceTag = KIND_TO_RESOURCE[kind]
  let variant = dd.variants.get(resourceTag)

  if (!variant) {
    resourceTag = `"${kind}"`
    variant = dd.variants.get(resourceTag)
  }

  if (!variant) return { data, removed }

  let rootStruct: StructDef | null = null
  for (const opt of variant.opts) {
    if (inRange(version, opt.since, opt.until)) {
      if (opt.struct) rootStruct = opt.struct
      else if (opt.ref) rootStruct = resolveStruct(opt.ref, table)
      break
    }
  }

  if (!rootStruct) {
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
