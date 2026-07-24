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
  baseDir: string,
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
    const rel = relative(baseDir, file).replace(/\\/g, '/')
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

// ---------------------------------------------------------------------------
// Pack types
// ---------------------------------------------------------------------------

interface LoadRange {
  min: number
  max: number
  min_name: string | null
  max_name: string | null
}

interface ScanResult {
  mcfunction: string[]
  json: string[]
}

interface PackContext {
  versionField: 'data_pack_version' | 'resource_pack_version'
  windowPadding: number
  validateCommands: boolean
  scanFiles: (packDir: string) => ScanResult
  applyKnowledge: (commands: CommandLine[], jsonFiles: string[], packDir: string) => KnowledgeHit[]
  buildLoadRange: (packDir: string, allVersions: McmetaVersion[]) => LoadRange | null
  computeWindow: (loadRange: LoadRange, minVersionName: string | null, allVersions: McmetaVersion[]) => { lo: number; hi: number }
}

function scanDatapackFiles(packDir: string): ScanResult {
  return {
    mcfunction: findMcfunctionFiles(join(packDir, 'data')),
    json: findJsonFiles(join(packDir, 'data')),
  }
}

function scanResourcepackFiles(packDir: string): ScanResult {
  function walk(dir: string, json: string[]): void {
    try {
      for (const entry of readdirSync(dir)) {
        const full = join(dir, entry)
        if (statSync(full).isDirectory()) walk(full, json)
        else if (entry.endsWith('.json') || entry.endsWith('.mcmeta')) json.push(full)
      }
    } catch { }
  }
  const json: string[] = []
  walk(join(packDir, 'assets'), json)
  return { mcfunction: [], json }
}

function applyDatapackKnowledge(commands: CommandLine[], jsonFiles: string[], packDir: string): KnowledgeHit[] {
  return applyKnowledgeRules(commands, jsonFiles, packDir)
}

function applyResourcepackKnowledge(commands: CommandLine[], jsonFiles: string[], packDir: string): KnowledgeHit[] {
  const hits: KnowledgeHit[] = []
  for (const file of jsonFiles) {
    const rel = relative(packDir, file).replace(/\\/g, '/')
    const content = readFileSync(file, 'utf-8')
    for (const rule of RESOURCE_FEATURE_RULES) {
      if (rel.includes(rule.match) || content.includes(rule.match)) {
        hits.push({ rule: { id: rule.id, description: rule.description, type: 'command', match: rule.match, minVersion: rule.minVersion, fix: rule.fix }, file: rel })
      }
    }
  }
  return hits
}

function buildDatapackLoadRange(packDir: string, allVersions: McmetaVersion[]): LoadRange | null {
  const pmPath = join(packDir, 'pack.mcmeta')
  if (!existsSync(pmPath)) return null
  try {
    const { supported_formats } = readPackMcmeta(packDir)
    if (!supported_formats) return null
    const minVer = allVersions.find(v => v.data_pack_version === supported_formats.min)
    const maxVer = allVersions.find(v => v.data_pack_version === supported_formats.max)
    return {
      min: supported_formats.min,
      max: supported_formats.max,
      min_name: minVer?.name ?? null,
      max_name: maxVer?.name ?? null,
    }
  } catch { return null }
}

function buildResourcepackLoadRange(packDir: string, allVersions: McmetaVersion[]): LoadRange | null {
  const pmPath = join(packDir, 'pack.mcmeta')
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
    return { min: rmin, max: rmax, min_name: minVer?.name ?? null, max_name: maxVer?.name ?? null }
  } catch { return null }
}

function computeDatapackWindow(loadRange: LoadRange, minVersionName: string | null, allVersions: McmetaVersion[]): { lo: number; hi: number } {
  const contentMinVer = minVersionName ? allVersions.find(v => v.name === minVersionName) : undefined
  const contentMinPack = contentMinVer?.data_pack_version ?? loadRange.min
  return {
    lo: Math.min(loadRange.min, contentMinPack) - 5,
    hi: Math.max(loadRange.max, contentMinPack) + 5,
  }
}

function computeResourcepackWindow(loadRange: LoadRange, _minVersionName: string | null, _allVersions: McmetaVersion[]): { lo: number; hi: number } {
  return {
    lo: loadRange.min - 3,
    hi: loadRange.max + 3,
  }
}

const DATAPACK: PackContext = {
  versionField: 'data_pack_version',
  windowPadding: 5,
  validateCommands: true,
  scanFiles: scanDatapackFiles,
  applyKnowledge: applyDatapackKnowledge,
  buildLoadRange: buildDatapackLoadRange,
  computeWindow: computeDatapackWindow,
}

