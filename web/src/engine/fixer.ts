import { fetchVersions } from './api'
import { getMcdocSymbols, cmpVer, fixMcdocFileData, checkMcdocData } from './mcdoc-check'
import { FEATURE_RULES, type FeatureRule } from './knowledge'
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

interface CmdRewrite {
  id: string
  matchRoot: string
  pattern: RegExp
  replacement: string
  description: string
  sourceSince?: string
  targetUntil?: string
}

const CMD_REWRITES: CmdRewrite[] = [
  {
    id: 'item_to_replaceitem',
    matchRoot: 'item',
    pattern: /^\/item\s+replace\s+(entity|block)\s+(\S+)\s+(\S+)\s+with\s+(\S+)\s*(.*)$/,
    replacement: '/replaceitem $1 $2 $3 $4 $5',
    description: '/item replace -> /replaceitem',
    sourceSince: '1.20.5',
    targetUntil: '1.20.4',
  },
  {
    id: 'item_modify_to_replaceitem',
    matchRoot: 'item',
    pattern: /^\/item\s+modify\s+(entity|block)\s+(\S+)\s+(\S+)\s+(.*)$/,
    replacement: '## FIXED(/item modify -> not available in pre-1.20.5): $0',
    description: '/item modify commented out (no pre-1.20.5 equivalent)',
    sourceSince: '1.20.5',
    targetUntil: '1.20.4',
  },
  {
    id: 'replaceitem_to_item',
    matchRoot: 'replaceitem',
    pattern: /^\/replaceitem\s+(entity|block)\s+(\S+)\s+(\S+)\s+(\S+)\s*(.*)$/,
    replacement: '/item replace $1 $2 $3 with $4 $5',
    description: '/replaceitem -> /item replace (1.20.5+ syntax)',
    sourceSince: '1.13',
    targetUntil: '0',
  },
  {
    id: 'placefeature_to_place',
    matchRoot: 'placefeature',
    pattern: /^\/placefeature\s+(.*)$/,
    replacement: '/place feature $1',
    description: '/placefeature -> /place feature',
    sourceSince: '1.18',
    targetUntil: '0',
  },
  {
    id: 'place_to_placefeature',
    matchRoot: 'place',
    pattern: /^\/place\s+feature\s+(.*)$/,
    replacement: '/placefeature $1',
    description: '/place feature -> /placefeature',
    sourceSince: '1.19',
    targetUntil: '1.18.2',
  },
  {
    id: 'execute_items_to_data',
    matchRoot: 'execute',
    pattern: /^(\/execute\s+(?:if|unless)\s+)items\s+(entity|block)\s+(\S+)\s+(\S+)\s+(.*)$/,
    replacement: '$1data $2 $3 $4',
    description: '/execute items -> /execute data (pre-1.20.5)',
    sourceSince: '1.20.5',
    targetUntil: '1.20.4',
  },
  {
    id: 'damage_comment',
    matchRoot: 'damage',
    pattern: /^\/damage\s/,
    replacement: '## FIXED(/damage not available pre-1.19.4): $0',
    description: '/damage commented out (use /effect instant_damage pre-1.19.4)',
    sourceSince: '1.19.4',
    targetUntil: '1.19.3',
  },
  {
    id: 'ride_comment',
    matchRoot: 'ride',
    pattern: /^\/ride\s/,
    replacement: '## FIXED(/ride not available pre-1.19.4): $0',
    description: '/ride commented out (use /tp + /data merge pre-1.19.4)',
    sourceSince: '1.19.4',
    targetUntil: '1.19.3',
  },
  {
    id: 'return_run_strip',
    matchRoot: 'return',
    pattern: /^\/return\s+run\s+(.*)$/,
    replacement: '$1 ## FIXED(return run stripped, pre-1.20.4)',
    description: '/return run -> inner command only (pre-1.20.4)',
    sourceSince: '1.20.4',
    targetUntil: '1.20.3',
  },
  {
    id: 'return_comment',
    matchRoot: 'return',
    pattern: /^\/return\s/,
    replacement: '## FIXED(/return not available pre-1.20): $0',
    description: '/return commented out (pre-1.20)',
    sourceSince: '1.20',
    targetUntil: '1.19.4',
  },
  {
    id: 'schedule_comment',
    matchRoot: 'schedule',
    pattern: /^\/schedule\s/,
    replacement: '## FIXED(/schedule not available pre-1.14): $0',
    description: '/schedule commented out (use ticking function pre-1.14)',
    sourceSince: '1.14',
    targetUntil: '1.13.2',
  },
  {
    id: 'attribute_comment',
    matchRoot: 'attribute',
    pattern: /^\/attribute\s/,
    replacement: '## FIXED(/attribute not available pre-1.16): $0',
    description: '/attribute commented out (use /data merge pre-1.16)',
    sourceSince: '1.16',
    targetUntil: '1.15.2',
  },
  {
    id: 'random_comment',
    matchRoot: 'random',
    pattern: /^\/random\s/,
    replacement: '## FIXED(/random not available pre-1.20.2): $0',
    description: '/random commented out (use /scoreboard random pre-1.20.2)',
    sourceSince: '1.20.2',
    targetUntil: '1.20.1',
  },
  {
    id: 'fillbiome_comment',
    matchRoot: 'fillbiome',
    pattern: /^\/fillbiome\s/,
    replacement: '## FIXED(/fillbiome not available pre-1.19.3): $0',
    description: '/fillbiome commented out',
    sourceSince: '1.19.3',
    targetUntil: '1.19.2',
  },
  {
    id: 'tick_comment',
    matchRoot: 'tick',
    pattern: /^\/tick\s/,
    replacement: '## FIXED(/tick not available pre-1.20.3): $0',
    description: '/tick commented out (admin command)',
    sourceSince: '1.20.3',
    targetUntil: '1.20.2',
  },
  {
    id: 'transfer_comment',
    matchRoot: 'transfer',
    pattern: /^\/transfer\s/,
    replacement: '## FIXED(/transfer not available pre-1.20.5): $0',
    description: '/transfer commented out',
    sourceSince: '1.20.5',
    targetUntil: '1.20.4',
  },
  {
    id: 'dialog_comment',
    matchRoot: 'dialog',
    pattern: /^\/dialog\s/,
    replacement: '## FIXED(/dialog not available pre-1.21.6): $0',
    description: '/dialog commented out',
    sourceSince: '1.21.6',
    targetUntil: '1.21.5',
  },
  {
    id: 'waypoint_comment',
    matchRoot: 'waypoint',
    pattern: /^\/waypoint\s/,
    replacement: '## FIXED(/waypoint not available pre-1.21.6): $0',
    description: '/waypoint commented out',
    sourceSince: '1.21.6',
    targetUntil: '1.21.5',
  },
  {
    id: 'version_cmd_comment',
    matchRoot: 'version',
    pattern: /^\/version\s/,
    replacement: '## FIXED(/version not available pre-1.21.6): $0',
    description: '/version command commented out',
    sourceSince: '1.21.6',
    targetUntil: '1.21.5',
  },
  {
    id: 'rotate_comment',
    matchRoot: 'rotate',
    pattern: /^\/rotate\s/,
    replacement: '## FIXED(/rotate not available pre-1.21.2): $0',
    description: '/rotate commented out (use /data merge pre-1.21.2)',
    sourceSince: '1.21.2',
    targetUntil: '1.21.1',
  },
  {
    id: 'test_comment',
    matchRoot: 'test',
    pattern: /^\/test\s/,
    replacement: '## FIXED(/test not available pre-1.21.4): $0',
    description: '/test commented out (game test framework)',
    sourceSince: '1.21.4',
    targetUntil: '1.21.3',
  },
  {
    id: 'fetchprofile_comment',
    matchRoot: 'fetchprofile',
    pattern: /^\/fetchprofile\s/,
    replacement: '## FIXED(/fetchprofile not available pre-1.21.9): $0',
    description: '/fetchprofile commented out',
    sourceSince: '1.21.9',
    targetUntil: '1.21.8',
  },
  {
    id: 'swing_comment',
    matchRoot: 'swing',
    pattern: /^\/swing\s/,
    replacement: '## FIXED(/swing not available pre-26.1): $0',
    description: '/swing commented out',
    sourceSince: '26.1',
    targetUntil: '26.0',
  },
  {
    id: 'unpublish_comment',
    matchRoot: 'unpublish',
    pattern: /^\/unpublish\s/,
    replacement: '## FIXED(/unpublish not available pre-26.2): $0',
    description: '/unpublish commented out',
    sourceSince: '26.2',
    targetUntil: '26.1',
  },
  {
    id: 'posteffect_comment',
    matchRoot: 'posteffect',
    pattern: /^\/posteffect\s/,
    replacement: '## FIXED(/posteffect not available pre-26.3): $0',
    description: '/posteffect commented out',
    sourceSince: '26.3',
    targetUntil: '26.2',
  },
  {
    id: 'bossbar_players_comment',
    matchRoot: 'bossbar',
    pattern: /^\/bossbar\s+set\s+\S+\s+players\s/,
    replacement: '## FIXED(/bossbar set players not available pre-1.20.5): $0',
    description: '/bossbar set players commented out',
    sourceSince: '1.20.5',
    targetUntil: '1.20.4',
  },
  {
    id: 'components_to_nbt',
    matchRoot: 'give',
    pattern: /^(\/give\s+\S+)\s+([\w:.-]+)\[(.*?)\]\s*(.*)$/,
    replacement: '$1 $2$4 ## FIXED: removed [components] syntax (not available pre-1.20.5)',
    description: 'Item component [syntax] stripped (use NBT tag pre-1.20.5)',
    sourceSince: '1.20.5',
    targetUntil: '1.20.4',
  },
  {
    id: 'components_to_nbt_clear',
    matchRoot: 'clear',
    pattern: /^(\/clear\s+\S+)\s+([\w:.-]+)\[(.*?)\]\s*(.*)$/,
    replacement: '$1 $2$4 ## FIXED: removed [components] syntax (not available pre-1.20.5)',
    description: 'Item component [syntax] stripped (use NBT tag pre-1.20.5)',
    sourceSince: '1.20.5',
    targetUntil: '1.20.4',
  },
  {
    id: 'macro_comment',
    matchRoot: '',
    pattern: /\$\w*\([^)]*\)/,
    replacement: '## FIXED: $(macro) syntax not available pre-1.20.4 — original: $0',
    description: 'Macro $() syntax commented out (pre-1.20.4)',
    sourceSince: '1.20.4',
    targetUntil: '1.20.3',
  },
]

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

    if (rwSourceSinceDv !== null && svDv < rwSourceSinceDv) continue
    if (rwTargetUntilDv !== null && tvDv > rwTargetUntilDv) continue

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
  const tokenized = tokenizeCommand(trimmed.startsWith('/') ? trimmed : '/' + trimmed)

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
        const beforeRun = trimmed.slice(0, subCmd.start)
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

