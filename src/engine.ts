import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fetchVersions, fetchCommandTree, fetchRegistries } from './api.js'
import { validateCommand } from './walker.js'
import { checkJsonFile, checkDeprecatedRegistryEntries } from './json-check.js'
import { tokenizeCommand } from './tokenizer.js'
import { FEATURE_RULES, type FeatureRule } from './knowledge.js'
import { RESOURCE_FEATURE_RULES } from './resource-knowledge.js'
import { isVersionAtLeast, versionNameToDataVersion } from './version.js'
import { getBreakingChanges } from './technical-changes.js'
import { readPackMcmeta } from './pack-mcmeta.js'
import { getMcdocSymbols, checkMcdocFile, fileKindFromPath } from './mcdoc-check.js'
import { getLogger } from './logger.js'
import type {
  McmetaVersion,
  VersionCompatibility,
  McfunctionIssue,
  RegistryIssue,
  RegistryDeprecation,
  StructuralIssue,
  CommandTreeNode,
  CheckResult,
} from './types.js'

interface CommandLine {
  file: string
  line: number
  text: string
  root: string
}

function findMcfunctionFiles(dir: string): string[] {
  const files: string[] = []
  try {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry)
      if (statSync(full).isDirectory()) files.push(...findMcfunctionFiles(full))
      else if (entry.endsWith('.mcfunction')) files.push(full)
    }
  } catch { }
  return files
}

function findJsonFiles(dir: string): string[] {
  const files: string[] = []
  try {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry)
      if (statSync(full).isDirectory()) files.push(...findJsonFiles(full))
      else if (entry.endsWith('.json') && entry !== 'pack.mcmeta') files.push(full)
    }
  } catch { }
  return files
}

