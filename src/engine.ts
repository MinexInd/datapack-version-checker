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
import { readPackMcmeta, normalizeFormatTuple, type FormatTuple } from './pack-mcmeta.js'
import { getMcdocSymbols, checkMcdocFile, fileKindFromPath } from './mcdoc-check.js'
import { checkJsonFormatFile } from './json-format-check.js'
import { getLogger } from './logger.js'
import { suggestForCommand, suggestForRegistry, suggestForDeprecation, suggestForStructural } from './suggest.js'
import { analyzePack, type AnalysisResult } from './analyzer.js'
import type {
  McmetaVersion,
  VersionCompatibility,
  McfunctionIssue,
  RegistryIssue,
  RegistryDeprecation,
  StructuralIssue,
  ReferenceIssue,
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

function getSnippet(fileContent: string, line: number, context: number = 3): string {
  const lines = fileContent.split('\n')
  const start = Math.max(0, line - 1 - context)
  const end = Math.min(lines.length, line + context)
  return lines.slice(start, end).map((l, i) => {
    const num = start + i + 1
    const marker = num === line ? '> ' : '  '
    return `${marker}${String(num).padStart(3, ' ')} | ${l}`
  }).join('\n')
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
// Resource index / cross-file reference checking
// ---------------------------------------------------------------------------

interface ResourceIndex {
  functions: Set<string>
  textures: Set<string>
  models: Set<string>
  loot_tables: Set<string>
}

function buildResourceIndex(packDir: string): ResourceIndex {
  const idx: ResourceIndex = {
    functions: new Set(),
    textures: new Set(),
    models: new Set(),
    loot_tables: new Set(),
  }

  function walk(dir: string, prefix: string, cb: (rel: string) => void) {
    try {
      for (const entry of readdirSync(dir)) {
        const full = join(dir, entry)
        if (statSync(full).isDirectory()) {
          walk(full, prefix ? `${prefix}/${entry}` : entry, cb)
        } else {
          cb(prefix ? `${prefix}/${entry}` : entry)
        }
      }
    } catch { }
  }

  function scan(baseRel: string, type: keyof ResourceIndex, ext: string) {
    const base = join(packDir, baseRel)
    try {
      for (const ns of readdirSync(base)) {
        const nsDir = join(base, ns)
        if (!statSync(nsDir).isDirectory()) continue
        walk(nsDir, '', (relPath) => {
          const name = relPath.replace(new RegExp(`\\.${ext}$`), '')
          idx[type].add(`${ns}:${name}`)
        })
      }
    } catch { }
  }

  scan('data', 'functions', 'mcfunction')
  scan('data', 'loot_tables', 'json')
  scan('assets', 'models', 'json')
  scan('assets', 'textures', 'png')

  return idx
}

function findJsonLine(content: string, searchValue: string): { line: number; code: string } | null {
  const lines = content.split('\n')
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].includes(searchValue)) {
      return { line: i + 1, code: lines[i].trim() }
    }
  }
  return null
}

function checkReferences(
  commands: CommandLine[],
  jsonFiles: string[],
  packDir: string,
  idx: ResourceIndex,
): ReferenceIssue[] {
  const issues: ReferenceIssue[] = []

  for (const cmd of commands) {
    const funcMatch = cmd.text.match(/^\/(?:function|schedule\s+function)\s+([a-z0-9_.-]+:[a-z0-9\/_.-]+)/)
    if (funcMatch) {
      const ref = funcMatch[1]
      if (!idx.functions.has(ref)) {
        issues.push({
          file: cmd.file,
          line: cmd.line,
          reference: ref,
          type: 'function',
          issue: `References "${ref}" — no matching .mcfunction found in the pack`,
          code: cmd.text,
        })
      }
    }
  }

  for (const file of jsonFiles) {
    const content = readFileSync(file, 'utf-8')
    let data: any
    try { data = JSON.parse(content) } catch { continue }
    const rel = relative(packDir, file).replace(/\\/g, '/')

    if (data.parent && typeof data.parent === 'string' && rel.includes('/models/')) {
      const parentRef = data.parent.includes(':') ? data.parent : `minecraft:${data.parent}`
      if (!idx.models.has(parentRef)) {
        const loc = findJsonLine(content, `"${data.parent}"`)
        issues.push({
          file: rel,
          line: loc?.line,
          reference: data.parent,
          type: 'model',
          issue: `References model "${data.parent}" which doesn't exist in the pack`,
          code: loc?.code,
        })
      }
    }

    if (data.textures && typeof data.textures === 'object' && rel.includes('/models/')) {
      for (const [key, val] of Object.entries(data.textures)) {
        if (typeof val === 'string') {
          if (val.startsWith('#')) continue
          const texRef = val.includes(':') ? val : `minecraft:${val}`
          if (!idx.textures.has(texRef)) {
            const loc = findJsonLine(content, `"${key}"`)
            issues.push({
              file: rel,
              line: loc?.line,
              reference: val,
              type: 'texture',
              issue: `References texture "${val}" which doesn't exist in the pack`,
              code: loc?.code,
            })
          }
        }
      }
    }

    if (data.loot_table && typeof data.loot_table === 'string') {
      if (!idx.loot_tables.has(data.loot_table)) {
        const loc = findJsonLine(content, `"${data.loot_table}"`)
        issues.push({
          file: rel,
          line: loc?.line,
          reference: data.loot_table,
          type: 'loot_table',
          issue: `References loot table "${data.loot_table}" which doesn't exist in the pack`,
          code: loc?.code,
        })
      }
    }
  }

  return issues
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
      const re = new RegExp(rule.match)
      if (re.test(rel) || re.test(content)) {
        hits.push({ rule: { id: rule.id, description: rule.description, type: 'command', match: rule.match, minVersion: rule.minVersion, maxVersion: rule.maxVersion, fix: rule.fix }, file: rel })
      }
    }
  }
  return hits
}

