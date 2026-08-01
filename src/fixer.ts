import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, statSync } from 'node:fs'
import { join, relative, dirname } from 'node:path'
import { readPackMcmeta } from './pack-mcmeta.js'
import { fetchVersions } from './api.js'
import { getMcdocSymbols, checkMcdocFile, cmpVer, fixMcdocFileData } from './mcdoc-check.js'
import { FEATURE_RULES, type FeatureRule } from './knowledge.js'
import { tokenizeCommand } from './tokenizer.js'
import { versionNameToDataVersion } from './version.js'
import { CMD_REWRITES, type CmdRewrite } from './rules.js'
import type { McmetaVersion } from './types.js'

export interface FixOptions {
  datapackDir: string
  outputDir: string
  targetVersion: string
  targetPackFormat?: number
  sourceVersion?: string
  onProgress?: (message: string, current?: number, total?: number) => void
}

export interface FixFileResult {
  file: string
  patches: number
  details: string[]
}

export interface FixRewriteEntry {
  id: string
  description: string
  count: number
  files: string[]
}

export interface FixJsonFixEntry {
  type: string
  count: number
  files: string[]
}

export interface FixManualEntry {
  description: string
  reason: string
  files: string[]
}

export interface FixCascadeEntry {
  trigger: string
  triggerFile: string
  affectedFiles: string[]
  description: string
}

export interface FixPlan {
  sourceVersion: string
  targetVersion: string
  direction: 'forward' | 'backward'
  rewrites: FixRewriteEntry[]
  jsonFixes: FixJsonFixEntry[]
  manualAttention: FixManualEntry[]
  cascadeEffects: FixCascadeEntry[]
  summary: {
    totalFilesToPatch: number
    commandRewrites: number
    jsonFixes: number
    manualAttention: number
    mcdocRemovals: number
    packMcmetaUpdate: boolean
  }
}

// ---------------------------------------------------------------------------
// Command rewrite patterns
// Each strategy applies when porting FROM sourceVer TO targetVer.
// The rule data lives in the single source of truth (./rules.js); this module
// re-exports CMD_REWRITES + CmdRewrite so existing importers keep working.
// ---------------------------------------------------------------------------

export { CMD_REWRITES, type CmdRewrite }

// ---------------------------------------------------------------------------
// Knowledge-rule-driven fix summaries (added as comments to mcfunction files)
// ---------------------------------------------------------------------------

function getApplicableFixes(
  sourceVer: McmetaVersion | null,
  targetVer: McmetaVersion | null,
  sourceName: string,
  targetName: string,
  allVersions: McmetaVersion[],
): { rewrites: CmdRewrite[]; removals: FeatureRule[] } {
  const rewrites: CmdRewrite[] = []
  const removals: FeatureRule[] = []

  const svDv = sourceVer?.data_version ?? 0
  const tvDv = targetVer?.data_version ?? 0
  const portingForward = tvDv >= svDv

  for (const rw of CMD_REWRITES) {
    // Check if source version matches the rewrite's sourceSince
    const rwSourceSinceDv = rw.sourceSince
      ? versionNameToDataVersion(rw.sourceSince, allVersions)
      : null
    const rwTargetUntilDv = rw.targetUntil && rw.targetUntil !== '0'
      ? versionNameToDataVersion(rw.targetUntil, allVersions)
      : null
    const rwTargetSinceDv = rw.targetSince
      ? versionNameToDataVersion(rw.targetSince, allVersions)
      : null

    // Source must be >= sourceSince (the feature exists in source)
    if (rwSourceSinceDv !== null && svDv < rwSourceSinceDv) continue
    // Target must be <= targetUntil (the feature doesn't exist in target)
    if (rwTargetUntilDv !== null && tvDv > rwTargetUntilDv) continue
    // Target must be >= targetSince (the replacement feature exists in target)
    if (rwTargetSinceDv !== null && tvDv < rwTargetSinceDv) continue

    rewrites.push(rw)
  }

  // Collect feature rules for "new commands" that need removal when backporting
  for (const rule of FEATURE_RULES) {
    if (rule.type !== 'command') continue
    const ruleMinDv = versionNameToDataVersion(rule.minVersion, allVersions)
    if (ruleMinDv === null) continue
    // Feature exists in source (source >= rule.minVersion) but not in target (target < rule.minVersion)
    if (svDv >= ruleMinDv && tvDv < ruleMinDv) {
      // Only add if not already covered by a rewrite
      if (!rewrites.some(r => r.matchRoot === rule.match)) {
        removals.push(rule)
      }
    }
  }

  return { rewrites, removals }
}

// ---------------------------------------------------------------------------
// Mcfunction file fixing
// ---------------------------------------------------------------------------