function scanCommands(files: string[], baseDir: string): CommandLine[] {
  const cmds: CommandLine[] = []
  for (const file of files) {
    const content = readFileSync(file, 'utf-8')
    const lines = content.split('\n')
    const rel = relative(baseDir, file)
    lines.forEach((line, i) => {
      const trimmed = line.trim()
      if (!trimmed || trimmed.startsWith('#')) return
      const tokens = tokenizeCommand(trimmed)
      if (tokens.length === 0) return
      cmds.push({
        file: rel,
        line: i + 1,
        text: trimmed,
        root: tokens[0].value.replace(/^\//, ''),
      })
    })
  }
  return cmds
}

interface KnowledgeHit {
  rule: FeatureRule
  file?: string
  line?: number
  text?: string
}

function applyKnowledgeRules(
  commands: CommandLine[],
  jsonFiles: string[],
): KnowledgeHit[] {
  const hits: KnowledgeHit[] = []
  for (const cmd of commands) {
    for (const rule of FEATURE_RULES) {
      if (rule.type === 'command') {
        if (cmd.root === rule.match || cmd.root.replace(/^\//, '') === rule.match) {
          hits.push({ rule, file: cmd.file, line: cmd.line, text: cmd.text })
        }
      } else if (rule.type === 'command_pattern') {
        if (new RegExp(rule.match).test(cmd.text)) {
          hits.push({ rule, file: cmd.file, line: cmd.line, text: cmd.text })
        }
      } else if (rule.type === 'function_macro') {
        if (new RegExp(rule.match).test(cmd.text)) {
          hits.push({ rule, file: cmd.file, line: cmd.line, text: cmd.text })
        }
      }
    }
  }
  for (const file of jsonFiles) {
    const rel = relative(process.cwd(), file).replace(/\\/g, '/')
    const content = readFileSync(file, 'utf-8')
    for (const rule of FEATURE_RULES) {
      if (rule.type === 'registry') {
        // Registry features are detected by the datapack file path
        // (e.g. data/<ns>/enchantment/foo.json) or by referencing the
        // registry in content as a path-style reference (enchantment/foo)
        if (rel.includes(`/${rule.match}/`) || content.includes(`${rule.match}/`)) {
          hits.push({ rule, file: rel })
        }
      }
    }
  }
  return hits
}

function knowledgeMinDataVersion(hits: KnowledgeHit[], versions: McmetaVersion[]): number {
  let min = 0
  for (const hit of hits) {
    const dv = versionNameToDataVersion(hit.rule.minVersion, versions)
    if (dv !== null && dv > min) min = dv
  }
  return min
}

export async function checkCompatibilityContentBased(
  datapackDir: string,
  targetVersions?: string[],
  allVersionsFlag: boolean = false,
  strict: boolean = false,
): Promise<CheckResult & {
  min_version: string | null
  knowledge_hits: KnowledgeHit[]
  load_range: { min: number; max: number; min_name: string | null; max_name: string | null } | null
}> {
  const log = getLogger()
  log.time('checkCompatibilityContentBased')
  const allVersions = await fetchVersions()
  const mcfuncDir = join(datapackDir, 'data')
  const mcfunctionFiles = findMcfunctionFiles(mcfuncDir)
  const jsonFiles = findJsonFiles(mcfuncDir)

  const commands = scanCommands(mcfunctionFiles, datapackDir)
  const knowledgeHits = applyKnowledgeRules(commands, jsonFiles)
  const minDv = knowledgeMinDataVersion(knowledgeHits, allVersions)
  const minVersionName = minDv > 0
    ? allVersions.find(v => v.data_version === minDv)?.name ?? null
    : null

  // Read pack.mcmeta to get the LOAD range (what Minecraft will actually load).
  // This is the authoritative "will it load" signal; content analysis finds breaks.
  let loadRange: { min: number; max: number; min_name: string | null; max_name: string | null } | null = null
  const pmPath = join(datapackDir, 'pack.mcmeta')
  if (existsSync(pmPath)) {
    try {
      const { supported_formats } = readPackMcmeta(datapackDir)
      if (supported_formats) {
        const minVer = allVersions.find(v => v.data_pack_version === supported_formats.min)
        const maxVer = allVersions.find(v => v.data_pack_version === supported_formats.max)
        loadRange = {
          min: supported_formats.min,
          max: supported_formats.max,
          min_name: minVer?.name ?? null,
          max_name: maxVer?.name ?? null,
        }
      }
    } catch (e) {
      log.debug('Failed to resolve load range:', e)
    }
  }

  const releases = allVersions
    .filter(v => v.type === 'release')
    .sort((a, b) => a.data_version - b.data_version)
  let relevantVersions: McmetaVersion[]

  if (targetVersions) {
    relevantVersions = allVersions.filter(v => targetVersions.includes(v.id) || targetVersions.includes(v.name))
  } else if (allVersionsFlag) {
    relevantVersions = allVersions
  } else if (loadRange) {
    // Candidate versions: a window (in pack-format units) around BOTH the
    // declared load range AND the content-minimum version, so we surface
    // breaks inside and just outside the declared range.
    const contentMinVer = minVersionName
      ? allVersions.find(v => v.name === minVersionName) : undefined
    const contentMinPack = contentMinVer?.data_pack_version ?? loadRange.min
    const loPack = Math.min(loadRange.min, contentMinPack) - 5
    const hiPack = Math.max(loadRange.max, contentMinPack) + 5
    relevantVersions = releases.filter(v =>
      v.data_pack_version >= loPack && v.data_pack_version <= hiPack)
  } else {
    // No pack.mcmeta: fall back to content-based (knowledge minimum)
    relevantVersions = releases.filter(v => v.data_version >= minDv)
  }

  const compatible: VersionCompatibility[] = []
  const incompatible: VersionCompatibility[] = []

  // Pull community-curated breaking changes (misode/technical-changes) per version.
  let breakingMap: Record<string, string[]> = {}
  try {
    log.debug('Fetching breaking changes...')
    breakingMap = await getBreakingChanges(relevantVersions)
    log.debug(`Breaking changes: ${Object.keys(breakingMap).length} versions`)
  } catch (e) {
    log.debug('Failed to fetch breaking changes:', e)
    breakingMap = {}
  }

  // Structural JSON schema (vanilla-mcdoc). Built once, applied per version via
  // #[since]/#[until] gating. Degrades gracefully if the network is unavailable.
  let mcdocTable = null
  try {
    log.debug('Fetching mcdoc symbols...')
    mcdocTable = await getMcdocSymbols()
    log.debug(`Mcdoc symbols loaded: ${mcdocTable ? 'yes' : 'no'}`)
  } catch (e) {
    log.debug('Failed to fetch mcdoc symbols:', e)
    mcdocTable = null
  }
  const structuralJsonFiles = mcdocTable
    ? jsonFiles.filter(f => fileKindFromPath(relative(datapackDir, f).replace(/\\/g, '/')))
    : []

  // Fetch source version registries for deprecation detection.
  // The source is the max of the declared load range (the latest version the
  // datapack was designed for). If no load range, we skip deprecation checking.
  let sourceRegistries: Record<string, string[]> | null = null
  let sourceVersionDv = 0
  if (loadRange) {
    try {
      const sourceVer = allVersions.find(v => v.data_pack_version === loadRange.max)
      if (sourceVer) {
        log.debug(`Fetching source registries for deprecation: ${sourceVer.name}`)
        sourceRegistries = await fetchRegistries(sourceVer.id)
        sourceVersionDv = sourceVer.data_version
      }
    } catch (e) {
      log.debug('Failed to fetch source registries:', e)
    }
  }

  log.info(`Checking ${relevantVersions.length} versions...`)
  log.time('version-loop')

  for (const ver of relevantVersions) {
    const inLoadRange = loadRange
      ? ver.data_pack_version >= loadRange.min && ver.data_pack_version <= loadRange.max
      : true

    const mcfunctionIssues: McfunctionIssue[] = []
    const registryIssues: RegistryIssue[] = []

    // Validate commands against this version's command tree
    let tree: CommandTreeNode | null = null
    try {
      log.time(`command-tree:${ver.id}`)
      tree = await fetchCommandTree(ver.id)
      log.timeEnd(`command-tree:${ver.id}`)
      for (const cmd of commands) {
        const res = validateCommand(cmd.text, tree, !strict)
        if (!res.valid) {
          mcfunctionIssues.push({
            file: cmd.file,
            line: cmd.line,
            command: cmd.root,
            issue: `Invalid in ${ver.name}: ${res.reason ?? 'syntax error'}`,
          })
        }
      }
    } catch (e) {
      log.warn(`Failed to check commands for ${ver.name}:`, e)
      mcfunctionIssues.push({
        file: '(api)',
        line: 0,
        command: '',
        issue: `Could not fetch command tree: ${e}`,
      })
    }

    // Validate JSON against this version's registries
    const deprecationIssues: RegistryDeprecation[] = []
    let targetRegs: Record<string, string[]> | null = null
    try {
      log.time(`registries:${ver.id}`)
      targetRegs = await fetchRegistries(ver.id)
      log.timeEnd(`registries:${ver.id}`)
      for (const file of jsonFiles) {
        const issues = checkJsonFile(file, targetRegs)
        registryIssues.push(...issues)
      }
    } catch (e) {
      log.warn(`Failed to check registries for ${ver.name}:`, e)
    }

    // Detect registry deprecations: entries that existed in the source version
    // but were REMOVED by this (newer) target version.
    if (sourceRegistries && targetRegs && ver.data_version > sourceVersionDv) {
      for (const file of jsonFiles) {
        deprecationIssues.push(...checkDeprecatedRegistryEntries(file, sourceRegistries, targetRegs))
      }
    }

    // Validate JSON structure against vanilla-mcdoc (field names, dispatch
    // `type` values, and #[since]/#[until] version gating).
    const structuralIssues: StructuralIssue[] = []
    if (mcdocTable) {
      for (const file of structuralJsonFiles) {
        const rel = relative(datapackDir, file).replace(/\\/g, '/')
        try {
          structuralIssues.push(...checkMcdocFile(file, rel, ver.name, mcdocTable))
        } catch (e) {
          log.debug(`mcdoc validation error for ${rel}:`, e)
        }
      }
    }

    // Knowledge-based issues: "what people say" — a feature requires a newer
    // version than this one. This OVERRIDES the lenient walker, which tolerates
    // tree gaps and would otherwise miss version-gating features.
    const knowledgeIssues: McfunctionIssue[] = []
    const seenRules = new Set<string>()
    for (const hit of knowledgeHits) {
      const ruleMinDv = versionNameToDataVersion(hit.rule.minVersion, allVersions)
      if (ruleMinDv !== null && ver.data_version < ruleMinDv && !seenRules.has(hit.rule.id)) {
        seenRules.add(hit.rule.id)
        knowledgeIssues.push({
          file: hit.file ?? '(content)',
          line: hit.line ?? 0,
          command: hit.rule.id,
          issue: `Uses ${hit.rule.description} — needs >= ${hit.rule.minVersion} but this is ${ver.name}`,
        })
      }
    }

    const hasContentIssues =
      mcfunctionIssues.length > 0 || registryIssues.length > 0 ||
      knowledgeIssues.length > 0 || structuralIssues.length > 0 ||
      deprecationIssues.length > 0
    const result: VersionCompatibility = {
      version: ver,
      pack_format_match: inLoadRange ? 'exact' : 'none',
      status: hasContentIssues ? 'content_issues' : (inLoadRange ? 'compatible' : 'outside_load_range'),
      in_load_range: inLoadRange,
      mcfunction_issues: [...mcfunctionIssues, ...knowledgeIssues],
      registry_issues: registryIssues,
      structural_issues: structuralIssues,
      deprecation_issues: deprecationIssues.length > 0 ? deprecationIssues : undefined,
      breaking_changes: breakingMap[ver.name] ?? [],
    }

    if (inLoadRange && !hasContentIssues) compatible.push(result)
    else incompatible.push(result)

    tree = null
  }

  log.timeEnd('version-loop', `checked ${relevantVersions.length} versions`)
  log.timeEnd('checkCompatibilityContentBased')

  return {
    target_version_id: loadRange ? `${loadRange.min}-${loadRange.max}` : 'content-based',
    pack_format: loadRange?.min ?? 0,
    versions_checked: relevantVersions.length,
    compatible,
    incompatible,
    min_version: minVersionName,
    knowledge_hits: knowledgeHits,
    load_range: loadRange,
  }
}

// ---------------------------------------------------------------------------
// Resource pack mode
// ---------------------------------------------------------------------------

/** Find resource pack files under assets/ (JSON, PNG, and .mcmeta). */
function findResourceFiles(dir: string): { json: string[]; png: string[] } {
  const json: string[] = []
  const png: string[] = []
  try {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry)
      if (statSync(full).isDirectory()) {
        const sub = findResourceFiles(full)
        json.push(...sub.json)
        png.push(...sub.png)
      } else if (entry.endsWith('.json')) {
        json.push(full)
      } else if (entry.endsWith('.png')) {
        png.push(full)
      } else if (entry.endsWith('.mcmeta')) {
        json.push(full)
      }
    }
  } catch { }
  return { json, png }
}