type PackVersionField = 'data_pack_version' | 'resource_pack_version'
type PackVersionMinorField = 'data_pack_version_minor' | 'resource_pack_version_minor'

function findVersionByFormat(
  allVersions: McmetaVersion[],
  tuple: FormatTuple,
  field: PackVersionField,
  minorField: PackVersionMinorField,
): McmetaVersion | undefined {
  const exact = allVersions.find(v => v[field] === tuple[0] && (v[minorField] ?? 0) === tuple[1])
  // Packs legitimately declare "any minor" (e.g. max_format [101, 2147483647]);
  // fall back to a major-only match when the tuple has no exact counterpart.
  return exact ?? allVersions.find(v => v[field] === tuple[0])
}

// New-style (25w31a+) load range from min_format/max_format [major, minor]
// tuples. A missing max_format means "any newer format"; resolve it against the
// newest known version so the checker never silently shrinks the window.
function buildNewStyleLoadRange(
  allVersions: McmetaVersion[],
  minFormat: FormatTuple,
  maxFormat: FormatTuple | null,
  field: PackVersionField,
  minorField: PackVersionMinorField,
): LoadRange {
  const minVer = findVersionByFormat(allVersions, minFormat, field, minorField)
  const maxMajor = maxFormat
    ? maxFormat[0]
    : allVersions.reduce((hi, v) => Math.max(hi, v[field] ?? 0), 0)
  const maxVer = maxFormat
    ? findVersionByFormat(allVersions, maxFormat, field, minorField)
    : allVersions.find(v => v[field] === maxMajor)
  return {
    min: minFormat[0],
    max: maxMajor,
    min_name: minVer?.name ?? null,
    max_name: maxVer?.name ?? null,
  }
}

