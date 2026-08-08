/**
 * NBT string rewriting for 1.21.5+ forward porting.
 *
 * Four transforms applied to raw NBT text inside mcfunction lines:
 *   T1 — HandItems/ArmorItems -> equipment
 *   T2 — Attribute prefix normalization (player.X -> minecraft:X, generic.X -> X)
 *   T3 — Stringified JSON text components -> structured JSON
 *   T4 — Count:1b -> count:1 (item-stack shaped compounds)
 *
 * All transforms are forward-only (target >= 1.21.5), no reverse rules yet.
 * Design: targeted string replacements on raw text, no full NBT parser.
 */

// ---------------------------------------------------------------------------
// Brace/quote scanning — reuse the same depth-tracking approach as tokenizer.ts
// ---------------------------------------------------------------------------

interface Span {
  start: number
  end: number
}

/**
 * Find ALL `{...}` spans in a line (including nested compounds) using
 * brace-depth scanning. Aware of single/double quoted strings and
 * backslash escapes. Returns spans sorted by start position.
 *
 * Unlike a simple depth-tracking scan, this emits a span for every `{`
 * encountered, not just the outermost. The main loop advances `i` past
 * each opening `{` so that inner compounds are also discovered.
 */
export function findCompounds(line: string): Span[] {
  const spans: Span[] = []
  let i = 0
  const n = line.length
  // Track quotes in the outer loop so we don't treat { inside quoted strings
  // as compound openers (e.g. "minecraft:item_name":"{\"text\":\"...\"}")
  let outerInQuote = false
  let outerQuoteChar = ''
  let outerEscaped = false
  while (i < n) {
    const c = line[i]
    if (outerEscaped) { outerEscaped = false; i++; continue }
    if (c === '\\' && outerInQuote) { outerEscaped = true; i++; continue }
    if (outerInQuote) {
      if (c === outerQuoteChar) outerInQuote = false
      i++; continue
    }
    if (c === '"' || c === "'") { outerInQuote = true; outerQuoteChar = c; i++; continue }
    if (c === '{') {
      const start = i
      let depth = 0
      let inQuote = false
      let quoteChar = ''
      let escaped = false
      let j = i
      while (j < n) {
        const cc = line[j]
        if (escaped) { escaped = false; j++; continue }
        if (cc === '\\' && inQuote) { escaped = true; j++; continue }
        if (inQuote) {
          if (cc === quoteChar) inQuote = false
          j++; continue
        }
        if (cc === '"' || cc === "'") { inQuote = true; quoteChar = cc; j++; continue }
        if (cc === '{') depth++
        else if (cc === '}') {
          depth--
          if (depth === 0) {
            spans.push({ start, end: j + 1 })
            break
          }
        }
        j++
      }
      i = start + 1 // advance past the opening brace so nested compounds are found
    } else { i++ }
  }
  return spans
}

// ---------------------------------------------------------------------------
// Compound entry splitting
// ---------------------------------------------------------------------------

interface Entry {
  /** Key text including trailing colon, e.g. "HandItems:" */
  key: string
  /** Start/end offsets of the key in the line */
  kStart: number
  kEnd: number
  /** Start/end offsets of the value in the line */
  vStart: number
  vEnd: number
}

/**
 * Split a compound (outer braces included) into top-level key:value entries.
 * Nesting-aware: nested { } [ ] and quoted strings don't split entries.
 * Commas and whitespace between entries are consumed.
 */