/** Build a load range from pack.mcmeta using resource_pack_version. */
function buildResourceLoadRange(
  datapackDir: string,
  allVersions: McmetaVersion[],
): { min: number; max: number; min_name: string | null; max_name: string | null } | null {
  const pmPath = join(datapackDir, 'pack.mcmeta')
  if (!existsSync(pmPath)) return null
  try {
    const raw = readFileSync(pmPath, 'utf-8')
    const data = JSON.parse(raw)
    const pf = data.pack?.pack_format
    if (typeof pf !== 'number') return null
    const sf = data.pack?.supported_formats
    let rmin = pf, rmax = pf
    if (sf !== undefined && sf !== null) {
      if (typeof sf === 'number') { rmin = sf; rmax = sf }
      else if (Array.isArray(sf)) { rmin = Math.min(...sf); rmax = Math.max(...sf) }
      else if (typeof sf === 'object') {
        if ('min_inclusive' in sf) rmin = sf.min_inclusive
        if ('max_inclusive' in sf) rmax = sf.max_inclusive
      }
    }
    const minVer = allVersions.find(v => v.resource_pack_version === rmin)
    const maxVer = allVersions.find(v => v.resource_pack_version === rmax)
    return {
      min: rmin,
      max: rmax,
      min_name: minVer?.name ?? null,
      max_name: maxVer?.name ?? null,
    }
  } catch { return null }
}