/** Try to apply a single rewrite to a command string. Returns new string or null. */
function tryApplyRewrite(cmdText: string, rw: CmdRewrite): string | null {
  const cmdLine = cmdText.startsWith('/') ? cmdText : '/' + cmdText
  const tokens = tokenizeCommand(cmdLine)
  if (tokens.length === 0) return null
  const root = tokens[0].value.replace(/^\//, '')
  if (root !== rw.matchRoot && rw.matchRoot !== '') return null

  const newLine = cmdLine.replace(rw.pattern, rw.replacement)
  if (newLine === cmdLine) return null
  // Normalize: if original had no leading slash, remove it from result
  return cmdText.startsWith('/') ? newLine : newLine.replace(/^\//, '')
}

/** Given a tokenized /execute ... run ... line, return { text, start, end } of the sub-command */
function extractRunSubcommand(tokens: import('./tokenizer.js').Token[]): { text: string; start: number; end: number } | null {
  if (tokens.length < 3) return null
  if (tokens[0].value !== '/execute') return null
  for (let i = 1; i < tokens.length; i++) {
    if (tokens[i].value === 'run' && i + 1 < tokens.length) {
      const first = tokens[i + 1]
      const last = tokens[tokens.length - 1]
      return {
        text: tokens.slice(i + 1).map(t => t.value).join(' '),
        start: first.start,
        end: last.end,
      }
    }
  }
  return null
}

/** Find all `$(...)` macro expressions in a line */
function extractMacroContent(line: string): { start: number; end: number; content: string }[] {
  const results: { start: number; end: number; content: string }[] = []
  let depth = 0
  let dollarPos = -1
  for (let i = 0; i < line.length; i++) {
    const c = line[i]
    if (c === '$' && i + 1 < line.length && line[i + 1] === '(' && depth === 0) {
      dollarPos = i
      depth = 1
      i++
      continue
    }
    if (depth > 0) {
      if (c === '(') depth++
      else if (c === ')') {
        depth--
        if (depth === 0 && dollarPos >= 0) {
          results.push({
            start: dollarPos,
            end: i + 1,
            content: line.slice(dollarPos + 2, i),
          })
          dollarPos = -1
        }
      }
    }
  }
  return results
}

/**
 * Attempt to rewrite sub-commands inside /execute ... run ... or $() macros.
 * Modifies line in-place via patching. Returns { patched, details } or null.
 */
function tryRewriteSubCommands(
  trimmed: string,
  rewrites: CmdRewrite[],
  removals: FeatureRule[],
  line: string,
  relPath: string,
  lineNum: number,
): { line: string; patches: number; details: string[] } | null {
  const hasSlash = trimmed.startsWith('/')
  const tokenized = tokenizeCommand(hasSlash ? trimmed : '/' + trimmed)

  // --- /execute ... run <subcommand> ---
  const subCmd = extractRunSubcommand(tokenized)
  if (subCmd) {
    for (const rw of rewrites) {
      if (rw.id === 'macro_comment') continue
      const result = tryApplyRewrite(subCmd.text, rw)
      if (result !== null) {
        const indent = line.match(/^\s*/)?.[0] ?? ''
        if (rw.replacement.includes('## FIXED')) {
          return {
            line: `${indent}## FIXED(${rw.description} inside execute run): ${trimmed}`,
            patches: 1,
            details: [`${relPath}:${lineNum}: ${rw.description} (inside execute run)`],
          }
        }
        // subCmd.start is an offset into the possibly slash-prefixed string;
        // back it off by one when we prepended '/' so it slices `trimmed` correctly.
        const beforeRun = trimmed.slice(0, subCmd.start - (hasSlash ? 0 : 1))
        return {
          line: indent + beforeRun + result,
          patches: 1,
          details: [`${relPath}:${lineNum}: ${rw.description} (inside execute run)`],
        }
      }
    }
    // Check removal rules against sub-command
    for (const rule of removals) {
      const subTokens = tokenizeCommand('/' + subCmd.text)
      if (subTokens.length === 0) continue
      const root = subTokens[0].value.replace(/^\//, '')
      if (root === rule.match) {
        const indent = line.match(/^\s*/)?.[0] ?? ''
        return {
          line: `${indent}## FIXED(${rule.match} requires ${rule.minVersion}+ inside execute run): ${trimmed}`,
          patches: 1,
          details: [`${relPath}:${lineNum}: Commented out ${rule.match} inside execute run (needs ${rule.minVersion}+)`],
        }
      }
    }
  }

  // --- $() macro expressions ---
  const macros = extractMacroContent(trimmed)
  if (macros.length > 0) {
    let result = trimmed
    let linePatched = false
    const details: string[] = []

    for (const macro of macros) {
      const macroTrimmed = macro.content.trim()
      for (const rw of rewrites) {
        if (rw.id === 'macro_comment') continue
        const macroCmd = macroTrimmed.startsWith('/') ? macroTrimmed : '/' + macroTrimmed
        const tokens = tokenizeCommand(macroCmd)
        if (tokens.length === 0) continue
        const root = tokens[0].value.replace(/^\//, '')
        if (root !== rw.matchRoot && rw.matchRoot !== '') continue
        if (rw.pattern.test(macroCmd)) {
          // Reconstruct the pattern match safely for use in a macro
          if (rw.replacement.includes('## FIXED')) {
            // Comment-out style: wrap the inner command in a FIXED note
            const inner = `## FIXED(${rw.description}): ${macroTrimmed}`
            result = result.slice(0, macro.start) + '$(' + inner + ')' + result.slice(macro.end)
          } else {
            const replacement = macroCmd.replace(rw.pattern, rw.replacement.replace(/\$0/g, '$$&'))
            const inner = replacement.startsWith('/') ? replacement.slice(1) : replacement
            result = result.slice(0, macro.start) + '$(' + inner + ')' + result.slice(macro.end)
          }
          linePatched = true
          details.push(`${relPath}:${lineNum}: ${rw.description} (inside macro)`)
          break
        }
      }
    }

    if (linePatched) {
      const indent = line.match(/^\s*/)?.[0] ?? ''
      return { line: indent + result, patches: details.length, details }
    }
  }

  return null
}

function fixMcfunctionFile(
  content: string,
  relPath: string,
  rewrites: CmdRewrite[],
  removals: FeatureRule[],
): { result: string; patches: number; details: string[] } {
  const lines = content.split('\n')
  const details: string[] = []
  let patches = 0
  const resultLines: string[] = []

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) {
      resultLines.push(line)
      continue
    }

    let fixed = line
    let linePatched = false
    const cmdLine = trimmed.startsWith('/') ? trimmed : '/' + trimmed

    // Pass 1: direct top-level rewrite
    for (const rw of rewrites) {
      if (rw.id === 'macro_comment') {
        if (rw.pattern.test(trimmed)) {
          fixed = `## FIXED: $(macro) syntax not available (pre-1.20.4) — original: ${trimmed}`
          linePatched = true
          patches++
          details.push(`${relPath}:${i + 1}: ${rw.description}`)
          break
        }
        continue
      }

      const result = tryApplyRewrite(trimmed, rw)
      if (result !== null) {
        const indent = line.match(/^\s*/)?.[0] ?? ''
        if (rw.replacement.includes('## FIXED')) {
          fixed = `${indent}## FIXED(${rw.description}): ${trimmed}`
        } else {
          fixed = indent + result
        }
        linePatched = true
        patches++
        details.push(`${relPath}:${i + 1}: ${rw.description}`)
        break
      }
    }

    // Pass 2: removal rules (first-token matching)
    if (!linePatched) {
      for (const rule of removals) {
        const tokens = tokenizeCommand(cmdLine)
        if (tokens.length === 0) continue
        const root = tokens[0].value.replace(/^\//, '')
        if (root === rule.match) {
          const indent = line.match(/^\s*/)?.[0] ?? ''
          fixed = `${indent}## FIXED(${rule.match} requires ${rule.minVersion}+): ${trimmed}`
          linePatched = true
          patches++
          details.push(`${relPath}:${i + 1}: Commented out ${rule.match} (needs ${rule.minVersion}+)`)
          break
        }
      }
    }

    // Pass 3: sub-commands inside /execute run and macro $()
    if (!linePatched) {
      const subResult = tryRewriteSubCommands(trimmed, rewrites, removals, line, relPath, i + 1)
      if (subResult) {
        fixed = subResult.line
        linePatched = true
        patches += subResult.patches
        details.push(...subResult.details)
      }
    }

    resultLines.push(fixed)
  }

  return { result: resultLines.join('\n'), patches, details }
}

// ---------------------------------------------------------------------------
// Pack.mcmeta updater
// ---------------------------------------------------------------------------

function updatePackMcmeta(
  datapackDir: string,
  targetPackFormat: number,
): { content: string; changed: boolean } {
  const path = join(datapackDir, 'pack.mcmeta')
  const content = readFileSync(path, 'utf-8')
  let parsed: any
  try {
    parsed = JSON.parse(content)
  } catch {
    return { content, changed: false }
  }

  if (!parsed.pack) {
    return { content, changed: false }
  }

  const oldFormat = parsed.pack.pack_format
  const isNewStyle = parsed.pack.min_format !== undefined || parsed.pack.max_format !== undefined
  if (isNewStyle) {
    // 25w31a+ tuple format: keep pack_format absent, rewrite the range tuples.
    parsed.pack.min_format = [targetPackFormat, 0]
    if (parsed.pack.max_format !== undefined) parsed.pack.max_format = [targetPackFormat, 0]
    return { content: JSON.stringify(parsed, null, 2) + '\n', changed: true }
  }

  if (oldFormat === targetPackFormat) {
    return { content, changed: false }
  }

  parsed.pack.pack_format = targetPackFormat
  // Remove supported_formats if it would be a single-version range
  if (parsed.pack.supported_formats) {
    delete parsed.pack.supported_formats
  }

  return { content: JSON.stringify(parsed, null, 2) + '\n', changed: true }
}

// ---------------------------------------------------------------------------
// Walk directory tree for mcfunction and JSON files
// ---------------------------------------------------------------------------

function collectFiles(dir: string): { mcfunction: string[]; json: string[] } {
  const mcfunction: string[] = []
  const json: string[] = []
  function walk(d: string) {
    let entries: string[]
    try {
      entries = readdirSync(d)
    } catch { return }
    for (const entry of entries) {
      const full = join(d, entry)
      let s: any
      try { s = statSync(full) } catch { continue }
      if (s.isDirectory()) walk(full)
      else if (entry.endsWith('.mcfunction')) mcfunction.push(full)
      else if (entry.endsWith('.json') && entry !== 'pack.mcmeta') json.push(full)
    }
  }
  walk(dir)
  return { mcfunction, json }
}

// ---------------------------------------------------------------------------
// Advancement icon format fixing (1.20.5+ -> pre-1.20.5)
// ---------------------------------------------------------------------------

function fixAdvancementIcon(
  data: any,
  targetName: string,
  relPath: string,
): { data: any; patches: number; details: string[] } {
  const tvDv = versionNameToDataVersion(targetName, [])
  const details: string[] = []
  let patches = 0

  // 1.20.5+ format: "icon": { "id": "minecraft:diamond", "components": { ... } }
  // Pre-1.20.5 format: "icon": { "item": "minecraft:diamond", "nbt": "{...}" }
  function walk(obj: any, path: string): any {
    if (!obj || typeof obj !== 'object') return obj
    if (Array.isArray(obj)) {
      return obj.map((item, i) => walk(item, `${path}[${i}]`))
    }
    const result: any = {}
    for (const [key, val] of Object.entries(obj)) {
      if (key === 'icon' && val && typeof val === 'object' && 'id' in val) {
        const iconVal = val as Record<string, unknown>
        const newIcon: Record<string, unknown> = { item: iconVal.id }
        if (iconVal.components) {
          // Try to convert components to NBT string
          const nbtParts: string[] = []
          for (const [ck, cv] of Object.entries(iconVal.components as Record<string, unknown>)) {
            nbtParts.push(`${ck}:${JSON.stringify(cv)}`)
          }
          if (nbtParts.length > 0) {
            newIcon.nbt = `{${nbtParts.join(',')}}`
          }
        }
        result[key] = newIcon
        patches++
        details.push(`${relPath}:$: Converted advancement icon to pre-1.20.5 format`)
      } else {
        result[key] = walk(val, `${path}.${key}`)
      }
    }
    return result
  }

  return { data: walk(data, '$'), patches, details }
}

// ---------------------------------------------------------------------------
// Biome precipitation field rename (1.19.4 backport)
// ---------------------------------------------------------------------------

function renameBiomeField(
  data: any,
  targetName: string,
  relPath: string,
): { data: any; patches: number; details: string[] } {
  const details: string[] = []
  let patches = 0

  function walk(obj: any): any {
    if (!obj || typeof obj !== 'object') return obj
    if (Array.isArray(obj)) return obj.map(walk)
    const result: any = {}
    for (const [key, val] of Object.entries(obj)) {
      if (key === 'has_precipitation' && typeof val === 'boolean') {
        result['precipitation'] = val ? 'rain' : 'none'
        patches++
        details.push(`${relPath}: Renamed has_precipitation -> precipitation for pre-1.19.4`)
      } else {
        result[key] = walk(val)
      }
    }
    return result
  }

  return { data: walk(data), patches, details }
}

// ---------------------------------------------------------------------------
// Predicate any_of -> alternative rename (1.20 backport)
// ---------------------------------------------------------------------------

function renamePredicateFields(
  data: any,
  targetName: string,
  relPath: string,
): { data: any; patches: number; details: string[] } {
  const details: string[] = []
  let patches = 0

  function walk(obj: any): any {
    if (!obj || typeof obj !== 'object') return obj
    if (Array.isArray(obj)) return obj.map(walk)
    const result: any = {}
    for (const [key, val] of Object.entries(obj)) {
      if (key === 'any_of') {
        result['alternative'] = walk(val)
        patches++
        details.push(`${relPath}: Renamed any_of -> alternative for pre-1.20`)
      } else if (key === 'all_of') {
        result['requirements'] = walk(val)
        patches++
        details.push(`${relPath}: Renamed all_of -> requirements for pre-1.20`)
      } else {
        result[key] = walk(val)
      }
    }
    return result
  }

  return { data: walk(data), patches, details }
}

function fileToResourceId(relPath: string): string | null {
  if (relPath.endsWith('.mcfunction')) {
    const m = relPath.match(/^data\/([^/]+)\/functions\/(.+)\.mcfunction$/)
    if (m) return `${m[1]}:${m[2].replace(/\//g, '/')}`
    return null
  }
  if (relPath.endsWith('.json')) {
    const m = relPath.match(/^data\/([^/]+)\/(loot_tables|advancements|recipes|predicates|item_modifiers|functions|tags\/[^/]+|worldgen\/[^/]+)\/(.+)\.json$/)
    if (m) return `${m[1]}:${m[3].replace(/\//g, '/')}`
    const m2 = relPath.match(/^data\/([^/]+)\/(loot_table|advancement|recipe|predicate|item_modifier|function)\/(.+)\.json$/)
    if (m2) return `${m2[1]}:${m2[3].replace(/\//g, '/')}`
    return null
  }
  return null
}

interface SimpleRef {
  from: string
  to: string
  file: string
  line?: number
}

function collectReferences(files: { file: string; content: string }[]): SimpleRef[] {
  const refs: SimpleRef[] = []

  for (const { file, content } of files) {
    if (file.endsWith('.mcfunction')) {
      const lines = content.split('\n')
      for (let i = 0; i < lines.length; i++) {
        const trimmed = lines[i].trim()
        if (!trimmed || trimmed.startsWith('#')) continue
        const tokens = tokenizeCommand(trimmed.startsWith('/') ? trimmed : '/' + trimmed)
        if (tokens.length === 0) continue
        const root = tokens[0].value.replace(/^\//, '')

        if (root === 'function' && tokens.length > 1 && tokens[1].value.includes(':')) {
          refs.push({ from: file, to: tokens[1].value, file, line: i + 1 })
        }
        if (root === 'schedule' && tokens.length > 2 && tokens[1].value === 'function' && tokens[2].value.includes(':')) {
          refs.push({ from: file, to: tokens[2].value, file, line: i + 1 })
        }
        if (root === 'execute') {
          for (let j = 1; j < tokens.length; j++) {
            if ((tokens[j].value === 'if' || tokens[j].value === 'unless') && j + 2 < tokens.length) {
              const subType = tokens[j + 1].value
              if ((subType === 'predicate' || subType === 'function') && tokens[j + 2].value.includes(':')) {
                refs.push({ from: file, to: tokens[j + 2].value, file, line: i + 1 })
              }
            }
          }
        }
        if (root === 'loot' && tokens.length > 1 && tokens[1].value.includes(':')) {
          refs.push({ from: file, to: tokens[1].value, file, line: i + 1 })
        }
      }
    } else if (file.endsWith('.json')) {
      let data: any
      try { data = JSON.parse(content) } catch { continue }
      const walk = (obj: any) => {
        if (!obj || typeof obj !== 'object') return
        if (Array.isArray(obj)) { obj.forEach(walk); return }
        for (const [key, val] of Object.entries(obj)) {
          if (typeof val === 'string' && val.includes(':') && !val.startsWith('#') && !val.startsWith('$')) {
            if (key === 'function' || key === 'loot_table' || key === 'condition' || key === 'parent' || key === 'item' || key === 'result') {
              refs.push({ from: file, to: val, file })
            }
          }
          if (key === 'values' && Array.isArray(val)) {
            for (const item of val) {
              if (typeof item === 'string' && item.includes(':') && !item.startsWith('#')) {
                refs.push({ from: file, to: item, file })
              }
            }
          }
          if (typeof val === 'object') walk(val)
        }
      }
      walk(data)
    }
  }

  return refs
}

function generateFixPlan(
  sourceVer: McmetaVersion,
  targetVer: McmetaVersion,
  rewrites: CmdRewrite[],
  removals: FeatureRule[],
  mcfunctionFiles: string[],
  jsonFiles: string[],
  baseDir: string,
): FixPlan {
  const sourceName = sourceVer.name
  const targetName = targetVer.name
  const portingForward = targetVer.data_version >= sourceVer.data_version

  const rewriteMap = new Map<string, FixRewriteEntry>()
  const manualAttention: FixManualEntry[] = []
  const jsonFixes: FixJsonFixEntry[] = []

  const seenManual = new Set<string>()

  for (const file of mcfunctionFiles) {
    const rel = relative(baseDir, file).replace(/\\/g, '/')
    const content = readFileSync(file, 'utf-8')
    const lines = content.split('\n')

    for (const line of lines) {
      const trimmed = line.trim()
      if (!trimmed || trimmed.startsWith('#')) continue
      const cmdLine = trimmed.startsWith('/') ? trimmed : '/' + trimmed

      for (const rw of rewrites) {
        if (!rw.pattern.test(cmdLine)) continue
        if (!rewriteMap.has(rw.id)) {
          rewriteMap.set(rw.id, { id: rw.id, description: rw.description, count: 0, files: [] })
        }
        const entry = rewriteMap.get(rw.id)!
        entry.count++
        if (!entry.files.includes(rel)) entry.files.push(rel)
      }

      const tokens = tokenizeCommand(cmdLine)
      if (tokens.length === 0) continue
      const root = tokens[0].value.replace(/^\//, '')
      for (const rule of removals) {
        if (rule.match !== root) continue
        const key = rule.id
        if (!seenManual.has(key)) {
          seenManual.add(key)
          manualAttention.push({
            description: rule.description,
            reason: rule.fix || 'No automatic rewrite available',
            files: [],
          })
        }
        const entry = manualAttention.find(m => m.description === rule.description)
        if (entry && !entry.files.includes(rel)) entry.files.push(rel)
      }
    }
  }

  const jfTypes = ['advancement_icon', 'biome_field_rename', 'predicate_field_rename', 'registry_comment', 'mcdoc_removal']
  for (const type of jfTypes) {
    jsonFixes.push({ type, count: 0, files: [] })
  }

  for (const file of jsonFiles) {
    const rel = relative(baseDir, file).replace(/\\/g, '/')
    if (!portingForward && (rel.includes('/advancement') || rel.includes('/advancements'))) {
      const jf = jsonFixes.find(f => f.type === 'advancement_icon')
      if (jf && !jf.files.includes(rel)) jf.files.push(rel)
    }
    if (rel.includes('/worldgen/biome')) {
      const jf = jsonFixes.find(f => f.type === 'biome_field_rename')
      if (jf && !jf.files.includes(rel)) jf.files.push(rel)
    }
    if (rel.includes('/predicate') || rel.includes('/predicates')) {
      const jf = jsonFixes.find(f => f.type === 'predicate_field_rename')
      if (jf && !jf.files.includes(rel)) jf.files.push(rel)
    }
  }

  const rewritesList = Array.from(rewriteMap.values()).sort((a, b) => b.count - a.count)
  const rewritesCount = rewritesList.reduce((s, r) => s + r.count, 0)
  const jsonFixesTotal = jsonFixes.reduce((s, f) => s + f.files.length, 0)

  const filesAffected = new Set<string>()
  for (const r of rewritesList) r.files.forEach(f => filesAffected.add(f))
  for (const m of manualAttention) m.files.forEach(f => filesAffected.add(f))
  for (const j of jsonFixes) j.files.forEach(f => filesAffected.add(f))

  // Compute cascade effects: find files that reference resources defined in patched files
  const cascadeEffects: FixCascadeEntry[] = []
  const allFiles = [...mcfunctionFiles, ...jsonFiles]

  for (const patchedFile of filesAffected) {
    const resourceId = fileToResourceId(patchedFile)
    if (!resourceId) continue

    const affected: string[] = []
    const refs = collectReferences(allFiles.map(f => ({ file: relative(baseDir, f).replace(/\\/g, '/'), content: readFileSync(f, 'utf-8') })))

    for (const ref of refs) {
      if (ref.to === resourceId && patchedFile !== ref.file) {
        if (!affected.includes(ref.file)) affected.push(ref.file)
      }
    }

    if (affected.length > 0) {
      cascadeEffects.push({
        trigger: resourceId,
        triggerFile: patchedFile,
        description: `Changes to ${patchedFile} may affect consumers (found in ${affected.length} file${affected.length !== 1 ? 's' : ''})`,
        affectedFiles: affected,
      })
    }
  }

  return {
    sourceVersion: sourceName,
    targetVersion: targetName,
    direction: portingForward ? 'forward' : 'backward',
    rewrites: rewritesList,
    jsonFixes,
    manualAttention,
    cascadeEffects,
    summary: {
      totalFilesToPatch: filesAffected.size,
      commandRewrites: rewritesCount,
      jsonFixes: jsonFixesTotal,
      manualAttention: manualAttention.length,
      mcdocRemovals: 0,
      packMcmetaUpdate: true,
    },
  }
}

export async function fixDatapack(options: FixOptions): Promise<{
  results: FixFileResult[]
  plan: FixPlan
  summary: { filesFixed: number; totalPatches: number; errors: string[] }
}> {
  const { datapackDir, outputDir, targetVersion, sourceVersion: explicitSource } = options
  const allVersions = await fetchVersions()
  const targetVer = allVersions.find(v => v.name === targetVersion || v.id === targetVersion)
  if (!targetVer) {
    const plan: FixPlan = {
      sourceVersion: '', targetVersion, direction: 'forward',
      rewrites: [], jsonFixes: [], manualAttention: [], cascadeEffects: [],
      summary: { totalFilesToPatch: 0, commandRewrites: 0, jsonFixes: 0, manualAttention: 0, mcdocRemovals: 0, packMcmetaUpdate: false },
    }
    return { results: [], plan, summary: { filesFixed: 0, totalPatches: 0, errors: [`Target version '${targetVersion}' not found`] } }
  }

  // Determine source version
  let sourceVer: McmetaVersion | null = null
  if (explicitSource) {
    sourceVer = allVersions.find(v => v.name === explicitSource || v.id === explicitSource) ?? null
  }
  if (!sourceVer) {
    // Try from pack.mcmeta
    try {
      const { supported_formats, min_format, max_format } = readPackMcmeta(datapackDir)
      if (min_format) {
        // 25w31a+ tuples: source is the newest version matching max_format;
        // a missing max_format means "any newer format".
        const maxMajor = max_format ? max_format[0] : Math.max(...allVersions.map(v => v.data_pack_version ?? 0))
        const maxMinor = max_format ? max_format[1] : 0
        sourceVer = allVersions.find(v => v.data_pack_version === maxMajor && (v.data_pack_version_minor ?? 0) === maxMinor)
          ?? allVersions.find(v => v.data_pack_version === maxMajor)
          ?? null
      } else if (supported_formats) {
        sourceVer = allVersions.find(v => v.data_pack_version === supported_formats.max) ?? null
      }
    } catch { }
  }
  if (!sourceVer) {
    const plan: FixPlan = {
      sourceVersion: '', targetVersion, direction: 'forward',
      rewrites: [], jsonFixes: [], manualAttention: [], cascadeEffects: [],
      summary: { totalFilesToPatch: 0, commandRewrites: 0, jsonFixes: 0, manualAttention: 0, mcdocRemovals: 0, packMcmetaUpdate: false },
    }
    return { results: [], plan, summary: { filesFixed: 0, totalPatches: 0, errors: ['Could not determine source version. Use --from-version <ver>'] } }
  }

  const sourceName = sourceVer.name
  const targetName = targetVer.name

  // Load mcdoc symbols for structural fixing
  let mcdocTable: any = null
  try {
    mcdocTable = await getMcdocSymbols()
  } catch { }

  // Determine applicable rewrites
  const { rewrites, removals } = getApplicableFixes(sourceVer, targetVer, sourceName, targetName, allVersions)
  const portingForward = targetVer.data_version >= sourceVer.data_version

  // Collect files from data/ subdirectory
  const dataDir = join(datapackDir, 'data')
  const { mcfunction, json } = collectFiles(dataDir)
  const baseDir = datapackDir
  const results: FixFileResult[] = []
  let totalPatches = 0
  const errors: string[] = []

  options.onProgress?.('Scanning files for porting plan...')
  const plan = generateFixPlan(sourceVer, targetVer, rewrites, removals, mcfunction, json, baseDir)

  // Create output directory
  if (!existsSync(outputDir)) {
    mkdirSync(outputDir, { recursive: true })
  }

  const totalFiles = mcfunction.length + json.length
  let processed = 0

  options.onProgress?.('Processing functions...')

  // Process mcfunction files
  for (const file of mcfunction) {
    processed++
    options.onProgress?.(`Rewriting ${relative(baseDir, file)}`, processed, totalFiles)
    const rel = relative(baseDir, file).replace(/\\/g, '/')
    const content = readFileSync(file, 'utf-8')
    const { result, patches, details } = fixMcfunctionFile(content, rel, rewrites, removals)
    if (patches > 0) {
      const outPath = join(outputDir, rel)
      const outDir = dirname(outPath)
      if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true })
      writeFileSync(outPath, result, 'utf-8')
      results.push({ file: rel, patches, details })
      totalPatches += patches
    } else {
      // Copy unchanged file
      const outPath = join(outputDir, rel)
      const outDir = dirname(outPath)
      if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true })
      writeFileSync(outPath, content, 'utf-8')
    }
  }

  options.onProgress?.('Processing JSON files...')

  // Process JSON files (structural + advancement icon + registry fixes)
  for (const file of json) {
    processed++
    options.onProgress?.(`Fixing ${relative(baseDir, file)}`, processed, totalFiles)
    const rel = relative(baseDir, file).replace(/\\/g, '/')
    let content: string
    try {
      content = readFileSync(file, 'utf-8')
    } catch { continue }
    let data: any
    try {
      data = JSON.parse(content)
    } catch {
      // Copy as-is
      const outPath = join(outputDir, rel)
      const outDir = dirname(outPath)
      if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true })
      writeFileSync(outPath, content, 'utf-8')
      continue
    }

    let currentData = data
    let patches = 0
    const details: string[] = []

    // Advancement icon fix (backport)
    if (!portingForward && cmpVer(targetName, '1.20.5') < 0) {
      const advResult = fixAdvancementIcon(currentData, targetName, rel)
      currentData = advResult.data
      patches += advResult.patches
      details.push(...advResult.details)
    }

    // Biome precipitation field rename: has_precipitation (1.19.4+) -> precipitation (pre-1.19.4)
    if (!portingForward && rel.includes('/worldgen/biome') && cmpVer(targetName, '1.19.4') < 0) {
      const fixResult = renameBiomeField(currentData, targetName, rel)
      currentData = fixResult.data
      patches += fixResult.patches
      details.push(...fixResult.details)
    }

    // Predicate any_of -> alternative rename (backport pre-1.20)
    if (!portingForward && rel.includes('/predicate') && cmpVer(targetName, '1.20') < 0) {
      const fixResult = renamePredicateFields(currentData, targetName, rel)
      currentData = fixResult.data
      patches += fixResult.patches
      details.push(...fixResult.details)
    }

    // Registry reference fixing
    if (!portingForward) {
      const registryRules = FEATURE_RULES.filter(r => r.type === 'registry')
      const svDv = sourceVer.data_version
      const tvDv = targetVer.data_version
      for (const rule of registryRules) {
        const ruleMinDv = versionNameToDataVersion(rule.minVersion, allVersions)
        if (ruleMinDv === null) continue
        if (svDv >= ruleMinDv && tvDv < ruleMinDv) {
          const searchStr = rule.match.endsWith('/') ? rule.match : `${rule.match}/`
          const contentStr = JSON.stringify(currentData)
          const re = new RegExp(`"(?:[\\w-]+:)?${searchStr.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'g')
          if (re.test(contentStr)) {
            const fixed = contentStr.replace(re, `"## FIXED(${rule.match} not available in ${targetName})/`)
            try { currentData = JSON.parse(fixed); patches++; details.push(`${rel}: Replaced ${rule.match} references`) } catch { }
          }
        }
      }
    }

    // Structural mcdoc fix: remove fields invalid for target version
    if (mcdocTable) {
      const structResult = fixMcdocFileData(currentData, rel, targetName, mcdocTable)
      if (structResult.removed.length > 0) {
        currentData = structResult.data
        patches += structResult.removed.length
        for (const r of structResult.removed) {
          details.push(`${rel}: ${r}`)
        }
      }
    }

    if (patches > 0) {
      const outPath = join(outputDir, rel)
      const outDir = dirname(outPath)
      if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true })
      writeFileSync(outPath, JSON.stringify(currentData, null, 2) + '\n', 'utf-8')
      results.push({ file: rel, patches, details })
      totalPatches += patches
    } else {
      // Copy unchanged
      const outPath = join(outputDir, rel)
      const outDir = dirname(outPath)
      if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true })
      writeFileSync(outPath, content, 'utf-8')
    }
  }

  options.onProgress?.('Updating pack.mcmeta...')

  // Update pack.mcmeta
  const targetPackFormat = options.targetPackFormat ?? targetVer.data_pack_version
  try {
    const { content: mcmetaContent, changed } = updatePackMcmeta(datapackDir, targetPackFormat)
    const outPath = join(outputDir, 'pack.mcmeta')
    const outDir = dirname(outPath)
    if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true })
    writeFileSync(outPath, mcmetaContent, 'utf-8')
    if (changed) {
      results.push({ file: 'pack.mcmeta', patches: 1, details: [`Updated pack_format to ${targetPackFormat}`] })
      totalPatches++
    }
  } catch (e: any) {
    errors.push(`pack.mcmeta: ${e.message}`)
  }

  // Copy other root files
  const copyDirRecursive = (src: string, dst: string) => {
    if (!existsSync(dst)) mkdirSync(dst, { recursive: true })
    for (const entry of readdirSync(src)) {
      const s = join(src, entry)
      const d = join(dst, entry)
      if (statSync(s).isDirectory()) copyDirRecursive(s, d)
      else writeFileSync(d, readFileSync(s))
    }
  }
  try {
    const rootEntries = readdirSync(datapackDir)
    for (const entry of rootEntries) {
      if (entry === 'pack.mcmeta' || entry === 'data') continue
      const src = join(datapackDir, entry)
      const dst = join(outputDir, entry)
      if (!existsSync(dst)) {
        try {
          if (statSync(src).isDirectory()) {
            copyDirRecursive(src, dst)
          } else {
            writeFileSync(dst, readFileSync(src))
          }
        } catch { }
      }
    }
  } catch { }

  options.onProgress?.('Done.')

  return {
    results,
    plan,
    summary: {
      filesFixed: results.length,
      totalPatches,
      errors,
    },
  }
}

