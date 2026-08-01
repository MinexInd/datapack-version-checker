import { fetchVersions, fetchCommandTree, fetchRegistries } from './api'
import { validateCommand } from './walker'
import { checkJsonData, checkDeprecatedRegistryEntries } from './json-check'
import { tokenizeCommand } from './tokenizer'
import { FEATURE_RULES, type FeatureRule } from './knowledge'
import { RESOURCE_FEATURE_RULES } from './resource-knowledge'
import { isVersionAtLeast, versionNameToDataVersion } from './version'
import { getBreakingChanges } from './technical-changes'
import { readPackMcmetaFromString, normalizeFormatTuple, type FormatTuple } from './pack-mcmeta'
import { getMcdocSymbols, checkMcdocData, fileKindFromPath } from './mcdoc-check'
import { checkJsonFormatSemantics } from './json-format-check'
import { getLogger } from './logger'
import { suggestForCommand, suggestForRegistry, suggestForDeprecation, suggestForStructural } from './suggest'
import { analyzePack, type AnalysisResult } from './analyzer'
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
} from './types'

export interface PackFileMap {
  [path: string]: string
}

interface CommandLine {
  file: string
  line: number
  text: string
  root: string
}

function findMcfunctionFiles(files: PackFileMap): string[] {
  return Object.keys(files).filter(k => k.startsWith('data/') && k.endsWith('.mcfunction'))
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

function findJsonFiles(files: PackFileMap): string[] {
  return Object.keys(files).filter(k =>
    k.startsWith('data/') && k.endsWith('.json') && !k.endsWith('/pack.mcmeta') && k !== 'pack.mcmeta'
  )
}

function scanCommands(files: PackFileMap, paths: string[], baseDir: string): CommandLine[] {
  const cmds: CommandLine[] = []
  for (const file of paths) {
    const content = files[file]
    if (!content) continue
    const lines = content.split('\n')
    const rel = file
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
  snippet?: string
}

function applyKnowledgeRules(
  commands: CommandLine[],
  files: PackFileMap,
  jsonPaths: string[],
): KnowledgeHit[] {
  const hits: KnowledgeHit[] = []
  for (const cmd of commands) {
    for (const rule of FEATURE_RULES) {
      if (rule.type === 'command') {
        if (cmd.root === rule.match || cmd.root.replace(/^\//, '') === rule.match) {
          hits.push({ rule, file: cmd.file, line: cmd.line, text: cmd.text, snippet: getSnippet(files[cmd.file] ?? '', cmd.line) })
        }
      } else if (rule.type === 'command_pattern') {
        if (new RegExp(rule.match).test(cmd.text)) {
          hits.push({ rule, file: cmd.file, line: cmd.line, text: cmd.text, snippet: getSnippet(files[cmd.file] ?? '', cmd.line) })
        }
      } else if (rule.type === 'function_macro') {
        if (new RegExp(rule.match).test(cmd.text)) {
          hits.push({ rule, file: cmd.file, line: cmd.line, text: cmd.text, snippet: getSnippet(files[cmd.file] ?? '', cmd.line) })
        }
      }
    }
  }
  for (const file of jsonPaths) {
    const content = files[file]
    if (!content) continue
    for (const rule of FEATURE_RULES) {
      if (rule.type === 'registry') {
        const re = new RegExp(rule.match)
        if (re.test(file) || re.test(content)) {
          hits.push({ rule, file })
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
// Resource index / cross-file reference checking (browser-side)
// ---------------------------------------------------------------------------

interface ResourceIndex {
  functions: Set<string>
  textures: Set<string>
  models: Set<string>
  loot_tables: Set<string>
}

function buildResourceIndex(files: PackFileMap): ResourceIndex {
  const idx: ResourceIndex = {
    functions: new Set(),
    textures: new Set(),
    models: new Set(),
    loot_tables: new Set(),
  }

  for (const path of Object.keys(files)) {
    if (path.startsWith('data/') && path.endsWith('.mcfunction')) {
      const nsId = path
        .replace(/^data\//, '')
        .replace(/\.mcfunction$/, '')
        .replace(/\\/g, '/')
      idx.functions.add(nsId)
    }
    if (path.startsWith('data/') && path.endsWith('.json') && path.includes('/loot_tables/')) {
      const nsId = path
        .replace(/^data\//, '')
        .replace(/\.json$/, '')
        .replace(/\\/g, '/')
      idx.loot_tables.add(nsId)
    }
    if (path.startsWith('assets/') && path.endsWith('.json') && path.includes('/models/')) {
      const nsId = path
        .replace(/^assets\//, '')
        .replace(/\.json$/, '')
        .replace(/\\/g, '/')
      idx.models.add(nsId)
    }
    if (path.startsWith('assets/') && path.endsWith('.png') && path.includes('/textures/')) {
      const nsId = path
        .replace(/^assets\//, '')
        .replace(/\.png$/, '')
        .replace(/\\/g, '/')
      idx.textures.add(nsId)
    }
  }

  return idx
}

function findJsonLineBrowser(content: string, searchValue: string): { line: number; code: string } | null {
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
  files: PackFileMap,
  jsonPaths: string[],
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

  for (const file of jsonPaths) {
    const content = files[file]
    if (!content) continue
    let data: any
    try { data = JSON.parse(content) } catch { continue }

    if (data.parent && typeof data.parent === 'string' && file.includes('/models/')) {
      const parentRef = data.parent.includes(':') ? data.parent : `minecraft:${data.parent}`
      if (!idx.models.has(parentRef)) {
        const loc = findJsonLineBrowser(content, `"${data.parent}"`)
        issues.push({
          file,
          line: loc?.line,
          reference: data.parent,
          type: 'model',
          issue: `References model "${data.parent}" which doesn't exist in the pack`,
          code: loc?.code,
        })
      }
    }

    if (data.textures && typeof data.textures === 'object' && file.includes('/models/')) {
      for (const [key, val] of Object.entries(data.textures)) {
        if (typeof val === 'string') {
          if (val.startsWith('#')) continue
          const texRef = val.includes(':') ? val : `minecraft:${val}`
          if (!idx.textures.has(texRef)) {
            const loc = findJsonLineBrowser(content, `"${key}"`)
            issues.push({
              file,
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
        const loc = findJsonLineBrowser(content, `"${data.loot_table}"`)
        issues.push({
          file,
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

const BATCH_SIZE = 3

export type ProgressCallback = (msg: string) => void

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
): { min: number; max: number; min_name: string | null; max_name: string | null } {
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

export async function checkCompatibilityContentBased(
  files: PackFileMap,
  targetVersions?: string[],
  allVersionsFlag: boolean = false,
  strict: boolean = false,
  onProgress?: ProgressCallback,
): Promise<CheckResult & {
  min_version: string | null
  knowledge_hits: KnowledgeHit[]
  load_range: { min: number; max: number; min_name: string | null; max_name: string | null } | null
  analysis: AnalysisResult | null
}> {
  const log = getLogger()
  log.time('checkCompatibilityContentBased')
  const allVersions = await fetchVersions()
  const mcfunctionFiles = findMcfunctionFiles(files)
  const jsonFiles = findJsonFiles(files)

  const commands = scanCommands(files, mcfunctionFiles, '')
  const knowledgeHits = applyKnowledgeRules(commands, files, jsonFiles)
  const minDv = knowledgeMinDataVersion(knowledgeHits, allVersions)
  const minVersionName = minDv > 0
    ? allVersions.find(v => v.data_version === minDv)?.name ?? null
    : null

  const resourceIndex = buildResourceIndex(files)
  const referenceIssues = checkReferences(commands, files, jsonFiles, resourceIndex)

  let loadRange: { min: number; max: number; min_name: string | null; max_name: string | null } | null = null
  const pmContent = files['pack.mcmeta']
  if (pmContent) {
    try {
      const { supported_formats, min_format, max_format } = readPackMcmetaFromString(pmContent)
      // Prefer the 25w31a+ min_format range when present; new-style packs omit
      // pack_format, so supported_formats is null for them. Legacy fields
      // remain the source of truth for older and dual-format packs without it.
      if (min_format) {
        loadRange = buildNewStyleLoadRange(allVersions, min_format, max_format, 'data_pack_version', 'data_pack_version_minor')
      } else if (supported_formats) {
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
    const contentMinVer = minVersionName
      ? allVersions.find(v => v.name === minVersionName) : undefined
    const contentMinPack = contentMinVer?.data_pack_version ?? loadRange.min
    const loPack = Math.min(loadRange.min, contentMinPack) - 5
    const hiPack = Math.max(loadRange.max, contentMinPack) + 5
    relevantVersions = releases.filter(v =>
      v.data_pack_version >= loPack && v.data_pack_version <= hiPack)
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
    ? jsonFiles.filter(f => fileKindFromPath(f))
    : []

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

  const total = relevantVersions.length
  let done = 0
  const onCheckDone = (name: string) => {
    done++
    onProgress?.(`Checked ${name} — ${done}/${total} versions`)
  }

  const checkOneVersion = async (ver: McmetaVersion): Promise<void> => {
    const explicitSelection = targetVersions !== undefined || allVersionsFlag
    const inDeclaredRange = loadRange
      ? (ver.data_pack_version ?? 0) >= loadRange.min && (ver.data_pack_version ?? 0) <= loadRange.max
      : true
    const inLoadRange = explicitSelection ? true : inDeclaredRange

    let mcfunctionIssues: McfunctionIssue[] = []
    let registryIssues: RegistryIssue[] = []

    let tree: CommandTreeNode | null = null
    try {
      onProgress?.(`Fetching command tree for ${ver.name}...`)
      tree = await fetchCommandTree(ver.id)
      onProgress?.(`Validating commands in ${ver.name}...`)
      for (const cmd of commands) {
        const res = validateCommand(cmd.text, tree, !strict)
        if (!res.valid) {
          mcfunctionIssues.push({
            file: cmd.file,
            line: cmd.line,
            command: cmd.root,
            issue: `Invalid in ${ver.name}: ${res.reason ?? 'syntax error'}`,
            snippet: getSnippet(files[cmd.file] ?? '', cmd.line),
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

    let deprecationIssues: RegistryDeprecation[] = []
    let targetRegs: Record<string, string[]> | null = null
    try {
      onProgress?.(`Checking registries for ${ver.name}...`)
      targetRegs = await fetchRegistries(ver.id)
      for (const file of jsonFiles) {
        const content = files[file]
        if (!content) continue
        let data: any
        try { data = JSON.parse(content) } catch { continue }
        const issues = checkJsonData(data, file, targetRegs)
        registryIssues.push(...issues)
      }
    } catch (e) {
      log.warn(`Failed to check registries for ${ver.name}:`, e)
    }

    if (sourceRegistries && targetRegs && ver.data_version > sourceVersionDv) {
      for (const file of jsonFiles) {
        const content = files[file]
        if (!content) continue
        let data: any
        try { data = JSON.parse(content) } catch { continue }
        deprecationIssues.push(...checkDeprecatedRegistryEntries(data, file, sourceRegistries, targetRegs))
      }
    }

    let structuralIssues: StructuralIssue[] = []
    if (mcdocTable) {
      onProgress?.(`Running mcdoc structural check for ${ver.name}...`)
      for (const file of structuralJsonFiles) {
        const content = files[file]
        if (!content) continue
        let data: any
        try { data = JSON.parse(content) } catch { continue }
        try {
          structuralIssues.push(...checkMcdocData(data, file, ver.name, mcdocTable))
        } catch (e) {
          log.debug(`mcdoc validation error for ${file}:`, e)
        }
      }
    }

    for (const file of jsonFiles) {
      const content = files[file]
      if (!content) continue
      let data: any
      try { data = JSON.parse(content) } catch { continue }
      try {
        structuralIssues.push(...checkJsonFormatSemantics(data, file, ver.name))
      } catch (e) {
        log.debug(`json format check error for ${file}:`, e)
      }
    }

    const knowledgeIssues: McfunctionIssue[] = []
    const seenRules = new Set<string>()
    for (const hit of knowledgeHits) {
      const ruleMinDv = versionNameToDataVersion(hit.rule.minVersion, allVersions)
      const ruleMaxDv = hit.rule.maxVersion ? versionNameToDataVersion(hit.rule.maxVersion, allVersions) : null
      if (ruleMaxDv !== null && ver.data_version > ruleMaxDv && !seenRules.has(hit.rule.id)) {
        seenRules.add(hit.rule.id)
        knowledgeIssues.push({
          file: hit.file ?? '(content)',
          line: hit.line ?? 0,
          command: hit.rule.id,
          issue: `Uses ${hit.rule.description} — removed in ${hit.rule.maxVersion} but this is ${ver.name}`,
          snippet: hit.snippet,
          // Legacy FeatureRule view: `fix` carries the guidance prose, and
          // rewrite/fix rules are excluded from FEATURE_RULES by design, so
          // knowledge issues are informational only (never auto-fixable).
          suggestion: hit.rule.fix,
          autoFixable: false,
        })
      } else if (ruleMinDv !== null && ver.data_version < ruleMinDv && !seenRules.has(hit.rule.id)) {
        seenRules.add(hit.rule.id)
        knowledgeIssues.push({
          file: hit.file ?? '(content)',
          line: hit.line ?? 0,
          command: hit.rule.id,
          issue: `Uses ${hit.rule.description} — needs >= ${hit.rule.minVersion} but this is ${ver.name}`,
          snippet: hit.snippet,
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
    onCheckDone(ver.name)
  }

  for (let i = 0; i < relevantVersions.length; i += BATCH_SIZE) {
    const batch = relevantVersions.slice(i, i + BATCH_SIZE)
    await Promise.all(batch.map(ver => checkOneVersion(ver)))
  }

  log.timeEnd('version-loop', `checked ${relevantVersions.length} versions`)
  log.timeEnd('checkCompatibilityContentBased')

  let analysis: AnalysisResult | null = null
  try {
    onProgress?.('Running pack analysis...')
    analysis = await analyzePack(files)
  } catch (e) {
    log.debug('Analysis failed:', e)
  }

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

export async function checkResourcePack(
  files: PackFileMap,
  targetVersions?: string[],
  allVersionsFlag: boolean = false,
  onProgress?: ProgressCallback,
): Promise<CheckResult & {
  min_version: string | null
  knowledge_hits: KnowledgeHit[]
  load_range: { min: number; max: number; min_name: string | null; max_name: string | null } | null
  analysis: AnalysisResult | null
}> {
  const log = getLogger()
  log.time('checkResourcePack')
  const allVersions = await fetchVersions()

  const allPaths = Object.keys(files)
  const jsonFiles = allPaths.filter(k =>
    (k.startsWith('assets/')) &&
    (k.endsWith('.json') || k.endsWith('.mcmeta'))
  )

  const resourceIndex = buildResourceIndex(files)
  const referenceIssues = checkReferences([], files, jsonFiles, resourceIndex)
  const pngFiles = allPaths.filter(k => k.endsWith('.png'))

  const knowledgeHits = applyResourceKnowledge(files, jsonFiles)
  const minDv = knowledgeMinDataVersion(knowledgeHits, allVersions)
  const minVersionName = minDv > 0
    ? allVersions.find(v => v.data_version === minDv)?.name ?? null
    : null

  let loadRange = buildResourceLoadRange(files, allVersions)

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

  let breakingMap: Record<string, string[]> = {}
  try {
    log.debug('Fetching breaking changes...')
    breakingMap = await getBreakingChanges(relevantVersions)
  } catch (e) {
    log.debug('Failed to fetch breaking changes:', e)
    breakingMap = {}
  }

  let mcdocTable = null
  try {
    log.debug('Fetching mcdoc symbols...')
    mcdocTable = await getMcdocSymbols()
  } catch (e) {
    log.debug('Failed to fetch mcdoc symbols:', e)
    mcdocTable = null
  }
  const structuralJsonFiles = mcdocTable
    ? jsonFiles.filter(f => fileKindFromPath(f))
    : []

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

  const total = relevantVersions.length
  let done = 0
  const onCheckDone = (name: string) => {
    done++
  }

  const checkOneVersion = async (ver: McmetaVersion): Promise<void> => {
    const explicitSelection = targetVersions !== undefined || allVersionsFlag
    const inDeclaredRange = loadRange
      ? (ver.resource_pack_version ?? 0) >= loadRange.min && (ver.resource_pack_version ?? 0) <= loadRange.max
      : true
    const inLoadRange = explicitSelection ? true : inDeclaredRange

    let mcfunctionIssues: McfunctionIssue[] = []
    let registryIssues: RegistryIssue[] = []

    let deprecationIssues: RegistryDeprecation[] = []
    let targetRegs: Record<string, string[]> | null = null
    try {
      targetRegs = await fetchRegistries(ver.id)
      for (const file of jsonFiles) {
        const content = files[file]
        if (!content) continue
        let data: any
        try { data = JSON.parse(content) } catch { continue }
        const issues = checkJsonData(data, file, targetRegs)
        registryIssues.push(...issues)
      }
    } catch (e) {
      log.warn(`Failed to check registries for ${ver.name}:`, e)
    }

    if (sourceRegistries && targetRegs && ver.data_version > sourceVersionDv) {
      for (const file of jsonFiles) {
        const content = files[file]
        if (!content) continue
        let data: any
        try { data = JSON.parse(content) } catch { continue }
        deprecationIssues.push(...checkDeprecatedRegistryEntries(data, file, sourceRegistries, targetRegs))
      }
    }

    let structuralIssues: StructuralIssue[] = []
    if (mcdocTable) {
      for (const file of structuralJsonFiles) {
        const content = files[file]
        if (!content) continue
        let data: any
        try { data = JSON.parse(content) } catch { continue }
        try {
          structuralIssues.push(...checkMcdocData(data, file, ver.name, mcdocTable))
        } catch (e) {
          log.debug(`mcdoc validation error for ${file}:`, e)
        }
      }
    }

    for (const file of jsonFiles) {
      const content = files[file]
      if (!content) continue
      let data: any
      try { data = JSON.parse(content) } catch { continue }
      try {
        structuralIssues.push(...checkJsonFormatSemantics(data, file, ver.name))
      } catch (e) {
        log.debug(`json format check error for ${file}:`, e)
      }
    }

    const knowledgeIssues: McfunctionIssue[] = []
    const seenRules = new Set<string>()
    for (const hit of knowledgeHits) {
      const ruleMinDv = versionNameToDataVersion(hit.rule.minVersion, allVersions)
      const ruleMaxDv = hit.rule.maxVersion ? versionNameToDataVersion(hit.rule.maxVersion, allVersions) : null
      if (ruleMaxDv !== null && ver.data_version > ruleMaxDv && !seenRules.has(hit.rule.id)) {
        seenRules.add(hit.rule.id)
        knowledgeIssues.push({
          file: hit.file ?? '(content)',
          line: 0,
          command: hit.rule.id,
          issue: `Uses ${hit.rule.description} — removed in ${hit.rule.maxVersion} but this is ${ver.name}`,
          snippet: hit.snippet,
          // Legacy FeatureRule view: `fix` carries the guidance prose, and
          // rewrite/fix rules are excluded from FEATURE_RULES by design, so
          // knowledge issues are informational only (never auto-fixable).
          suggestion: hit.rule.fix,
          autoFixable: false,
        })
      } else if (ruleMinDv !== null && ver.data_version < ruleMinDv && !seenRules.has(hit.rule.id)) {
        seenRules.add(hit.rule.id)
        knowledgeIssues.push({
          file: hit.file ?? '(content)',
          line: 0,
          command: hit.rule.id,
          issue: `Uses ${hit.rule.description} — needs >= ${hit.rule.minVersion} but this is ${ver.name}`,
          snippet: hit.snippet,
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
      registryIssues.length > 0 || knowledgeIssues.length > 0 ||
      structuralIssues.length > 0 || deprecationIssues.length > 0
    const result: VersionCompatibility = {
      version: ver,
      pack_format_match: inDeclaredRange ? 'exact' : 'none',
      status: hasContentIssues ? 'content_issues' : (inLoadRange ? 'compatible' : 'outside_load_range'),
      in_load_range: inLoadRange,
      mcfunction_issues: mcfunctionIssues,
      registry_issues: registryIssues,
      structural_issues: structuralIssues,
      deprecation_issues: deprecationIssues.length > 0 ? deprecationIssues : undefined,
      reference_issues: referenceIssues.length > 0 ? referenceIssues : undefined,
      breaking_changes: breakingMap[ver.name] ?? [],
    }

    if (inLoadRange && !hasContentIssues) compatible.push(result)
    else incompatible.push(result)
    onCheckDone(ver.name)
  }

  for (let i = 0; i < relevantVersions.length; i += BATCH_SIZE) {
    const batch = relevantVersions.slice(i, i + BATCH_SIZE)
    await Promise.all(batch.map(ver => checkOneVersion(ver)))
  }

  log.timeEnd('rp-version-loop', `checked ${relevantVersions.length} versions`)
  log.timeEnd('checkResourcePack')

  let analysis: AnalysisResult | null = null
  try {
    onProgress?.('Running pack analysis...')
    analysis = await analyzePack(files)
  } catch (e) {
    log.debug('Analysis failed:', e)
  }

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

function applyResourceKnowledge(files: PackFileMap, jsonFiles: string[]): KnowledgeHit[] {
  const hits: KnowledgeHit[] = []
  for (const file of jsonFiles) {
    const content = files[file]
    if (!content) continue
    for (const rule of RESOURCE_FEATURE_RULES) {
      if (file.includes(rule.match) || content.includes(rule.match)) {
        hits.push({ rule: { id: rule.id, description: rule.description, type: 'command', match: rule.match, minVersion: rule.minVersion, maxVersion: rule.maxVersion, fix: rule.fix }, file })
      }
    }
  }
  return hits
}

function buildResourceLoadRange(
  files: PackFileMap,
  allVersions: McmetaVersion[],
): { min: number; max: number; min_name: string | null; max_name: string | null } | null {
  const pmContent = files['pack.mcmeta']
  if (!pmContent) return null
  try {
    const data = JSON.parse(pmContent)
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
    return {
      min: rmin,
      max: rmax,
      min_name: minVer?.name ?? null,
      max_name: maxVer?.name ?? null,
    }
  } catch { return null }
}