function splitCompound(line: string, start: number, end: number): Entry[] {
  const entries: Entry[] = []
  let i = start + 1 // skip '{'
  const limit = end - 1 // stop before '}'
  const n = line.length

  while (i < limit) {
    // skip whitespace + commas between entries
    while (i < limit && (line[i] === ' ' || line[i] === ',' || line[i] === '\t' || line[i] === '\n')) i++
    if (i >= limit) break

    // read key (everything up to ':' that's an identifier or quoted)
    const kStart = i
    let key = ''
    // keys can be quoted (e.g. "minecraft:custom_data") or bare identifiers
    if (line[i] === '"' || line[i] === "'") {
      const q = line[i]
      key += q; i++
      while (i < limit) {
        if (line[i] === '\\' && i + 1 < limit) { key += line[i] + line[i+1]; i += 2; continue }
        key += line[i]
        if (line[i] === q) { i++; break }
        i++
      }
    } else {
      while (i < limit && line[i] !== ':' && line[i] !== ',' && line[i] !== '}' && line[i] !== ' ') {
        key += line[i]; i++
      }
    }
    if (line[i] === ':') { key += ':'; i++ }
    const kEnd = i
    if (!key) { i++; continue }

    // skip whitespace after colon
    while (i < limit && (line[i] === ' ' || line[i] === '\t')) i++
    if (i >= limit) break

    // read value span
    const vStart = i
    const ch = line[i]
    if (ch === '{' || ch === '[') {
      const open = ch
      const close = ch === '{' ? '}' : ']'
      let depth = 0
      let inQ = false; let qC = ''; let esc = false
      while (i < n) {
        const c = line[i]
        if (esc) { esc = false; i++; continue }
        if (c === '\\' && inQ) { esc = true; i++; continue }
        if (inQ) { if (c === qC) inQ = false; i++; continue }
        if (c === '"' || c === "'") { inQ = true; qC = c; i++; continue }
        if (c === open) depth++
        else if (c === close) { depth--; if (depth === 0) { i++; break } }
        i++
      }
    } else if (ch === '"' || ch === "'") {
      const q = ch
      i++
      while (i < n) {
        if (line[i] === '\\' && i + 1 < n) { i += 2; continue }
        if (line[i] === q) { i++; break }
        i++
      }
    } else {
      // unquoted: read until comma or brace
      while (i < limit && line[i] !== ',' && line[i] !== '}') i++
    }
    entries.push({ key, kStart, kEnd, vStart, vEnd: i })
  }
  return entries
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function stripColon(k: string): string {
  let result = k.endsWith(':') ? k.slice(0, -1) : k
  // Strip surrounding quotes from quoted keys like "minecraft:attribute_modifiers"
  if (result.length >= 2 &&
      ((result[0] === '"' && result[result.length - 1] === '"') ||
       (result[0] === "'" && result[result.length - 1] === "'"))) {
    result = result.slice(1, -1)
  }
  return result
}

/**
 * Try to unescape an NBT-quoted string and parse its content as JSON.
 * Returns the re-serialized JSON string, or null if it doesn't parse as
 * a JSON object or array.
 */
function tryUnstringJson(raw: string): string | null {
  const t = raw.trim()
  if (t.length < 2) return null
  const q = t[0]
  if ((q !== '"' && q !== "'") || t[t.length - 1] !== q) return null
  // unescape NBT-style: \" -> "
  let inner = ''
  for (let i = 1; i < t.length - 1; i++) {
    if (t[i] === '\\' && i + 1 < t.length - 1) { inner += t[i + 1]; i++ }
    else inner += t[i]
  }
  try {
    const obj = JSON.parse(inner)
    if (typeof obj === 'object' && obj !== null) return JSON.stringify(obj)
  } catch { /* not JSON */ }
  return null
}

/**
 * Read the full value span at position in line (handles { }, [ ], quoted strings).
 */
function readValueEnd(line: string, pos: number): number {
  const n = line.length
  if (pos >= n) return pos
  const ch = line[pos]
  if (ch === '{' || ch === '[') {
    const open = ch; const close = ch === '{' ? '}' : ']'
    let depth = 0; let inQ = false; let qC = ''; let esc = false
    let i = pos
    while (i < n) {
      const c = line[i]
      if (esc) { esc = false; i++; continue }
      if (c === '\\' && inQ) { esc = true; i++; continue }
      if (inQ) { if (c === qC) inQ = false; i++; continue }
      if (c === '"' || c === "'") { inQ = true; qC = c; i++; continue }
      if (c === open) depth++
      else if (c === close) { depth--; if (depth === 0) { return i + 1 } }
      i++
    }
    return n
  }
  if (ch === '"' || ch === "'") {
    let i = pos + 1
    while (i < n) {
      if (line[i] === '\\' && i + 1 < n) { i += 2; continue }
      if (line[i] === ch) return i + 1
      i++
    }
    return n
  }
  let i = pos
  while (i < n && line[i] !== ',' && line[i] !== '}') i++
  return i
}

/** Slots mapping for T1. */
const HAND_SLOTS: Record<number, string> = { 0: 'mainhand', 1: 'offhand' }
const ARMOR_SLOTS: Record<number, string> = { 0: 'feet', 1: 'legs', 2: 'chest', 3: 'head' }
const EQUIP_ORDER = ['mainhand', 'offhand', 'head', 'chest', 'legs', 'feet']

/** Text-component keys for T3 scoping. */
const TEXT_COMP_KEYS = new Set([
  'CustomName', 'custom_name', 'item_name', 'title', 'subtitle',
  'description', 'chat_type', 'translation', 'narration',
  'minecraft:item_name', 'minecraft:custom_name',
])

/** Attribute modifiers list keys for T2 scoping. */
const ATTR_MOD_KEYS = new Set([
  'AttributeModifiers', 'attribute_modifiers', 'minecraft:attribute_modifiers',
])

/** Compound value keys that contain components (T3 applies to ALL inner values). */
const COMPONENTS_KEYS = new Set([
  'components', 'minecraft:components',
])

// ---------------------------------------------------------------------------
// T1 — HandItems/ArmorItems -> equipment
// ---------------------------------------------------------------------------

function applyT1(line: string, cStart: number, cEnd: number): { line: string; changed: boolean } {
  const entries = splitCompound(line, cStart, cEnd)
  const handIdx = entries.findIndex(e => stripColon(e.key) === 'HandItems')
  const armorIdx = entries.findIndex(e => stripColon(e.key) === 'ArmorItems')
  if (handIdx < 0 && armorIdx < 0) return { line, changed: false }

  // Determine replace range: from first HandItems/ArmorItems key to last value
  const firstIdx = Math.min(
    handIdx >= 0 ? handIdx : Infinity,
    armorIdx >= 0 ? armorIdx : Infinity,
  )
  const lastIdx = Math.max(handIdx, armorIdx)
  const replaceStart = entries[firstIdx].kStart
  const replaceEnd = entries[lastIdx].vEnd

  // Parse array elements
  function parseArray(entry: Entry): string[] {
    const val = line.slice(entry.vStart, entry.vEnd).trim()
    if (!val.startsWith('[')) return []
    const elems: string[] = []
    let i = 1
    const arrEnd = val.length - 1
    while (i < arrEnd) {
      while (i < arrEnd && (val[i] === ',' || val[i] === ' ' || val[i] === '\t')) i++
      if (i >= arrEnd) break
      const s = i
      const ch = val[i]
      if (ch === '{' || ch === '[') {
        const open = ch; const close = ch === '{' ? '}' : ']'
        let depth = 0; let inQ = false; let qC = ''; let esc = false
        while (i < arrEnd) {
          const c = val[i]
          if (esc) { esc = false; i++; continue }
          if (c === '\\' && inQ) { esc = true; i++; continue }
          if (inQ) { if (c === qC) inQ = false; i++; continue }
          if (c === '"' || c === "'") { inQ = true; qC = c; i++; continue }
          if (c === open) depth++
          else if (c === close) { depth--; if (depth === 0) { i++; break } }
          i++
        }
        elems.push(val.slice(s, i))
      } else if (ch === '"' || ch === "'") {
        let i2 = i + 1
        while (i2 < arrEnd) {
          if (val[i2] === '\\' && i2 + 1 < arrEnd) { i2 += 2; continue }
          if (val[i2] === ch) { i2++; break }
          i2++
        }
        elems.push(val.slice(s, i2)); i = i2
      } else {
        while (i < arrEnd && val[i] !== ',') i++
        elems.push(val.slice(s, i).trim())
      }
    }
    return elems
  }

  const handItems = handIdx >= 0 ? parseArray(entries[handIdx]) : []
  const armorItems = armorIdx >= 0 ? parseArray(entries[armorIdx]) : []

  // Build equipment parts
  const parts: [string, string][] = []
  for (let i = 0; i < handItems.length; i++) {
    const slot = HAND_SLOTS[i]
    if (slot && handItems[i].trim() !== '{}') parts.push([slot, handItems[i]])
  }
  for (let i = 0; i < armorItems.length; i++) {
    const slot = ARMOR_SLOTS[i]
    if (slot && armorItems[i].trim() !== '{}') parts.push([slot, armorItems[i]])
  }
  if (parts.length === 0) return { line, changed: false }

  // Sort into canonical order
  const sorted: string[] = []
  for (const slot of EQUIP_ORDER) {
    const p = parts.find(([s]) => s === slot)
    if (p) sorted.push(`${p[0]}:${p[1]}`)
  }

  const replacement = `equipment:{${sorted.join(',')}}`
  return {
    line: line.slice(0, replaceStart) + replacement + line.slice(replaceEnd),
    changed: true,
  }
}

// ---------------------------------------------------------------------------
// T2 — Attribute prefix normalization inside attribute_modifiers arrays
// ---------------------------------------------------------------------------

function applyT2(line: string, cStart: number, cEnd: number): { line: string; changed: boolean } {
  const entries = splitCompound(line, cStart, cEnd)
  let changed = false
  let result = line

  for (const entry of entries) {
    const k = stripColon(entry.key)
    if (!ATTR_MOD_KEYS.has(k)) continue

    // Process the array value: find type:/AttributeName: values and fix prefixes
    const val = result.slice(entry.vStart, entry.vEnd)
    // Handle quoted values: "player.X" or "generic.X"
    let newVal = val.replace(
      /((?:type|AttributeName)\s*:\s*")((?:player|generic)\.([^"]*))"/g,
      (_match: string, prefix: string, _val: string, inner: string) => {
        if (_val.startsWith('player.')) {
          changed = true
          return prefix + `minecraft:${inner}"`
        }
        if (_val.startsWith('generic.')) {
          changed = true
          return prefix + `${inner}"`
        }
        return _match
      },
    )
    // Also handle unquoted values: type:player.X or type:generic.X
    newVal = newVal.replace(
      /((?:type|AttributeName)\s*:\s*)(player\.[a-zA-Z0-9_.]+|generic\.[a-zA-Z0-9_.]+)/g,
      (_match: string, prefix: string, val2: string) => {
        if (val2.startsWith('player.')) {
          changed = true
          return prefix + `"minecraft:${val2.slice(7)}"`
        }
        if (val2.startsWith('generic.')) {
          changed = true
          return prefix + `"${val2.slice(8)}"`
        }
        return _match
      },
    )
    if (changed) {
      result = result.slice(0, entry.vStart) + newVal + result.slice(entry.vEnd)
    }
  }
  return { line: result, changed }
}