// ---------------------------------------------------------------------------
// Resource pack fix entry point
// ---------------------------------------------------------------------------

export interface ResourcePackFixOptions {
  packDir: string
  outputDir: string
  targetVersion: string
  targetPackFormat?: number
  sourceVersion?: string
  onProgress?: (message: string, current?: number, total?: number) => void
}

export async function fixResourcePack(options: ResourcePackFixOptions): Promise<{
  results: FixFileResult[]
  plan: FixPlan
  summary: { filesFixed: number; totalPatches: number; errors: string[] }
}> {
  const { packDir, outputDir, targetVersion } = options
  const allVersions = await fetchVersions()
  const targetVer = allVersions.find(v => v.name === targetVersion || v.id === targetVersion)
  if (!targetVer) {
    const plan: FixPlan = {
      sourceVersion: '', targetVersion, direction: 'forward',
      rewrites: [], jsonFixes: [], manualAttention: [], cascadeEffects: [],
      summary: { totalFilesToPatch: 0, commandRewrites: 0, jsonFixes: 0, manualAttention: 0, mcdocRemovals: 0, packMcmetaUpdate: false },
    }
    return { results: [], plan, summary: { filesFixed: 0, totalPatches: 0, errors: [`Target version '${targetVersion}' not found`] } }
  }

  const targetName = targetVer.name

  // Load mcdoc symbols for structural fixing
  let mcdocTable: any = null
  try {
    mcdocTable = await getMcdocSymbols()
  } catch { }

  const baseDir = packDir
  const results: FixFileResult[] = []
  let totalPatches = 0
  const errors: string[] = []

  if (!existsSync(outputDir)) {
    mkdirSync(outputDir, { recursive: true })
  }

  // Collect JSON files under assets/
  const jsonFiles: string[] = []
  const assetsDir = join(packDir, 'assets')
  if (existsSync(assetsDir)) {
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir)) {
        const full = join(dir, entry)
        if (statSync(full).isDirectory()) walk(full)
        else if (entry.endsWith('.json') || entry.endsWith('.mcmeta')) jsonFiles.push(full)
      }
    }
    walk(assetsDir)
  }

  const totalFiles = jsonFiles.length
  const finishProgress = () => options.onProgress?.('Done.')

  options.onProgress?.('Processing resource pack files...')

  // Process JSON files with mcdoc structural fixes
  for (let fi = 0; fi < jsonFiles.length; fi++) {
    const file = jsonFiles[fi]
    options.onProgress?.(`Processing ${relative(baseDir, file)}`, fi + 1, totalFiles)
    const rel = relative(baseDir, file).replace(/\\/g, '/')
    let content: string
    try {
      content = readFileSync(file, 'utf-8')
    } catch { continue }
    let data: any
    try {
      data = JSON.parse(content)
    } catch {
      const outPath = join(outputDir, rel)
      const outDir = dirname(outPath)
      if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true })
      writeFileSync(outPath, content, 'utf-8')
      continue
    }

    const details: string[] = []
    let patches = 0
    let currentData = data

    // Structural mcdoc fix
    if (mcdocTable) {
      const structResult = fixMcdocFileData(currentData, rel, targetName, mcdocTable)
      if (structResult.removed.length > 0) {
        currentData = structResult.data
        patches += structResult.removed.length
        for (const r of structResult.removed) {
          details.push(`${rel}: ${r}`)
        }
      }
    }

    if (patches > 0) {
      const outPath = join(outputDir, rel)
      const outDir = dirname(outPath)
      if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true })
      writeFileSync(outPath, JSON.stringify(currentData, null, 2) + '\n', 'utf-8')
      results.push({ file: rel, patches, details })
      totalPatches += patches
    } else {
      const outPath = join(outputDir, rel)
      const outDir = dirname(outPath)
      if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true })
      writeFileSync(outPath, content, 'utf-8')
    }
  }

  // Copy non-JSON files under assets/ (PNG, etc.)
  const copyAssets = (dir: string, outBase: string) => {
    for (const entry of readdirSync(dir)) {
      const src = join(dir, entry)
      const dst = join(outBase, entry)
      if (statSync(src).isDirectory()) {
        if (!existsSync(dst)) mkdirSync(dst, { recursive: true })
        copyAssets(src, dst)
      } else if (!entry.endsWith('.json') && !entry.endsWith('.mcmeta')) {
        if (!existsSync(dirname(dst))) mkdirSync(dirname(dst), { recursive: true })
        writeFileSync(dst, readFileSync(src))
      }
    }
  }
  if (existsSync(assetsDir)) {
    const outAssets = join(outputDir, 'assets')
    if (!existsSync(outAssets)) mkdirSync(outAssets, { recursive: true })
    copyAssets(assetsDir, outAssets)
  }

  // Update pack.mcmeta with target resource_pack_version
  const targetPackFormat = options.targetPackFormat ?? targetVer.resource_pack_version
  try {
    const pmPath = join(packDir, 'pack.mcmeta')
    if (existsSync(pmPath)) {
      const raw = readFileSync(pmPath, 'utf-8')
      const parsed = JSON.parse(raw)
      const oldFormat = parsed.pack?.pack_format
      if (oldFormat !== targetPackFormat) {
        parsed.pack.pack_format = targetPackFormat
        if (parsed.pack.supported_formats) delete parsed.pack.supported_formats
        const outPath = join(outputDir, 'pack.mcmeta')
        const outDir = dirname(outPath)
        if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true })
        writeFileSync(outPath, JSON.stringify(parsed, null, 2) + '\n', 'utf-8')
        results.push({ file: 'pack.mcmeta', patches: 1, details: [`Updated pack_format to ${targetPackFormat}`] })
        totalPatches++
      } else {
        const outPath = join(outputDir, 'pack.mcmeta')
        const outDir = dirname(outPath)
        if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true })
        writeFileSync(outPath, raw, 'utf-8')
      }
    }
  } catch (e: any) {
    errors.push(`pack.mcmeta: ${e.message}`)
  }

  // Copy other root files (pack.png, etc.)
  try {
    for (const entry of readdirSync(packDir)) {
      if (entry === 'pack.mcmeta' || entry === 'assets') continue
      const src = join(packDir, entry)
      const dst = join(outputDir, entry)
      if (!existsSync(dst)) {
        if (statSync(src).isDirectory()) {
          const copyDir = (d: string, od: string) => {
            if (!existsSync(od)) mkdirSync(od, { recursive: true })
            for (const e of readdirSync(d)) {
              const s = join(d, e)
              const o = join(od, e)
              if (statSync(s).isDirectory()) copyDir(s, o)
              else writeFileSync(o, readFileSync(s))
            }
          }
          copyDir(src, dst)
        } else {
          writeFileSync(dst, readFileSync(src))
        }
      }
    }
  } catch { }

  const jsonFixesList: FixJsonFixEntry[] = []
  const mcdocRemovals = results.reduce((s, r) => s + r.details.filter(d => d.includes('mcdoc')).length, 0)
  if (results.length > 0) {
    jsonFixesList.push({ type: 'mcdoc_structural', count: results.filter(r => r.details.some(d => d.includes('mcdoc'))).length, files: results.map(r => r.file) })
  }
  const plan: FixPlan = {
    sourceVersion: '',
    targetVersion: targetName,
    direction: 'forward',
    rewrites: [],
    jsonFixes: jsonFixesList,
    manualAttention: [],
    cascadeEffects: [],
    summary: {
      totalFilesToPatch: results.length,
      commandRewrites: 0,
      jsonFixes: results.length,
      manualAttention: 0,
      mcdocRemovals,
      packMcmetaUpdate: true,
    },
  }

  finishProgress()

  return {
    results,
    plan,
    summary: {
      filesFixed: results.length,
      totalPatches,
      errors,
    },
  }
}
