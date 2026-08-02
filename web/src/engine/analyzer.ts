import { tokenizeCommand } from './tokenizer'
import type { PackFileMap } from './engine'

// ---------------------------------------------------------------------------
// Types (same as server but web-compatible)
// ---------------------------------------------------------------------------

export interface ResourceEntry {
  type: string
  namespace: string
  name: string
  fullPath: string
  file: string
  size: number
}

export interface CrossRef {
  from: string
  to: string
  type: string
  file: string
  line?: number
  code?: string
}

export interface AnalysisMetrics {
  totalFunctions: number
  totalJsonFiles: number
  totalResources: number
  totalCommands: number
  avgCommandsPerFunction: number
  maxExecuteDepth: number
  largestFunction: { file: string; lines: number } | null
  namespaceCounts: Record<string, number>
}

export interface AnalysisResult {
  resources: ResourceEntry[]
  references: CrossRef[]
  orphans: ResourceEntry[]
  brokenRefs: CrossRef[]
  circularDeps: string[][]
  metrics: AnalysisMetrics
}

export interface PortingAction {
  file: string
  line?: number
  type: 'command_rewrite' | 'command_comment' | 'json_rename' | 'json_remove_field' | 'json_comment_registry' | 'pack_format_update' | 'mcdoc_remove' | 'cascade_fix'
  description: string
  oldCode?: string
  newCode?: string
  autoFixable: boolean
}

export interface CascadeEffect {
  trigger: string
  triggerFile: string
  affectedFiles: string[]
  description: string
}

export interface PortingPlan {
  sourceVersion: string
  targetVersion: string
  portingForward: boolean
  actions: PortingAction[]
  cascadeEffects: CascadeEffect[]
  manualAttention: Array<{
    file: string
    description: string
    reason: string
  }>
  summary: {
    totalActions: number
    autoFixable: number
    manualRequired: number
    filesAffected: number
    cascadeCount: number
  }
}

// ---------------------------------------------------------------------------
// Resource type detection from file paths
// ---------------------------------------------------------------------------