// ---------------------------------------------------------------------------
// T3 — Stringified JSON -> structured
// ---------------------------------------------------------------------------

function applyT3Single(line: string, cStart: number, cEnd: number): { line: string; changed: boolean } {
  const entries = splitCompound(line, cStart, cEnd)
  let changed = false
  let result = line
  let offset = 0 // cumulative offset from previous modifications

  for (const entry of entries) {
    const k = stripColon(entry.key)
    // Adjust positions by cumulative offset from prior modifications in this compound
    const vStart = entry.vStart + offset
    const vEnd = entry.vEnd + offset

    // Handle lore arrays (special case: value is an array of stringified JSON)
    // Matches both bare 'lore' and namespaced 'minecraft:lore'
    if (k === 'lore' || k === 'minecraft:lore') {
      const valRaw = result.slice(vStart, vEnd).trim()
      if (valRaw.startsWith('[')) {
        const proc = unstringifyLoreArray(valRaw)
        if (proc.changed) {
          const vf = result.slice(vStart, vEnd)
          const off = vf.length - vf.trimStart().length
          const endOff = vf.length - vf.trimEnd().length
          const oldLen = (vEnd - endOff) - (vStart + off)
          result = result.slice(0, vStart + off) + proc.value + result.slice(vEnd - endOff)
          offset += proc.value.length - oldLen
          changed = true
        }
      }
      continue
    }

    // Check if this key is a text-component key
    if (TEXT_COMP_KEYS.has(k)) {
      // Check the value
      const valRaw = result.slice(vStart, vEnd).trim()
      if (valRaw.length < 2) continue
      if (valRaw[0] !== '"' && valRaw[0] !== "'") continue

      // Try to unstringify a single JSON value
      const jsonStr = tryUnstringJson(valRaw)
      if (!jsonStr) continue

      const vf = result.slice(vStart, vEnd)
      const off = vf.length - vf.trimStart().length
      const endOff = vf.length - vf.trimEnd().length
      const oldLen = (vEnd - endOff) - (vStart + off)
      result = result.slice(0, vStart + off) + jsonStr + result.slice(vEnd - endOff)
      offset += jsonStr.length - oldLen
      changed = true
      continue
    }

    // Recurse into any compound value to find text components and lore at deeper levels
    const val = result.slice(vStart, vEnd).trim()
    if (val.startsWith('{')) {
      const sub = applyT3Single(result, vStart, vEnd)
      if (sub.changed) { offset += sub.line.length - result.length; result = sub.line; changed = true }
    }
  }

  return { line: result, changed }
}