export async function fixDatapack(options: FixOptions): Promise<{
  files: PackFileMap
  results: FixFileResult[]
  summary: FixSummary
}> {
  const { files, targetVersion, sourceVersion: explicitSource } = options
  const allVersions = await fetchVersions()
  const targetVer = allVersions.find(v => v.name === targetVersion || v.id === targetVersion)
  if (!targetVer) {
    return { files, results: [], summary: { filesFixed: 0, totalPatches: 0, errors: [`Target version '${targetVersion}' not found`] } }
  }

  let sourceVer: McmetaVersion | null = null
  if (explicitSource) {
    sourceVer = allVersions.find(v => v.name === explicitSource || v.id === explicitSource) ?? null
  }
  if (!sourceVer) {
    try {
      const pmContent = files['pack.mcmeta']
      if (pmContent) {
        const { supported_formats } = readPackMcmetaFromString(pmContent)
        if (supported_formats) {
          sourceVer = allVersions.find(v => v.data_pack_version === supported_formats.max) ?? null
        }
      }
    } catch { }
  }
  if (!sourceVer) {
    return { files, results: [], summary: { filesFixed: 0, totalPatches: 0, errors: ['Could not determine source version. Use --from-version <ver>'] } }
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

    // Registry reference fixing
    if (!portingForward) {
      const registryRules = FEATURE_RULES.filter(r => r.type === 'registry')
      const svDv = sourceVer.data_version
      const tvDv = targetVer.data_version
      for (const rule of registryRules) {
        const ruleMinDv = versionNameToDataVersion(rule.minVersion, allVersions)
        if (ruleMinDv === null) continue
        if (svDv >= ruleMinDv && tvDv < ruleMinDv) {
          const searchStr = `${rule.match}/`
          const contentStr = JSON.stringify(currentData)
          if (contentStr.includes(searchStr)) {
            const fixed = contentStr.replace(new RegExp(`"${searchStr}`, 'g'), `"## FIXED(${rule.match} not available in ${targetName})/`)
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
      if (oldFormat !== targetPackFormat) {
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
    summary: { filesFixed: results.length, totalPatches, errors },
  }
}

export async function fixResourcePack(options: FixOptions): Promise<{
  files: PackFileMap
  results: FixFileResult[]
  summary: FixSummary
}> {
  const { files, targetVersion } = options
  const allVersions = await fetchVersions()
  const targetVer = allVersions.find(v => v.name === targetVersion || v.id === targetVersion)
  if (!targetVer) {
    return { files, results: [], summary: { filesFixed: 0, totalPatches: 0, errors: [`Target version '${targetVersion}' not found`] } }
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
      if (oldFormat !== targetPackFormat) {
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

  return {
    files: output,
    results,
    summary: { filesFixed: results.length, totalPatches, errors },
  }
}
