import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, statSync } from 'node:fs'
import { join, relative, dirname } from 'node:path'
import { readPackMcmeta } from './pack-mcmeta.js'
import { fetchVersions } from './api.js'
import { getMcdocSymbols, checkMcdocFile, cmpVer } from './mcdoc-check.js'
import { FEATURE_RULES, type FeatureRule } from './knowledge.js'
import { tokenizeCommand } from './tokenizer.js'
import { versionNameToDataVersion } from './version.js'
import type { McmetaVersion } from './types.js'

export interface FixOptions {
  datapackDir: string
  outputDir: string
  targetVersion: string
  targetPackFormat?: number
  sourceVersion?: string
}

export interface FixFileResult {
  file: string
  patches: number
  details: string[]
}

// ---------------------------------------------------------------------------
// Command rewrite patterns
// Each strategy applies when porting FROM sourceVer TO targetVer
// ---------------------------------------------------------------------------

interface CmdRewrite {
  id: string
  /** Match command root (e.g. 'item', 'place') */
  matchRoot: string
  /** Pattern to match the full command line */
  pattern: RegExp
  /** Replacement template (use $1, $2 etc from pattern groups) */
  replacement: string
  /** Human description of what this fix does */
  description: string
  /** Minimum source version for this pattern to apply (e.g. '1.20.5' means "only rewrite if source >= 1.20.5") */
  sourceSince?: string
  /** Maximum target version (e.g. '1.20.4' means "only rewrite if target <= 1.20.4") */
  targetUntil?: string
}