function unstringifyLoreArray(val: string): { value: string; changed: boolean } {
  if (!val.startsWith('[')) return { value: val, changed: false }
  const result: string[] = ['[']
  let changed = false
  let i = 1
  const end = val.length - 1 // before ']'
  while (i < end) {
    while (i < end && (val[i] === ',' || val[i] === ' ')) i++
    if (i >= end) break
    const ch = val[i]
    if (ch === '"' || ch === "'") {
      // read quoted string
      let tok = ''
      const tokStart = i
      i++ // skip opening quote
      while (i < end) {
        if (val[i] === '\\' && i + 1 < end) { tok += val[i] + val[i+1]; i += 2; continue }
        if (val[i] === ch) { i++; break }
        tok += val[i]; i++
      }
      // tok is the unescaped content
      const jsonStr = tryUnstringJson(val.slice(tokStart, i))
      if (jsonStr) {
        result.push(jsonStr)
        changed = true
      } else {
        result.push(val.slice(tokStart, i))
      }
    } else {
      // non-string element: copy until comma/bracket
      let chunk = ''
      while (i < end && val[i] !== ',') { chunk += val[i]; i++ }
      result.push(chunk)
    }
    if (i < end) result.push(',')
  }
  result.push(']')
  return { value: result.join(''), changed }
}