function buildDatapackLoadRange(packDir: string, allVersions: McmetaVersion[]): LoadRange | null {
  const pmPath = join(packDir, 'pack.mcmeta')
  if (!existsSync(pmPath)) return null
  try {
    const { supported_formats, min_format, max_format } = readPackMcmeta(packDir)
    // Prefer the 25w31a+ min_format range when present; new-style packs omit
    // pack_format, so supported_formats is null for them. Legacy fields remain
    // the source of truth for older and dual-format packs without it.
    if (min_format) {
      return buildNewStyleLoadRange(allVersions, min_format, max_format, 'data_pack_version', 'data_pack_version_minor')
    }
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
    // New-style packs omit pack_format by design (25w31a+), so the min_format
    // check must come before the legacy pack_format guard.
    const min_format = normalizeFormatTuple(data.pack?.min_format)
    if (min_format) {
      return buildNewStyleLoadRange(
        allVersions,
        min_format,
        normalizeFormatTuple(data.pack?.max_format),
        'resource_pack_version',
        'resource_pack_version_minor',
      )
    }
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

  const analysis = await analyzePack(packDir)
  const minVersionName = minDv > 0
    ? allVersions.find(v => v.data_version === minDv)?.name ?? null
    : null

  const resourceIndex = buildResourceIndex(packDir)
  const referenceIssues = ctx.validateCommands
    ? checkReferences(commands, jsonFiles, packDir, resourceIndex)
    : []

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

  const total = relevantVersions.length
  let done = 0

  const checkOneVersion = async (ver: McmetaVersion): Promise<void> => {
    const explicitSelection = targetVersions !== undefined || allVersionsFlag
    const inDeclaredRange = loadRange
      ? (ver[ctx.versionField] ?? 0) >= loadRange.min && (ver[ctx.versionField] ?? 0) <= loadRange.max
      : true
    const inLoadRange = explicitSelection ? true : inDeclaredRange

    let mcfunctionIssues: McfunctionIssue[] = []
    let registryIssues: RegistryIssue[] = []

    if (ctx.validateCommands) {
      let tree: CommandTreeNode | null = null
      try {
        log.time(`command-tree:${ver.id}`)
        tree = await fetchCommandTree(ver.id)
        log.timeEnd(`command-tree:${ver.id}`)
        for (const cmd of commands) {
          const res = validateCommand(cmd.text, tree, !strict)
          if (!res.valid) {
            let snippet: string | undefined
            try {
              snippet = getSnippet(readFileSync(join(packDir, cmd.file), 'utf-8'), cmd.line)
            } catch {}
            mcfunctionIssues.push({
              file: cmd.file,
              line: cmd.line,
              command: cmd.root,
              issue: `Invalid in ${ver.name}: ${res.reason ?? 'syntax error'}`,
              snippet,
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

    let deprecationIssues: RegistryDeprecation[] = []
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

    let structuralIssues: StructuralIssue[] = []
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

    for (const file of jsonFiles) {
      const rel = relative(packDir, file).replace(/\\/g, '/')
      try {
        structuralIssues.push(...checkJsonFormatFile(file, rel, ver.name))
      } catch (e) {
        log.debug(`json format check error for ${rel}:`, e)
      }
    }

    const knowledgeIssues: McfunctionIssue[] = []
    const seenRules = new Set<string>()
    for (const hit of knowledgeHits) {
      const ruleMinDv = versionNameToDataVersion(hit.rule.minVersion, allVersions)
      const ruleMaxDv = hit.rule.maxVersion ? versionNameToDataVersion(hit.rule.maxVersion, allVersions) : null
      if (ruleMaxDv !== null && ver.data_version > ruleMaxDv && !seenRules.has(hit.rule.id)) {
        seenRules.add(hit.rule.id)
        let snippet: string | undefined
        if (hit.file && hit.line) {
          try {
            const fullPath = join(packDir, hit.file)
            const fileContent = readFileSync(fullPath, 'utf-8')
            snippet = getSnippet(fileContent, hit.line)
          } catch {}
        }
        knowledgeIssues.push({
          file: hit.file ?? '(content)',
          line: hit.line ?? 0,
          command: hit.rule.id,
          issue: `Uses ${hit.rule.description} — removed in ${hit.rule.maxVersion} but this is ${ver.name}`,
          snippet,
          // Legacy FeatureRule view: `fix` carries the guidance prose, and
          // rewrite/fix rules are excluded from FEATURE_RULES by design, so
          // knowledge issues are informational only (never auto-fixable).
          suggestion: hit.rule.fix,
          autoFixable: false,
        })
      } else if (ruleMinDv !== null && ver.data_version < ruleMinDv && !seenRules.has(hit.rule.id)) {
        seenRules.add(hit.rule.id)
        let snippet: string | undefined
        if (hit.file && hit.line) {
          try {
            const fullPath = join(packDir, hit.file)
            const fileContent = readFileSync(fullPath, 'utf-8')
            snippet = getSnippet(fileContent, hit.line)
          } catch {}
        }
        knowledgeIssues.push({
          file: hit.file ?? '(content)',
          line: hit.line ?? 0,
          command: hit.rule.id,
          issue: `Uses ${hit.rule.description} — needs >= ${hit.rule.minVersion} but this is ${ver.name}`,
          snippet,
          // Legacy FeatureRule view: `fix` carries the guidance prose, and
          // rewrite/fix rules are excluded from FEATURE_RULES by design, so
          // knowledge issues are informational only (never auto-fixable).
          suggestion: hit.rule.fix,
          autoFixable: false,
        })
      }
    }

    mcfunctionIssues = mcfunctionIssues.map(i => ({ ...i, ...suggestForCommand(i.command) }))
    registryIssues = registryIssues.map(i => ({ ...i, ...suggestForRegistry(i.registry, i.entry) }))
    deprecationIssues = deprecationIssues.map(i => ({ ...i, ...suggestForDeprecation(i.registry, i.entry) }))
    structuralIssues = structuralIssues.map(i => ({ ...i, ...suggestForStructural(i.issue) }))

    const hasContentIssues =
      mcfunctionIssues.length > 0 || registryIssues.length > 0 ||
      knowledgeIssues.length > 0 || structuralIssues.length > 0 ||
      deprecationIssues.length > 0
    const result: VersionCompatibility = {
      version: ver,
      pack_format_match: inDeclaredRange ? 'exact' : 'none',
      status: hasContentIssues ? 'content_issues' : (inLoadRange ? 'compatible' : 'outside_load_range'),
      in_load_range: inLoadRange,
      mcfunction_issues: [...mcfunctionIssues, ...knowledgeIssues],
      registry_issues: registryIssues,
      structural_issues: structuralIssues,
      deprecation_issues: deprecationIssues.length > 0 ? deprecationIssues : undefined,
      reference_issues: referenceIssues.length > 0 ? referenceIssues : undefined,
      breaking_changes: breakingMap[ver.name] ?? [],
    }

    if (inLoadRange && !hasContentIssues) compatible.push(result)
    else incompatible.push(result)
    done++
    log.info(`[${done}/${total}] Checked ${ver.name}`)
  }

  for (let i = 0; i < relevantVersions.length; i += 3) {
    const batch = relevantVersions.slice(i, i + 3)
    await Promise.all(batch.map(ver => checkOneVersion(ver)))
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
    analysis,
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