/** Apply resource knowledge rules to JSON file paths */
function applyResourceKnowledge(jsonFiles: string[], datapackDir: string): KnowledgeHit[] {
  const hits: KnowledgeHit[] = []
  for (const file of jsonFiles) {
    const rel = relative(datapackDir, file).replace(/\\/g, '/')
    const content = readFileSync(file, 'utf-8')
    for (const rule of RESOURCE_FEATURE_RULES) {
      if (rel.includes(rule.match) || content.includes(rule.match)) {
        hits.push({ rule: { id: rule.id, description: rule.description, type: 'command', match: rule.match, minVersion: rule.minVersion, fix: rule.fix }, file: rel })
      }
    }
  }
  return hits
}

export async function checkResourcePack(
  resourceDir: string,
  targetVersions?: string[],
  allVersionsFlag: boolean = false,
): Promise<CheckResult & {
  min_version: string | null
  knowledge_hits: KnowledgeHit[]
  load_range: { min: number; max: number; min_name: string | null; max_name: string | null } | null
}> {
  const log = getLogger()
  log.time('checkResourcePack')
  const allVersions = await fetchVersions()
  const assetsDir = join(resourceDir, 'assets')

  // Scan files
  const { json: jsonFiles, png: pngFiles } = findResourceFiles(assetsDir)

  // Resource knowledge rules
  const knowledgeHits = applyResourceKnowledge(jsonFiles, resourceDir)
  const minDv = knowledgeMinDataVersion(knowledgeHits, allVersions)
  const minVersionName = minDv > 0
    ? allVersions.find(v => v.data_version === minDv)?.name ?? null
    : null

  // Load range from pack.mcmeta (using resource_pack_version)
  let loadRange = buildResourceLoadRange(resourceDir, allVersions)

  const releases = allVersions
    .filter(v => v.type === 'release')
    .sort((a, b) => a.resource_pack_version - b.resource_pack_version)
  let relevantVersions: McmetaVersion[]

  if (targetVersions) {
    relevantVersions = allVersions.filter(v => targetVersions.includes(v.id) || targetVersions.includes(v.name))
  } else if (allVersionsFlag) {
    relevantVersions = allVersions
  } else if (loadRange) {
    const loPack = loadRange.min - 3
    const hiPack = loadRange.max + 3
    relevantVersions = releases.filter(v =>
      v.resource_pack_version >= loPack && v.resource_pack_version <= hiPack)
  } else {
    relevantVersions = releases.filter(v => v.data_version >= minDv)
  }

  const compatible: VersionCompatibility[] = []
  const incompatible: VersionCompatibility[] = []

  // Breaking changes
  let breakingMap: Record<string, string[]> = {}
  try {
    log.debug('Fetching breaking changes...')
    breakingMap = await getBreakingChanges(relevantVersions)
  } catch (e) {
    log.debug('Failed to fetch breaking changes:', e)
    breakingMap = {}
  }

  // mcdoc symbols for resource types
  let mcdocTable = null
  try {
    log.debug('Fetching mcdoc symbols...')
    mcdocTable = await getMcdocSymbols()
  } catch (e) {
    log.debug('Failed to fetch mcdoc symbols:', e)
    mcdocTable = null
  }
  const structuralJsonFiles = mcdocTable
    ? jsonFiles.filter(f => fileKindFromPath(relative(resourceDir, f).replace(/\\/g, '/')))
    : []

  // Source registries for deprecation detection
  let sourceRegistries: Record<string, string[]> | null = null
  let sourceVersionDv = 0
  if (loadRange) {
    try {
      const sourceVer = allVersions.find(v => v.resource_pack_version === loadRange.max)
      if (sourceVer) {
        log.debug(`Fetching source registries for deprecation: ${sourceVer.name}`)
        sourceRegistries = await fetchRegistries(sourceVer.id)
        sourceVersionDv = sourceVer.data_version
      }
    } catch (e) {
      log.debug('Failed to fetch source registries:', e)
    }
  }

  log.info(`Checking ${relevantVersions.length} versions...`)
  log.time('rp-version-loop')

  for (const ver of relevantVersions) {
    const inLoadRange = loadRange
      ? ver.resource_pack_version >= loadRange.min && ver.resource_pack_version <= loadRange.max
      : true

    const mcfunctionIssues: McfunctionIssue[] = []
    const registryIssues: RegistryIssue[] = []

    // No command validation for resource packs
    // Validate JSON against this version's registries
    const deprecationIssues: RegistryDeprecation[] = []
    let targetRegs: Record<string, string[]> | null = null
    try {
      targetRegs = await fetchRegistries(ver.id)
      for (const file of jsonFiles) {
        const issues = checkJsonFile(file, targetRegs)
        registryIssues.push(...issues)
      }
    } catch (e) {
      log.warn(`Failed to check registries for ${ver.name}:`, e)
    }

    // Deprecation detection
    if (sourceRegistries && targetRegs && ver.data_version > sourceVersionDv) {
      for (const file of jsonFiles) {
        deprecationIssues.push(...checkDeprecatedRegistryEntries(file, sourceRegistries, targetRegs))
      }
    }

    // mcdoc structural validation for resource types
    const structuralIssues: StructuralIssue[] = []
    if (mcdocTable) {
      for (const file of structuralJsonFiles) {
        const rel = relative(resourceDir, file).replace(/\\/g, '/')
        try {
          structuralIssues.push(...checkMcdocFile(file, rel, ver.name, mcdocTable))
        } catch (e) {
          log.debug(`mcdoc validation error for ${rel}:`, e)
        }
      }
    }

    // Resource knowledge-based issues
    const knowledgeIssues: McfunctionIssue[] = []
    const seenRules = new Set<string>()
    for (const hit of knowledgeHits) {
      const ruleMinDv = versionNameToDataVersion(hit.rule.minVersion, allVersions)
      if (ruleMinDv !== null && ver.data_version < ruleMinDv && !seenRules.has(hit.rule.id)) {
        seenRules.add(hit.rule.id)
        knowledgeIssues.push({
          file: hit.file ?? '(content)',
          line: 0,
          command: hit.rule.id,
          issue: `Uses ${hit.rule.description} — needs >= ${hit.rule.minVersion} but this is ${ver.name}`,
        })
      }
    }

    const hasContentIssues =
      registryIssues.length > 0 || knowledgeIssues.length > 0 ||
      structuralIssues.length > 0 || deprecationIssues.length > 0
    const result: VersionCompatibility = {
      version: ver,
      pack_format_match: inLoadRange ? 'exact' : 'none',
      status: hasContentIssues ? 'content_issues' : (inLoadRange ? 'compatible' : 'outside_load_range'),
      in_load_range: inLoadRange,
      mcfunction_issues: mcfunctionIssues,
      registry_issues: registryIssues,
      structural_issues: structuralIssues,
      deprecation_issues: deprecationIssues.length > 0 ? deprecationIssues : undefined,
      breaking_changes: breakingMap[ver.name] ?? [],
    }

    if (inLoadRange && !hasContentIssues) compatible.push(result)
    else incompatible.push(result)
  }

  log.timeEnd('rp-version-loop')
  log.timeEnd('checkResourcePack')

  return {
    target_version_id: loadRange ? `${loadRange.min}-${loadRange.max}` : 'content-based',
    pack_format: loadRange?.min ?? 0,
    versions_checked: relevantVersions.length,
    compatible,
    incompatible,
    min_version: minVersionName,
    knowledge_hits: knowledgeHits,
    load_range: loadRange,
  }
}