// ---------------------------------------------------------------------------
// T4 — Count:1b -> count:1
// ---------------------------------------------------------------------------

function applyT4(line: string, cStart: number, cEnd: number): { line: string; changed: boolean } {
  const entries = splitCompound(line, cStart, cEnd)
  const idEntry = entries.find(e => stripColon(e.key) === 'id')
  const countEntry = entries.find(e => stripColon(e.key) === 'Count')
  if (!idEntry || !countEntry) return { line, changed: false }

  // id value must be a string (quoted)
  const idVal = line.slice(idEntry.vStart, idEntry.vEnd).trim()
  if (idVal[0] !== '"' && idVal[0] !== "'") return { line, changed: false }

  // Count value: strip byte suffix
  const countVal = line.slice(countEntry.vStart, countEntry.vEnd).trim()
  const stripped = countVal.replace(/^(-?\d+)b$/i, '$1')
  if (stripped === countVal) return { line, changed: false }

  // Build replacement: rename key and update value
  const newKey = 'count'
  const vf = line.slice(countEntry.vStart, countEntry.vEnd)
  const off = vf.length - vf.trimStart().length
  const endOff = vf.length - vf.trimEnd().length

  return {
    line: line.slice(0, countEntry.kStart) + newKey + ':' + stripped + line.slice(countEntry.vEnd - endOff),
    changed: true,
  }
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

/**
 * Find the compound in `nc` closest to `targetStart` by start position.
 * Returns undefined if `nc` is empty.
 */
function closestCompound(nc: Span[], targetStart: number): Span | undefined {
  let best: Span | undefined
  let bestDist = Infinity
  for (const c of nc) {
    const d = Math.abs(c.start - targetStart)
    if (d < bestDist) { bestDist = d; best = c }
  }
  return best
}

/**
 * Apply all NBT transforms (T1-T4) to a single line of an mcfunction file.
 * Skips comments and FIXED markers. Processes all compounds found in the line.
 * Returns the (possibly modified) line and whether any changes were made.
 */
export function rewriteNbtInLine(line: string): { line: string; changed: boolean } {
  const trimmed = line.trim()
  if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith('## FIXED')) {
    return { line, changed: false }
  }

  let result = line
  let anyChanged = false

  // Process compounds right-to-left so earlier offsets stay valid.
  // Transform replacements only ever shrink text inside a compound, so start
  // offsets never move but end offsets go stale — re-locate each compound in
  // the current line by its start before working on it.
  const compounds = findCompounds(result)
  for (let ci = compounds.length - 1; ci >= 0; ci--) {
    let comp = closestCompound(findCompounds(result), compounds[ci].start)
    if (!comp || comp.end > result.length || result[comp.start] !== '{') continue

    // T1: Equipment
    let t = applyT1(result, comp.start, comp.end)
    if (t.changed) { result = t.line; anyChanged = true }
    // Re-find compound after potential replacement — pick closest by start position
    let nc = findCompounds(result)
    comp = closestCompound(nc, comp.start) ?? comp

    // T2: Attribute prefixes
    t = applyT2(result, comp.start, comp.end)
    if (t.changed) { result = t.line; anyChanged = true }
    nc = findCompounds(result)
    comp = closestCompound(nc, comp.start) ?? comp

    // T3: Stringified JSON -> structured
    t = applyT3Single(result, comp.start, comp.end)
    if (t.changed) { result = t.line; anyChanged = true }
    nc = findCompounds(result)
    comp = closestCompound(nc, comp.start) ?? comp

    // T4: Count -> count
    t = applyT4(result, comp.start, comp.end)
    if (t.changed) { result = t.line; anyChanged = true }
  }

  return { line: result, changed: anyChanged }
}