const RESOURCEPACK: PackContext = {
  versionField: 'resource_pack_version',
  windowPadding: 3,
  validateCommands: false,
  scanFiles: scanResourcepackFiles,
  applyKnowledge: applyResourcepackKnowledge,
  buildLoadRange: buildResourcepackLoadRange,
  computeWindow: computeResourcepackWindow,
}

async function checkPackCore(
  packDir: string,
  ctx: PackContext,
  targetVersions?: string[],
  allVersionsFlag: boolean = false,
  strict: boolean = false,
): Promise<CheckResult & {
  min_version: string | null
  knowledge_hits: KnowledgeHit[]
  load_range: LoadRange | null
}> {
  const log = getLogger()
  log.time('checkPackCore')

  const allVersions = await fetchVersions()
  const { mcfunction: mcfunctionFiles, json: jsonFiles } = ctx.scanFiles(packDir)

  const commands = scanCommands(mcfunctionFiles, packDir)
  const knowledgeHits = ctx.applyKnowledge(commands, jsonFiles, packDir)
  const minDv = knowledgeMinDataVersion(knowledgeHits, allVersions)
  const minVersionName = minDv > 0
    ? allVersions.find(v => v.data_version === minDv)?.name ?? null
    : null

  const loadRange = ctx.buildLoadRange(packDir, allVersions)

  const releases = allVersions
    .filter(v => v.type === 'release')
    .sort((a, b) => (a[ctx.versionField] ?? 0) - (b[ctx.versionField] ?? 0))
  let relevantVersions: McmetaVersion[]

  if (targetVersions) {
    relevantVersions = allVersions.filter(v => targetVersions.includes(v.id) || targetVersions.includes(v.name))
  } else if (allVersionsFlag) {
    relevantVersions = allVersions
  } else if (loadRange) {
    const { lo, hi } = ctx.computeWindow(loadRange, minVersionName, allVersions)
    relevantVersions = releases.filter(v =>
      (v[ctx.versionField] ?? 0) >= lo && (v[ctx.versionField] ?? 0) <= hi)
  } else {
    relevantVersions = releases.filter(v => v.data_version >= minDv)
  }

  const compatible: VersionCompatibility[] = []
  const incompatible: VersionCompatibility[] = []

  let breakingMap: Record<string, string[]> = {}
  try {
    log.debug('Fetching breaking changes...')
    breakingMap = await getBreakingChanges(relevantVersions)
    log.debug(`Breaking changes: ${Object.keys(breakingMap).length} versions`)
  } catch (e) {
    log.debug('Failed to fetch breaking changes:', e)
    breakingMap = {}
  }

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
    ? jsonFiles.filter(f => fileKindFromPath(relative(packDir, f).replace(/\\/g, '/')))
    : []

  let sourceRegistries: Record<string, string[]> | null = null
  let sourceVersionDv = 0
  if (loadRange) {
    try {
      const sourceVer = allVersions.find(v => v[ctx.versionField] === loadRange.max)
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
      ? (ver[ctx.versionField] ?? 0) >= loadRange.min && (ver[ctx.versionField] ?? 0) <= loadRange.max
      : true

    const mcfunctionIssues: McfunctionIssue[] = []
    const registryIssues: RegistryIssue[] = []

    if (ctx.validateCommands) {
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
    }

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

    if (sourceRegistries && targetRegs && ver.data_version > sourceVersionDv) {
      for (const file of jsonFiles) {
        deprecationIssues.push(...checkDeprecatedRegistryEntries(file, sourceRegistries, targetRegs))
      }
    }

    const structuralIssues: StructuralIssue[] = []
    if (mcdocTable) {
      for (const file of structuralJsonFiles) {
        const rel = relative(packDir, file).replace(/\\/g, '/')
        try {
          structuralIssues.push(...checkMcdocFile(file, rel, ver.name, mcdocTable))
        } catch (e) {
          log.debug(`mcdoc validation error for ${rel}:`, e)
        }
      }
    }

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
  }

  log.timeEnd('version-loop', `checked ${relevantVersions.length} versions`)
  log.timeEnd('checkPackCore')

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

export async function checkCompatibilityContentBased(
  datapackDir: string,
  targetVersions?: string[],
  allVersionsFlag: boolean = false,
  strict: boolean = false,
): Promise<CheckResult & {
  min_version: string | null
  knowledge_hits: KnowledgeHit[]
  load_range: LoadRange | null
}> {
  return checkPackCore(datapackDir, DATAPACK, targetVersions, allVersionsFlag, strict)
}

export async function checkResourcePack(
  resourceDir: string,
  targetVersions?: string[],
  allVersionsFlag: boolean = false,
): Promise<CheckResult & {
  min_version: string | null
  knowledge_hits: KnowledgeHit[]
  load_range: LoadRange | null
}> {
  return checkPackCore(resourceDir, RESOURCEPACK, targetVersions, allVersionsFlag)
}