const PATH_TYPE_MAP: [RegExp, string][] = [
  [/^data\/[^/]+\/functions\//, 'function'],
  [/^data\/[^/]+\/tags\/functions\//, 'tag/function'],
  [/^data\/[^/]+\/tags\/blocks\//, 'tag/block'],
  [/^data\/[^/]+\/tags\/items\//, 'tag/item'],
  [/^data\/[^/]+\/tags\/entity_types\//, 'tag/entity_type'],
  [/^data\/[^/]+\/tags\/game_events\//, 'tag/game_event'],
  [/^data\/[^/]+\/tags\//, 'tag'],
  [/^data\/[^/]+\/advancements\//, 'advancement'],
  [/^data\/[^/]+\/predicates\//, 'predicate'],
  [/^data\/[^/]+\/item_modifiers\//, 'item_modifier'],
  [/^data\/[^/]+\/loot_tables\//, 'loot_table'],
  [/^data\/[^/]+\/recipes\//, 'recipe'],
  [/^data\/[^/]+\/worldgen\/biome\//, 'worldgen/biome'],
  [/^data\/[^/]+\/worldgen\/configured_feature\//, 'worldgen/configured_feature'],
  [/^data\/[^/]+\/worldgen\/placed_feature\//, 'worldgen/placed_feature'],
  [/^data\/[^/]+\/worldgen\/template_pool\//, 'worldgen/template_pool'],
  [/^data\/[^/]+\/worldgen\/structure\//, 'worldgen/structure'],
  [/^data\/[^/]+\/worldgen\/structure_set\//, 'worldgen/structure_set'],
  [/^data\/[^/]+\/worldgen\/dimension_type\//, 'worldgen/dimension_type'],
  [/^data\/[^/]+\/worldgen\/noise_settings\//, 'worldgen/noise_settings'],
  [/^data\/[^/]+\/worldgen\/density_function\//, 'worldgen/density_function'],
  [/^data\/[^/]+\/worldgen\/world_preset\//, 'worldgen/world_preset'],
  [/^data\/[^/]+\/worldgen\/noise_router\//, 'worldgen/noise_router'],
  [/^data\/[^/]+\/worldgen\//, 'worldgen'],
  [/^assets\/[^/]+\/models\//, 'model'],
  [/^assets\/[^/]+\/textures\//, 'texture'],
  [/^assets\/[^/]+\/blockstates\//, 'blockstate'],
]

function detectResourceType(relPath: string): string | null {
  for (const [pattern, type] of PATH_TYPE_MAP) {
    if (pattern.test(relPath)) return type
  }
  return null
}

function extractNamespaceAndName(relPath: string, type: string): { namespace: string; name: string } {
  const parts = relPath.replace(/\\/g, '/').split('/')
  const dataIdx = parts.indexOf('data')
  const assetsIdx = parts.indexOf('assets')
  const base = dataIdx >= 0 ? dataIdx : assetsIdx
  if (base < 0) return { namespace: 'minecraft', name: relPath }

  const ns = parts[base + 1] ?? 'minecraft'

  let nameParts: string[]
  if (type === 'function') {
    const funcIdx = parts.indexOf('functions', base)
    nameParts = parts.slice(funcIdx + 1)
  } else if (type.startsWith('tag/')) {
    const tagIdx = parts.indexOf('tags', base)
    const subIdx = tagIdx + 2
    nameParts = parts.slice(subIdx)
  } else if (type === 'recipe') {
    const recipesIdx = parts.indexOf('recipes', base)
    nameParts = parts.slice(recipesIdx + 1)
  } else if (type === 'advancement') {
    const advIdx = parts.indexOf('advancements', base)
    nameParts = parts.slice(advIdx + 1)
  } else if (type === 'predicate') {
    const predIdx = parts.indexOf('predicates', base)
    nameParts = parts.slice(predIdx + 1)
  } else if (type === 'item_modifier') {
    const modIdx = parts.indexOf('item_modifiers', base)
    nameParts = parts.slice(modIdx + 1)
  } else if (type === 'loot_table') {
    const ltIdx = parts.indexOf('loot_tables', base)
    nameParts = parts.slice(ltIdx + 1)
  } else if (type.startsWith('worldgen/')) {
    const worldIdx = parts.indexOf('worldgen', base)
    const subType = type.split('/')[1]
    const typeIdx = parts.indexOf(subType, worldIdx)
    nameParts = parts.slice(typeIdx + 1)
  } else if (type === 'model') {
    const modelsIdx = parts.indexOf('models', base)
    nameParts = parts.slice(modelsIdx + 1)
  } else if (type === 'texture') {
    const texIdx = parts.indexOf('textures', base)
    nameParts = parts.slice(texIdx + 1)
  } else if (type === 'blockstate') {
    const bsIdx = parts.indexOf('blockstates', base)
    nameParts = parts.slice(bsIdx + 1)
  } else {
    nameParts = parts.slice(base + 2)
  }

  const name = nameParts.join('/').replace(/\.(mcfunction|json)$/, '')
  return { namespace: ns, name }
}

// ---------------------------------------------------------------------------
// Build full resource index
// ---------------------------------------------------------------------------

export function buildResourceIndex(files: PackFileMap): ResourceEntry[] {
  const resources: ResourceEntry[] = []

  for (const path of Object.keys(files)) {
    const ext = path.endsWith('.mcfunction') ? '.mcfunction' : path.endsWith('.json') ? '.json' : null
    if (!ext) continue

    const type = detectResourceType(path)
    if (!type) continue

    const { namespace, name } = extractNamespaceAndName(path, type)
    const content = files[path] ?? ''
    const size = content.length

    resources.push({
      type,
      namespace,
      name,
      fullPath: `${namespace}:${name}`,
      file: path,
      size,
    })
  }

  return resources
}

// ---------------------------------------------------------------------------
// Parse cross-file references from mcfunction files
// ---------------------------------------------------------------------------

function parseMcfunctionRefs(files: PackFileMap, resources: ResourceEntry[]): CrossRef[] {
  const refs: CrossRef[] = []
  const funcResources = resources.filter(r => r.type === 'function')

  for (const func of funcResources) {
    const content = files[func.file] ?? ''
    const lines = content.split('\n')

    for (let i = 0; i < lines.length; i++) {
      const trimmed = lines[i].trim()
      if (!trimmed || trimmed.startsWith('#')) continue

      const tokens = tokenizeCommand(trimmed.startsWith('/') ? trimmed : '/' + trimmed)
      if (tokens.length === 0) continue

      const root = tokens[0].value.replace(/^\//, '')

      // function / schedule function -> function reference
      if (root === 'function' || (root === 'schedule' && tokens.length > 1 && tokens[1].value === 'function')) {
        const funcIdx = root === 'function' ? 1 : 2
        if (tokens.length > funcIdx) {
          const ref = tokens[funcIdx].value
          if (ref.includes(':')) {
            refs.push({ from: func.file, to: ref, type: 'function_call', file: func.file, line: i + 1, code: trimmed })
          }
        }
      }

      // execute if/unless predicate
      if (root === 'execute') {
        for (let j = 1; j < tokens.length; j++) {
          if ((tokens[j].value === 'if' || tokens[j].value === 'unless') && j + 2 < tokens.length) {
            const subType = tokens[j + 1].value
            if (subType === 'predicate' && tokens.length > j + 2) {
              const predRef = tokens[j + 2].value
              if (predRef.includes(':')) {
                refs.push({ from: func.file, to: predRef, type: 'predicate_ref', file: func.file, line: i + 1, code: trimmed })
              }
            }
          }
        }
      }

      // scoreboard objectives add
      if (root === 'scoreboard' && tokens.length > 2 && tokens[1].value === 'objectives' && tokens[2].value === 'add' && tokens.length > 4) {
        refs.push({ from: func.file, to: `objective:${tokens[3].value}`, type: 'scoreboard_objective', file: func.file, line: i + 1, code: trimmed })
      }

      // loot command references
      if (root === 'loot' && tokens.length > 1) {
        const lootRef = tokens[1].value
        if (lootRef.includes(':')) {
          refs.push({ from: func.file, to: lootRef, type: 'loot_table_ref', file: func.file, line: i + 1, code: trimmed })
        }
      }

      // locate biome / locate structure
      if ((root === 'locate' || root === 'locatebiome') && tokens.length > 1) {
        const locRef = tokens[1].value
        if (locRef.includes(':')) {
          refs.push({ from: func.file, to: locRef, type: 'registry_ref', file: func.file, line: i + 1, code: trimmed })
        }
      }
    }
  }

  return refs
}

// ---------------------------------------------------------------------------
// Parse cross-file references from JSON files
// ---------------------------------------------------------------------------

function parseJsonRefs(files: PackFileMap, resources: ResourceEntry[]): CrossRef[] {
  const refs: CrossRef[] = []
  const jsonResources = resources.filter(r =>
    r.type !== 'function' && r.type !== 'texture' && !r.type.startsWith('tag/') && r.type !== 'model'
  )

  for (const res of jsonResources) {
    const content = files[res.file] ?? ''
    let data: any
    try { data = JSON.parse(content) } catch { continue }

    const findRefs = (obj: any) => {
      if (!obj || typeof obj !== 'object') return
      if (Array.isArray(obj)) {
        obj.forEach(findRefs)
        return
      }
      for (const [key, val] of Object.entries(obj)) {
        if (typeof val === 'string' && val.includes(':')) {
          if (key === 'function') refs.push({ from: res.file, to: val, type: 'function_call', file: res.file })
          if ((key === 'item' || key === 'result') && res.type === 'recipe') refs.push({ from: res.file, to: val, type: 'item_ref', file: res.file })
          if (key === 'loot_table') refs.push({ from: res.file, to: val, type: 'loot_table_ref', file: res.file })
          if (key === 'parent' && res.type !== 'model') refs.push({ from: res.file, to: val, type: 'model_ref', file: res.file })
        }
        if (key === 'values' && Array.isArray(val) && res.type.startsWith('tag/')) {
          for (const item of val) {
            if (typeof item === 'string' && item.includes(':')) {
              refs.push({ from: res.file, to: item, type: `tag_member/${res.type}`, file: res.file })
            }
          }
        }
        if (typeof val === 'object' && val !== null) findRefs(val)
      }
    }
    findRefs(data)
  }

  // Parse model references
  const modelResources = resources.filter(r => r.type === 'model')
  for (const res of modelResources) {
    const content = files[res.file] ?? ''
    let data: any
    try { data = JSON.parse(content) } catch { continue }
    if (data.parent && typeof data.parent === 'string') {
      refs.push({ from: res.file, to: data.parent, type: 'model_ref', file: res.file })
    }
    if (data.textures && typeof data.textures === 'object') {
      for (const [key, val] of Object.entries(data.textures)) {
        if (typeof val === 'string' && !val.startsWith('#')) {
          refs.push({ from: res.file, to: val, type: 'texture_ref', file: res.file })
        }
      }
    }
  }

  return refs
}

// ---------------------------------------------------------------------------
// Build dependency graph
// ---------------------------------------------------------------------------

function resolveRef(ref: string, resources: ResourceEntry[]): string | null {
  // Already has ns:path format
  if (ref.includes(':')) {
    const [ns, ...rest] = ref.split(':')
    const name = rest.join(':')
    // Try to find by type + ns + name
    for (const r of resources) {
      if (r.namespace === ns && r.name === name) return r.file
      if (r.namespace === ns && name.startsWith(r.name + '/')) return r.file
    }
    // Try tag resolution
    if (ref.startsWith('#')) {
      const tagRef = ref.slice(1)
      const [tagNs, ...tagRest] = tagRef.split(':')
      const tagPath = tagRest.join(':')
      for (const r of resources) {
        if (r.type.startsWith('tag/') && r.namespace === tagNs && r.name === tagPath) return r.file
      }
    }
  }
  return null
}

export function buildDependencyGraph(
  resources: ResourceEntry[],
  references: CrossRef[],
): {
  dependsOn: Map<string, Set<string>>
  dependedBy: Map<string, Set<string>>
} {
  const dependsOn = new Map<string, Set<string>>()
  const dependedBy = new Map<string, Set<string>>()
  const resByFile = new Map<string, ResourceEntry>()
  for (const r of resources) resByFile.set(r.file, r)

  for (const ref of references) {
    const toFile = resolveRef(ref.to, resources)
    if (!toFile || toFile === ref.from) continue
    if (!dependsOn.has(ref.from)) dependsOn.set(ref.from, new Set())
    dependsOn.get(ref.from)!.add(toFile)
    if (!dependedBy.has(toFile)) dependedBy.set(toFile, new Set())
    dependedBy.get(toFile)!.add(ref.from)
  }

  return { dependsOn, dependedBy }
}

// ---------------------------------------------------------------------------
// Find orphaned resources
// ---------------------------------------------------------------------------

export function findOrphans(resources: ResourceEntry[], dependedBy: Map<string, Set<string>>): ResourceEntry[] {
  const orphans: ResourceEntry[] = []
  for (const res of resources) {
    if (res.type.startsWith('tag/')) continue
    if (res.type === 'texture' || res.type === 'model' || res.type === 'blockstate') continue
    const inbound = dependedBy.get(res.file)
    if (!inbound || inbound.size === 0) {
      // Functions referenced from a tick or load tag are entry points:
      // both conditions required (type is tag AND file name contains tick/load)
      if (res.type === 'function') {
        const isEntryPoint = resources.some(r =>
          r.type.startsWith('tag/') && (r.file.includes('tick') || r.file.includes('load'))
        )
        if (isEntryPoint) continue
      }
      orphans.push(res)
    }
  }
  return orphans
}

// ---------------------------------------------------------------------------
// Detect circular dependencies
// ---------------------------------------------------------------------------

export function findCircularDeps(dependsOn: Map<string, Set<string>>): string[][] {
  const cycles: string[][] = []
  const visited = new Set<string>()
  const inStack = new Set<string>()

  function dfs(node: string, path: string[]) {
    if (inStack.has(node)) {
      const cycleStart = path.indexOf(node)
      if (cycleStart >= 0) cycles.push([...path.slice(cycleStart), node])
      return
    }
    if (visited.has(node)) return
    visited.add(node)
    inStack.add(node)
    path.push(node)
    const deps = dependsOn.get(node)
    if (deps) {
      for (const dep of deps) dfs(dep, path)
    }
    path.pop()
    inStack.delete(node)
  }

  for (const node of dependsOn.keys()) dfs(node, [])
  return cycles
}

// ---------------------------------------------------------------------------
// Compute metrics
// ---------------------------------------------------------------------------

export function computeMetrics(files: PackFileMap, resources: ResourceEntry[]): AnalysisMetrics {
  const funcResources = resources.filter(r => r.type === 'function')
  const jsonResources = resources.filter(r => r.type !== 'function' && r.type !== 'texture' && r.type !== 'model' && r.type !== 'blockstate')

  let totalCommands = 0
  let maxExecuteDepth = 0
  let largestFunction: { file: string; lines: number } | null = null
  const namespaceCounts: Record<string, number> = {}

  for (const func of funcResources) {
    const content = files[func.file] ?? ''
    const lines = content.split('\n')
    let cmdCount = 0
    let depth = 0

    for (const line of lines) {
      const trimmed = line.trim()
      if (!trimmed || trimmed.startsWith('#')) continue
      cmdCount++
      const tokens = tokenizeCommand(trimmed.startsWith('/') ? trimmed : '/' + trimmed)
      if (tokens.length > 0 && tokens[0].value === '/execute') {
        let d = 0
        for (let i = 1; i < tokens.length; i++) {
          if (tokens[i].value === 'run') d++
        }
        if (d > depth) depth = d
      }
    }

    totalCommands += cmdCount
    if (depth > maxExecuteDepth) maxExecuteDepth = depth
    if (!largestFunction || lines.length > largestFunction.lines) {
      largestFunction = { file: func.file, lines: lines.length }
    }
    namespaceCounts[func.namespace] = (namespaceCounts[func.namespace] ?? 0) + 1
  }

  for (const res of jsonResources) {
    namespaceCounts[res.namespace] = (namespaceCounts[res.namespace] ?? 0) + 1
  }

  return {
    totalFunctions: funcResources.length,
    totalJsonFiles: jsonResources.length,
    totalResources: resources.length,
    totalCommands,
    avgCommandsPerFunction: funcResources.length > 0 ? Math.round(totalCommands / funcResources.length) : 0,
    maxExecuteDepth,
    largestFunction,
    namespaceCounts,
  }
}

// ---------------------------------------------------------------------------
// Full analysis entry point
// ---------------------------------------------------------------------------

export async function analyzePack(files: PackFileMap): Promise<AnalysisResult> {
  const resources = buildResourceIndex(files)
  const mcfunctionRefs = parseMcfunctionRefs(files, resources)
  const jsonRefs = parseJsonRefs(files, resources)
  const allRefs = [...mcfunctionRefs, ...jsonRefs]
  const graph = buildDependencyGraph(resources, allRefs)
  const orphans = findOrphans(resources, graph.dependedBy)
  const circularDeps = findCircularDeps(graph.dependsOn)
  const brokenRefs = allRefs.filter(ref => resolveRef(ref.to, resources) === null)
  const metrics = computeMetrics(files, resources)

  return {
    resources,
    references: allRefs,
    orphans,
    brokenRefs,
    circularDeps,
    metrics,
  }
}
