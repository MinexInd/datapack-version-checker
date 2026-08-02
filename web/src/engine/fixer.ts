import { fetchVersions } from './api'
import { getMcdocSymbols, cmpVer, fixMcdocFileData, checkMcdocData } from './mcdoc-check'
import { FEATURE_RULES, type FeatureRule } from './knowledge'
import { CMD_REWRITES, type CmdRewrite } from './rules'
import { tokenizeCommand } from './tokenizer'
import { versionNameToDataVersion } from './version'
import { readPackMcmetaFromString } from './pack-mcmeta'
import type { McmetaVersion } from './types'
import type { PackFileMap } from './engine'

export interface FixOptions {
  files: PackFileMap
  targetVersion: string
  sourceVersion?: string
}

export interface FixFileResult {
  file: string
  patches: number
  details: string[]
}

export interface FixSummary {
  filesFixed: number
  totalPatches: number
  errors: string[]
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
// The rule data lives in the single source of truth (./rules); this module
// re-exports CMD_REWRITES + CmdRewrite so existing importers keep working.
// ---------------------------------------------------------------------------

export { CMD_REWRITES, type CmdRewrite }

function getApplicableFixes(
  sourceVer: McmetaVersion | null,
  targetVer: McmetaVersion | null,
  allVersions: McmetaVersion[],
): { rewrites: CmdRewrite[]; removals: FeatureRule[] } {
  const rewrites: CmdRewrite[] = []
  const removals: FeatureRule[] = []

  const svDv = sourceVer?.data_version ?? 0
  const tvDv = targetVer?.data_version ?? 0

  for (const rw of CMD_REWRITES) {
    const rwSourceSinceDv = rw.sourceSince
      ? versionNameToDataVersion(rw.sourceSince, allVersions)
      : null
    const rwTargetUntilDv = rw.targetUntil && rw.targetUntil !== '0'
      ? versionNameToDataVersion(rw.targetUntil, allVersions)
      : null
    const rwTargetSinceDv = rw.targetSince
      ? versionNameToDataVersion(rw.targetSince, allVersions)
      : null

    if (rwSourceSinceDv !== null && svDv < rwSourceSinceDv) continue
    if (rwTargetUntilDv !== null && tvDv > rwTargetUntilDv) continue
    if (rwTargetSinceDv !== null && tvDv < rwTargetSinceDv) continue

    rewrites.push(rw)
  }

  for (const rule of FEATURE_RULES) {
    if (rule.type !== 'command') continue
    const ruleMinDv = versionNameToDataVersion(rule.minVersion, allVersions)
    if (ruleMinDv === null) continue
    if (svDv >= ruleMinDv && tvDv < ruleMinDv) {
      if (!rewrites.some(r => r.matchRoot === rule.match)) {
        removals.push(rule)
      }
    }
  }

  return { rewrites, removals }
}

function tryApplyRewrite(cmdText: string, rw: CmdRewrite): string | null {
  const cmdLine = cmdText.startsWith('/') ? cmdText : '/' + cmdText
  const tokens = tokenizeCommand(cmdLine)
  if (tokens.length === 0) return null
  const root = tokens[0].value.replace(/^\//, '')
  if (root !== rw.matchRoot && rw.matchRoot !== '') return null

  const newLine = cmdLine.replace(rw.pattern, rw.replacement)
  if (newLine === cmdLine) return null
  return cmdText.startsWith('/') ? newLine : newLine.replace(/^\//, '')
}

function extractRunSubcommand(tokens: ReturnType<typeof tokenizeCommand>): { text: string; start: number; end: number } | null {
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
          if (rw.replacement.includes('## FIXED')) {
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

function fixAdvancementIcon(
  data: any,
  targetName: string,
  relPath: string,
): { data: any; patches: number; details: string[] } {
  const details: string[] = []
  let patches = 0

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
  allFileContents: Record<string, string>,
): FixPlan {
  const sourceName = sourceVer.name
  const targetName = targetVer.name
  const portingForward = targetVer.data_version >= sourceVer.data_version

  const rewriteMap = new Map<string, FixRewriteEntry>()
  const manualAttention: FixManualEntry[] = []
  const jsonFixes: FixJsonFixEntry[] = []
  const seenManual = new Set<string>()

  for (const file of mcfunctionFiles) {
    const cmdLines: string[] = []

    for (const rw of rewrites) {
      if (!rewriteMap.has(rw.id)) {
        rewriteMap.set(rw.id, { id: rw.id, description: rw.description, count: 0, files: [] })
      }
      const entry = rewriteMap.get(rw.id)!
      entry.count++
      if (!entry.files.includes(file)) entry.files.push(file)
    }

    for (const rule of removals) {
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
      if (entry && !entry.files.includes(file)) entry.files.push(file)
    }
  }

  const jfTypes = ['advancement_icon', 'biome_field_rename', 'predicate_field_rename', 'registry_comment', 'mcdoc_removal']
  for (const type of jfTypes) {
    jsonFixes.push({ type, count: 0, files: [] })
  }

  for (const file of jsonFiles) {
    if (!portingForward && (file.includes('/advancement') || file.includes('/advancements'))) {
      const jf = jsonFixes.find(f => f.type === 'advancement_icon')
      if (jf && !jf.files.includes(file)) jf.files.push(file)
    }
    if (file.includes('/worldgen/biome')) {
      const jf = jsonFixes.find(f => f.type === 'biome_field_rename')
      if (jf && !jf.files.includes(file)) jf.files.push(file)
    }
    if (file.includes('/predicate') || file.includes('/predicates')) {
      const jf = jsonFixes.find(f => f.type === 'predicate_field_rename')
      if (jf && !jf.files.includes(file)) jf.files.push(file)
    }
  }

  const rewritesList = Array.from(rewriteMap.values()).sort((a, b) => b.count - a.count)
  const rewritesCount = rewritesList.reduce((s, r) => s + r.count, 0)
  const jsonFixesTotal = jsonFixes.reduce((s, f) => s + f.files.length, 0)

  const filesAffected = new Set<string>()
  for (const r of rewritesList) r.files.forEach(f => filesAffected.add(f))
  for (const m of manualAttention) m.files.forEach(f => filesAffected.add(f))
  for (const j of jsonFixes) j.files.forEach(f => filesAffected.add(f))

  // Compute cascade effects
  const cascadeEffects: FixCascadeEntry[] = []
  const allFiles = [...mcfunctionFiles, ...jsonFiles]
  const refs = collectReferences(allFiles.map(f => ({ file: f, content: allFileContents[f] ?? '' })))

  for (const patchedFile of filesAffected) {
    const resourceId = fileToResourceId(patchedFile)
    if (!resourceId) continue

    const affected: string[] = []
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
  files: PackFileMap
  results: FixFileResult[]
  plan: FixPlan
  summary: FixSummary
}> {
  const { files, targetVersion, sourceVersion: explicitSource } = options
  const allVersions = await fetchVersions()
  const targetVer = allVersions.find(v => v.name === targetVersion || v.id === targetVersion)
  if (!targetVer) {
    const plan: FixPlan = {
      sourceVersion: '', targetVersion, direction: 'forward',
      rewrites: [], jsonFixes: [], manualAttention: [], cascadeEffects: [],
      summary: { totalFilesToPatch: 0, commandRewrites: 0, jsonFixes: 0, manualAttention: 0, mcdocRemovals: 0, packMcmetaUpdate: false },
    }
    return { files, results: [], plan, summary: { filesFixed: 0, totalPatches: 0, errors: [`Target version '${targetVersion}' not found`] } }
  }

  let sourceVer: McmetaVersion | null = null
  if (explicitSource) {
    sourceVer = allVersions.find(v => v.name === explicitSource || v.id === explicitSource) ?? null
  }
  if (!sourceVer) {
    try {
      const pmContent = files['pack.mcmeta']
      if (pmContent) {
        const { supported_formats, min_format, max_format } = readPackMcmetaFromString(pmContent)
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
      }
    } catch { }
  }
  if (!sourceVer) {
    const plan: FixPlan = {
      sourceVersion: '', targetVersion, direction: 'forward',
      rewrites: [], jsonFixes: [], manualAttention: [], cascadeEffects: [],
      summary: { totalFilesToPatch: 0, commandRewrites: 0, jsonFixes: 0, manualAttention: 0, mcdocRemovals: 0, packMcmetaUpdate: false },
    }
    return { files, results: [], plan, summary: { filesFixed: 0, totalPatches: 0, errors: ['Could not determine source version. Use --from-version <ver>'] } }
  }

  const targetName = targetVer.name

  let mcdocTable: any = null
  try {
    mcdocTable = await getMcdocSymbols()
  } catch { }

  const { rewrites, removals } = getApplicableFixes(sourceVer, targetVer, allVersions)
  const portingForward = targetVer.data_version >= sourceVer.data_version

  const mcfunction: string[] = []
  const json: string[] = []

  for (const path of Object.keys(files)) {
    if (path.startsWith('data/')) {
      if (path.endsWith('.mcfunction')) mcfunction.push(path)
      else if (path.endsWith('.json') && path !== 'pack.mcmeta') json.push(path)
    }
  }

  const results: FixFileResult[] = []
  let totalPatches = 0
  const errors: string[] = []
  const output: PackFileMap = {}

  // Generate porting plan
  const plan = generateFixPlan(sourceVer, targetVer, rewrites, removals, mcfunction, json, files)

  // Process mcfunction files
  for (const file of mcfunction) {
    const content = files[file]
    if (!content) continue
    const { result, patches, details } = fixMcfunctionFile(content, file, rewrites, removals)
    output[file] = result
    if (patches > 0) {
      results.push({ file, patches, details })
      totalPatches += patches
    }
  }

  // Process JSON files
  for (const file of json) {
    const content = files[file]
    if (!content) continue
    let data: any
    try {
      data = JSON.parse(content)
    } catch {
      output[file] = content
      continue
    }

    let currentData = data
    let patches = 0
    const details: string[] = []

    // Advancement icon fix (backport)
    if (!portingForward && cmpVer(targetName, '1.20.5') < 0) {
      const advResult = fixAdvancementIcon(currentData, targetName, file)
      currentData = advResult.data
      patches += advResult.patches
      details.push(...advResult.details)
    }

    // Biome precipitation field rename: has_precipitation (1.19.4+) -> precipitation (pre-1.19.4)
    if (!portingForward && file.includes('/worldgen/biome') && cmpVer(targetName, '1.19.4') < 0) {
      const fixResult = renameBiomeField(currentData, targetName, file)
      currentData = fixResult.data
      patches += fixResult.patches
      details.push(...fixResult.details)
    }

    // Predicate any_of -> alternative rename (backport pre-1.20)
    if (!portingForward && file.includes('/predicate') && cmpVer(targetName, '1.20') < 0) {
      const fixResult = renamePredicateFields(currentData, targetName, file)
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
            try { currentData = JSON.parse(fixed); patches++; details.push(`${file}: Replaced ${rule.match} references`) } catch { }
          }
        }
      }
    }

    // Structural mcdoc fix
    if (mcdocTable) {
      const structResult = fixMcdocFileData(currentData, file, targetName, mcdocTable)
      if (structResult.removed.length > 0) {
        currentData = structResult.data
        patches += structResult.removed.length
        for (const r of structResult.removed) {
          details.push(`${file}: ${r}`)
        }
      }
    }

    if (patches > 0) {
      output[file] = JSON.stringify(currentData, null, 2) + '\n'
      results.push({ file, patches, details })
      totalPatches += patches
    } else {
      output[file] = content
    }
  }

  // Update pack.mcmeta
  const targetPackFormat = targetVer.data_pack_version
  try {
    const pmContent = files['pack.mcmeta']
    if (pmContent) {
      const parsed = JSON.parse(pmContent)
      const oldFormat = parsed.pack?.pack_format
      const isNewStyle = parsed.pack?.min_format !== undefined || parsed.pack?.max_format !== undefined
      if (isNewStyle) {
        // 25w31a+ tuple format: keep pack_format absent, rewrite the range tuples.
        parsed.pack.min_format = [targetPackFormat, 0]
        if (parsed.pack.max_format !== undefined) parsed.pack.max_format = [targetPackFormat, 0]
        output['pack.mcmeta'] = JSON.stringify(parsed, null, 2) + '\n'
        results.push({ file: 'pack.mcmeta', patches: 1, details: [`Updated format to ${targetPackFormat}`] })
        totalPatches++
      } else if (oldFormat !== targetPackFormat) {
        parsed.pack.pack_format = targetPackFormat
        if (parsed.pack.supported_formats) delete parsed.pack.supported_formats
        output['pack.mcmeta'] = JSON.stringify(parsed, null, 2) + '\n'
        results.push({ file: 'pack.mcmeta', patches: 1, details: [`Updated pack_format to ${targetPackFormat}`] })
        totalPatches++
      } else {
        output['pack.mcmeta'] = pmContent
      }
    }
  } catch (e: any) {
    errors.push(`pack.mcmeta: ${e.message}`)
  }

  // Copy remaining root files
  for (const path of Object.keys(files)) {
    if (path === 'pack.mcmeta' || path.startsWith('data/')) continue
    if (!(path in output)) {
      output[path] = files[path]
    }
  }

  return {
    files: output,
    results,
    plan,
    summary: { filesFixed: results.length, totalPatches, errors },
  }
}

export async function fixResourcePack(options: FixOptions): Promise<{
  files: PackFileMap
  results: FixFileResult[]
  plan: FixPlan
  summary: FixSummary
}> {
  const { files, targetVersion } = options
  const allVersions = await fetchVersions()
  const targetVer = allVersions.find(v => v.name === targetVersion || v.id === targetVersion)
  if (!targetVer) {
    const plan: FixPlan = {
      sourceVersion: '', targetVersion, direction: 'forward',
      rewrites: [], jsonFixes: [], manualAttention: [], cascadeEffects: [],
      summary: { totalFilesToPatch: 0, commandRewrites: 0, jsonFixes: 0, manualAttention: 0, mcdocRemovals: 0, packMcmetaUpdate: false },
    }
    return { files, results: [], plan, summary: { filesFixed: 0, totalPatches: 0, errors: [`Target version '${targetVersion}' not found`] } }
  }

  const targetName = targetVer.name

  let mcdocTable: any = null
  try {
    mcdocTable = await getMcdocSymbols()
  } catch { }

  const results: FixFileResult[] = []
  let totalPatches = 0
  const errors: string[] = []
  const output: PackFileMap = {}

  const jsonFiles = Object.keys(files).filter(k =>
    (k.startsWith('assets/')) &&
    (k.endsWith('.json') || k.endsWith('.mcmeta'))
  )

  for (const file of jsonFiles) {
    const content = files[file]
    if (!content) continue
    let data: any
    try {
      data = JSON.parse(content)
    } catch {
      output[file] = content
      continue
    }

    const details: string[] = []
    let patches = 0
    let currentData = data

    if (mcdocTable) {
      const structResult = fixMcdocFileData(currentData, file, targetName, mcdocTable)
      if (structResult.removed.length > 0) {
        currentData = structResult.data
        patches += structResult.removed.length
        for (const r of structResult.removed) {
          details.push(`${file}: ${r}`)
        }
      }
    }

    if (patches > 0) {
      output[file] = JSON.stringify(currentData, null, 2) + '\n'
      results.push({ file, patches, details })
      totalPatches += patches
    } else {
      output[file] = content
    }
  }

  // Copy non-JSON files
  for (const path of Object.keys(files)) {
    if (!(path in output)) {
      output[path] = files[path]
    }
  }

  // Update pack.mcmeta
  const targetPackFormat = targetVer.resource_pack_version
  try {
    const pmContent = files['pack.mcmeta']
    if (pmContent) {
      const parsed = JSON.parse(pmContent)
      const oldFormat = parsed.pack?.pack_format
      const isNewStyle = parsed.pack?.min_format !== undefined || parsed.pack?.max_format !== undefined
      if (isNewStyle) {
        // 25w31a+ tuple format: keep pack_format absent, rewrite the range tuples.
        parsed.pack.min_format = [targetPackFormat, 0]
        if (parsed.pack.max_format !== undefined) parsed.pack.max_format = [targetPackFormat, 0]
        output['pack.mcmeta'] = JSON.stringify(parsed, null, 2) + '\n'
        results.push({ file: 'pack.mcmeta', patches: 1, details: [`Updated format to ${targetPackFormat}`] })
        totalPatches++
      } else if (oldFormat !== targetPackFormat) {
        parsed.pack.pack_format = targetPackFormat
        if (parsed.pack.supported_formats) delete parsed.pack.supported_formats
        output['pack.mcmeta'] = JSON.stringify(parsed, null, 2) + '\n'
        results.push({ file: 'pack.mcmeta', patches: 1, details: [`Updated pack_format to ${targetPackFormat}`] })
        totalPatches++
      } else {
        output['pack.mcmeta'] = pmContent
      }
    }
  } catch (e: any) {
    errors.push(`pack.mcmeta: ${e.message}`)
  }

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

  return {
    files: output,
    results,
    plan,
    summary: { filesFixed: results.length, totalPatches, errors },
  }
}