const CMD_REWRITES: CmdRewrite[] = [
  // ---- /item -> /replaceitem (backport pre-1.20.5) ----
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

  // ---- /replaceitem -> /item (forward port to 1.20.5+) ----
  {
    id: 'replaceitem_to_item',
    matchRoot: 'replaceitem',
    pattern: /^\/replaceitem\s+(entity|block)\s+(\S+)\s+(\S+)\s+(\S+)\s*(.*)$/,
    replacement: '/item replace $1 $2 $3 with $4 $5',
    description: '/replaceitem -> /item replace (1.20.5+ syntax)',
    sourceSince: '1.13',
    targetUntil: '0',
  },

  // ---- /placefeature -> /place (forward port to 1.19+) ----
  {
    id: 'placefeature_to_place',
    matchRoot: 'placefeature',
    pattern: /^\/placefeature\s+(.*)$/,
    replacement: '/place feature $1',
    description: '/placefeature -> /place feature',
    sourceSince: '1.18',
    targetUntil: '0',
  },

  // ---- /place -> /placefeature (backport pre-1.19) ----
  {
    id: 'place_to_placefeature',
    matchRoot: 'place',
    pattern: /^\/place\s+feature\s+(.*)$/,
    replacement: '/placefeature $1',
    description: '/place feature -> /placefeature',
    sourceSince: '1.19',
    targetUntil: '1.18.2',
  },

  // ---- /execute if|unless items -> /execute if|unless data (backport pre-1.20.5) ----
  {
    id: 'execute_items_to_data',
    matchRoot: 'execute',
    pattern: /^(\/execute\s+(?:if|unless)\s+)items\s+(entity|block)\s+(\S+)\s+(\S+)\s+(.*)$/,
    replacement: '$1data $2 $3 $4',
    description: '/execute items -> /execute data (pre-1.20.5)',
    sourceSince: '1.20.5',
    targetUntil: '1.20.4',
  },

  // ---- /damage -> comment (backport pre-1.19.4) ----
  {
    id: 'damage_comment',
    matchRoot: 'damage',
    pattern: /^\/damage\s/,
    replacement: '## FIXED(/damage not available pre-1.19.4): $0',
    description: '/damage commented out (use /effect instant_damage pre-1.19.4)',
    sourceSince: '1.19.4',
    targetUntil: '1.19.3',
  },

  // ---- /ride -> comment (backport pre-1.19.4) ----
  {
    id: 'ride_comment',
    matchRoot: 'ride',
    pattern: /^\/ride\s/,
    replacement: '## FIXED(/ride not available pre-1.19.4): $0',
    description: '/ride commented out (use /tp + /data merge pre-1.19.4)',
    sourceSince: '1.19.4',
    targetUntil: '1.19.3',
  },

  // ---- /return run -> just the inner command (backport pre-1.20.4) ----
  {
    id: 'return_run_strip',
    matchRoot: 'return',
    pattern: /^\/return\s+run\s+(.*)$/,
    replacement: '$1 ## FIXED(return run stripped, pre-1.20.4)',
    description: '/return run -> inner command only (pre-1.20.4)',
    sourceSince: '1.20.4',
    targetUntil: '1.20.3',
  },

  // ---- /return -> comment (backport pre-1.20) ----
  {
    id: 'return_comment',
    matchRoot: 'return',
    pattern: /^\/return\s/,
    replacement: '## FIXED(/return not available pre-1.20): $0',
    description: '/return commented out (pre-1.20)',
    sourceSince: '1.20',
    targetUntil: '1.19.4',
  },

  // ---- /schedule -> comment (backport pre-1.14) ----
  {
    id: 'schedule_comment',
    matchRoot: 'schedule',
    pattern: /^\/schedule\s/,
    replacement: '## FIXED(/schedule not available pre-1.14): $0',
    description: '/schedule commented out (use ticking function pre-1.14)',
    sourceSince: '1.14',
    targetUntil: '1.13.2',
  },

  // ---- /attribute -> comment (backport pre-1.16) ----
  {
    id: 'attribute_comment',
    matchRoot: 'attribute',
    pattern: /^\/attribute\s/,
    replacement: '## FIXED(/attribute not available pre-1.16): $0',
    description: '/attribute commented out (use /data merge pre-1.16)',
    sourceSince: '1.16',
    targetUntil: '1.15.2',
  },

  // ---- /random -> comment (backport pre-1.20.2) ----
  {
    id: 'random_comment',
    matchRoot: 'random',
    pattern: /^\/random\s/,
    replacement: '## FIXED(/random not available pre-1.20.2): $0',
    description: '/random commented out (use /scoreboard random pre-1.20.2)',
    sourceSince: '1.20.2',
    targetUntil: '1.20.1',
  },

  // ---- /fillbiome -> comment (backport pre-1.19.3) ----
  {
    id: 'fillbiome_comment',
    matchRoot: 'fillbiome',
    pattern: /^\/fillbiome\s/,
    replacement: '## FIXED(/fillbiome not available pre-1.19.3): $0',
    description: '/fillbiome commented out',
    sourceSince: '1.19.3',
    targetUntil: '1.19.2',
  },

  // ---- /tick -> comment (backport pre-1.20.3) ----
  {
    id: 'tick_comment',
    matchRoot: 'tick',
    pattern: /^\/tick\s/,
    replacement: '## FIXED(/tick not available pre-1.20.3): $0',
    description: '/tick commented out (admin command)',
    sourceSince: '1.20.3',
    targetUntil: '1.20.2',
  },

  // ---- /transfer -> comment ----
  {
    id: 'transfer_comment',
    matchRoot: 'transfer',
    pattern: /^\/transfer\s/,
    replacement: '## FIXED(/transfer not available pre-1.20.5): $0',
    description: '/transfer commented out',
    sourceSince: '1.20.5',
    targetUntil: '1.20.4',
  },

  // ---- /dialog -> comment ----
  {
    id: 'dialog_comment',
    matchRoot: 'dialog',
    pattern: /^\/dialog\s/,
    replacement: '## FIXED(/dialog not available pre-1.21.6): $0',
    description: '/dialog commented out',
    sourceSince: '1.21.6',
    targetUntil: '1.21.5',
  },

  // ---- /waypoint -> comment ----
  {
    id: 'waypoint_comment',
    matchRoot: 'waypoint',
    pattern: /^\/waypoint\s/,
    replacement: '## FIXED(/waypoint not available pre-1.21.6): $0',
    description: '/waypoint commented out',
    sourceSince: '1.21.6',
    targetUntil: '1.21.5',
  },

  // ---- /version -> comment ----
  {
    id: 'version_cmd_comment',
    matchRoot: 'version',
    pattern: /^\/version\s/,
    replacement: '## FIXED(/version not available pre-1.21.6): $0',
    description: '/version command commented out',
    sourceSince: '1.21.6',
    targetUntil: '1.21.5',
  },

  // ---- /rotate -> comment ----
  {
    id: 'rotate_comment',
    matchRoot: 'rotate',
    pattern: /^\/rotate\s/,
    replacement: '## FIXED(/rotate not available pre-1.21.2): $0',
    description: '/rotate commented out (use /data merge pre-1.21.2)',
    sourceSince: '1.21.2',
    targetUntil: '1.21.1',
  },

  // ---- /test -> comment ----
  {
    id: 'test_comment',
    matchRoot: 'test',
    pattern: /^\/test\s/,
    replacement: '## FIXED(/test not available pre-1.21.4): $0',
    description: '/test commented out (game test framework)',
    sourceSince: '1.21.4',
    targetUntil: '1.21.3',
  },

  // ---- /fetchprofile -> comment ----
  {
    id: 'fetchprofile_comment',
    matchRoot: 'fetchprofile',
    pattern: /^\/fetchprofile\s/,
    replacement: '## FIXED(/fetchprofile not available pre-1.21.9): $0',
    description: '/fetchprofile commented out',
    sourceSince: '1.21.9',
    targetUntil: '1.21.8',
  },

  // ---- /swing -> comment ----
  {
    id: 'swing_comment',
    matchRoot: 'swing',
    pattern: /^\/swing\s/,
    replacement: '## FIXED(/swing not available pre-26.1): $0',
    description: '/swing commented out',
    sourceSince: '26.1',
    targetUntil: '26.0',
  },

  // ---- /unpublish -> comment ----
  {
    id: 'unpublish_comment',
    matchRoot: 'unpublish',
    pattern: /^\/unpublish\s/,
    replacement: '## FIXED(/unpublish not available pre-26.2): $0',
    description: '/unpublish commented out',
    sourceSince: '26.2',
    targetUntil: '26.1',
  },

  // ---- /posteffect -> comment ----
  {
    id: 'posteffect_comment',
    matchRoot: 'posteffect',
    pattern: /^\/posteffect\s/,
    replacement: '## FIXED(/posteffect not available pre-26.3): $0',
    description: '/posteffect commented out',
    sourceSince: '26.3',
    targetUntil: '26.2',
  },

  // ---- /bossbar set players -> comment (backport pre-1.20.5) ----
  {
    id: 'bossbar_players_comment',
    matchRoot: 'bossbar',
    pattern: /^\/bossbar\s+set\s+\S+\s+players\s/,
    replacement: '## FIXED(/bossbar set players not available pre-1.20.5): $0',
    description: '/bossbar set players commented out',
    sourceSince: '1.20.5',
    targetUntil: '1.20.4',
  },

  // ---- Item components [syntax] -> NBT tag:{...} (backport pre-1.20.5) ----
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

  // ---- $() macro -> comment (backport pre-1.20.4) ----
  {
    id: 'macro_comment',
    matchRoot: '',
    pattern: /\$\w*\([^)]*\)/,
    replacement: '## FIXED: $(macro) syntax not available pre-1.20.4 — original: $0',
    description: 'Macro $() syntax commented out (pre-1.20.4)',
    sourceSince: '1.20.4',
    targetUntil: '1.20.3',
  },

  // ---- /execute if|unless -> /testfor (backport pre-1.14) ----
  // Complex: would need to parse the condition and rewrite to /testfor + /scoreboard
  // Skipping for now — user gets a comment note instead.
]

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

    // Source must be >= sourceSince (the feature exists in source)
    if (rwSourceSinceDv !== null && svDv < rwSourceSinceDv) continue
    // Target must be <= targetUntil (the feature doesn't exist in target)
    if (rwTargetUntilDv !== null && tvDv > rwTargetUntilDv) continue

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

      const tokens = tokenizeCommand(cmdLine)
      if (tokens.length === 0) continue
      const root = tokens[0].value.replace(/^\//, '')

      if (root !== rw.matchRoot && rw.matchRoot !== '') continue

      const newLine = cmdLine.replace(rw.pattern, rw.replacement)
      if (newLine !== cmdLine) {
        const indent = line.match(/^\s*/)?.[0] ?? ''
        if (rw.replacement.includes('## FIXED')) {
          fixed = `${indent}## FIXED(${rw.description}): ${trimmed}`
        } else {
          const resultCmd = trimmed.startsWith('/') ? newLine : newLine.replace(/^\//, '')
          fixed = indent + resultCmd
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

    resultLines.push(fixed)
  }

  return { result: resultLines.join('\n'), patches, details }
}

// ---------------------------------------------------------------------------
// JSON file fixing (structural issues from mcdoc)
// ---------------------------------------------------------------------------

function fixJsonStructure(
  data: unknown,
  version: string,
  mcdocTable: any,
  relPath: string,
): { data: unknown; issues: { removed: string[] } } {
  const removed: string[] = []
  return { data, issues: { removed } }
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

  const oldFormat = parsed.pack.pack_format
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
// Main fix entry point
// ---------------------------------------------------------------------------

export async function fixDatapack(options: FixOptions): Promise<{
  results: FixFileResult[]
  summary: { filesFixed: number; totalPatches: number; errors: string[] }
}> {
  const { datapackDir, outputDir, targetVersion, sourceVersion: explicitSource } = options
  const allVersions = await fetchVersions()
  const targetVer = allVersions.find(v => v.name === targetVersion || v.id === targetVersion)
  if (!targetVer) {
    return { results: [], summary: { filesFixed: 0, totalPatches: 0, errors: [`Target version '${targetVersion}' not found`] } }
  }

  // Determine source version
  let sourceVer: McmetaVersion | null = null
  if (explicitSource) {
    sourceVer = allVersions.find(v => v.name === explicitSource || v.id === explicitSource) ?? null
  }
  if (!sourceVer) {
    // Try from pack.mcmeta
    try {
      const { supported_formats } = readPackMcmeta(datapackDir)
      if (supported_formats) {
        sourceVer = allVersions.find(v => v.data_pack_version === supported_formats.max) ?? null
      }
    } catch { }
  }
  if (!sourceVer) {
    return { results: [], summary: { filesFixed: 0, totalPatches: 0, errors: ['Could not determine source version. Use --from-version <ver>'] } }
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

  // Create output directory
  if (!existsSync(outputDir)) {
    mkdirSync(outputDir, { recursive: true })
  }

  // Process mcfunction files
  for (const file of mcfunction) {
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

  // Process JSON files (structural + advancement icon + registry fixes)
  for (const file of json) {
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

    // Registry reference fixing
    if (!portingForward) {
      const registryRules = FEATURE_RULES.filter(r => r.type === 'registry')
      const svDv = sourceVer.data_version
      const tvDv = targetVer.data_version
      for (const rule of registryRules) {
        const ruleMinDv = versionNameToDataVersion(rule.minVersion, allVersions)
        if (ruleMinDv === null) continue
        if (svDv >= ruleMinDv && tvDv < ruleMinDv) {
          // Fix references to this registry
          const searchStr = `${rule.match}/`
          const contentStr = JSON.stringify(currentData)
          if (contentStr.includes(searchStr)) {
            const fixed = contentStr.replace(new RegExp(`"${searchStr}`, 'g'), `"## FIXED(${rule.match} not available in ${targetName})/`)
            try { currentData = JSON.parse(fixed); patches++; details.push(`${rel}: Replaced ${rule.match} references`) } catch { }
          }
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

  return {
    results,
    summary: {
      filesFixed: results.length,
      totalPatches,
      errors,
    },
  }
}
