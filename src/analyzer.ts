import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, dirname } from 'node:path'
import { tokenizeCommand } from './tokenizer.js'

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



function walkDir(dir: string, cb: (fullPath: string) => void) {
  try {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry)
      try {
        if (statSync(full).isDirectory()) walkDir(full, cb)
        else cb(full)
      } catch { }
    }
  } catch { }
}



export function buildResourceIndex(packDir: string): ResourceEntry[] {
  const resources: ResourceEntry[] = []

  const dataDir = join(packDir, 'data')
  const assetsDir = join(packDir, 'assets')

  const addFile = (fullPath: string) => {
    const rel = relative(packDir, fullPath).replace(/\\/g, '/')
    const ext = fullPath.endsWith('.mcfunction') ? '.mcfunction' : fullPath.endsWith('.json') ? '.json' : null
    if (!ext) return

    const type = detectResourceType(rel)
    if (!type) return

    const { namespace, name } = extractNamespaceAndName(rel, type)
    let size = 0
    try { size = statSync(fullPath).size } catch { }

    resources.push({
      type,
      namespace,
      name,
      fullPath: `${namespace}:${name}`,
      file: rel,
      size,
    })
  }

  if (dataDir) walkDir(dataDir, addFile)
  if (assetsDir) walkDir(assetsDir, addFile)

  return resources
}



function parseMcfunctionRefs(
  packDir: string,
  resources: ResourceEntry[],
): CrossRef[] {
  const refs: CrossRef[] = []
  const resourceSet = new Set(resources.map(r => `${r.type}:${r.namespace}:${r.name}`))

  const funcFiles = resources.filter(r => r.type === 'function')
  for (const func of funcFiles) {
    const fullPath = join(packDir, func.file)
    let content: string
    try { content = readFileSync(fullPath, 'utf-8') } catch { continue }
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
            refs.push({
              from: func.file,
              to: ref,
              type: 'function_call',
              file: func.file,
              line: i + 1,
              code: trimmed,
            })
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
                refs.push({
                  from: func.file,
                  to: predRef,
                  type: 'predicate_ref',
                  file: func.file,
                  line: i + 1,
                  code: trimmed,
                })
              }
            }
          }
        }
      }

      // scoreboard objectives add <name> <criteria>
      if (root === 'scoreboard' && tokens.length > 2 && tokens[1].value === 'objectives') {
        if (tokens[2].value === 'add' && tokens.length > 4) {
          refs.push({
            from: func.file,
            to: `objective:${tokens[3].value}`,
            type: 'scoreboard_objective',
            file: func.file,
            line: i + 1,
            code: trimmed,
          })
        }
      }

      // loot command references
      if (root === 'loot' && tokens.length > 1) {
        const lootRef = tokens[1].value
        if (lootRef.includes(':')) {
          refs.push({
            from: func.file,
            to: lootRef,
            type: 'loot_table_ref',
            file: func.file,
            line: i + 1,
            code: trimmed,
          })
        }
      }

      // locate biome / locate structure
      if ((root === 'locate' || root === 'locatebiome') && tokens.length > 1) {
        const locRef = tokens[1].value
        if (locRef.includes(':')) {
          refs.push({
            from: func.file,
            to: locRef,
            type: 'registry_ref',
            file: func.file,
            line: i + 1,
            code: trimmed,
          })
        }
      }

      // data get/merge on entity @s — detect score references
      if (root === 'data' && tokens.length > 1 && (tokens[1].value === 'get' || tokens[1].value === 'merge')) {
        // Just noting data operations for metrics
      }
    }
  }

  return refs
}



function parseJsonRefs(
  packDir: string,
  resources: ResourceEntry[],
): CrossRef[] {
  const refs: CrossRef[] = []

  const jsonResources = resources.filter(r =>
    r.type !== 'function' && r.type !== 'texture' && !r.type.startsWith('tag/') && r.type !== 'model'
  )

  for (const res of jsonResources) {
    const fullPath = join(packDir, res.file)
    let content: string
    try { content = readFileSync(fullPath, 'utf-8') } catch { continue }
    let data: any
    try { data = JSON.parse(content) } catch { continue }

    const findRefs = (obj: any, path: string) => {
      if (!obj || typeof obj !== 'object') return
      if (Array.isArray(obj)) {
        obj.forEach((item, i) => findRefs(item, `${path}[${i}]`))
        return
      }

      for (const [key, val] of Object.entries(obj)) {
        if (typeof val === 'string' && val.includes(':')) {
          // function references in advancements
          if (key === 'function' && res.type === 'advancement') {
            refs.push({
              from: res.file,
              to: val,
              type: 'function_call',
              file: res.file,
            })
          }
          // reward function in advancements
          if (key === 'function' && typeof val === 'string') {
            refs.push({
              from: res.file,
              to: val,
              type: 'function_call',
              file: res.file,
            })
          }
          // item references in recipes
          if ((key === 'item' || key === 'result') && res.type === 'recipe') {
            refs.push({
              from: res.file,
              to: val,
              type: 'item_ref',
              file: res.file,
            })
          }
          // ingredient references
          if (key === 'ingredient' && res.type === 'recipe') {
            refs.push({
              from: res.file,
              to: val,
              type: 'item_ref',
              file: res.file,
            })
          }
          // loot table references
          if (key === 'loot_table') {
            refs.push({
              from: res.file,
              to: val,
              type: 'loot_table_ref',
              file: res.file,
            })
          }
          // function in loot table entries
          if (key === 'function' && res.type === 'loot_table') {
            refs.push({
              from: res.file,
              to: val,
              type: 'function_call',
              file: res.file,
            })
          }
          // predicates in loot conditions
          if (key === 'condition' && res.type === 'loot_table') {
            refs.push({
              from: res.file,
              to: val,
              type: 'predicate_ref',
              file: res.file,
            })
          }
          // model parent references
          if (key === 'parent' && res.type !== 'model') {
            refs.push({
              from: res.file,
              to: val,
              type: 'model_ref',
              file: res.file,
            })
          }
        }

        // Tag member references
        if (key === 'values' && Array.isArray(val) && res.type.startsWith('tag/')) {
          for (const item of val) {
            if (typeof item === 'string' && item.includes(':')) {
              refs.push({
                from: res.file,
                to: item,
                type: `tag_member/${res.type}`,
                file: res.file,
              })
            }
          }
        }

        if (typeof val === 'object' && val !== null) {
          findRefs(val, `${path}.${key}`)
        }
      }
    }

    findRefs(data, '$')
  }

  // Parse model references
  const modelResources = resources.filter(r => r.type === 'model')
  for (const res of modelResources) {
    const fullPath = join(packDir, res.file)
    let content: string
    try { content = readFileSync(fullPath, 'utf-8') } catch { continue }
    let data: any
    try { data = JSON.parse(content) } catch { continue }

    if (data.parent && typeof data.parent === 'string') {
      refs.push({
        from: res.file,
        to: data.parent,
        type: 'model_ref',
        file: res.file,
      })
    }

    if (data.textures && typeof data.textures === 'object') {
      for (const [key, val] of Object.entries(data.textures)) {
        if (typeof val === 'string' && !val.startsWith('#')) {
          refs.push({
            from: res.file,
            to: val,
            type: 'texture_ref',
            file: res.file,
          })
        }
      }
    }
  }

  return refs
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

  const resolveRef = (ref: string): string | null => {
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

  for (const ref of references) {
    const fromRes = resByFile.get(ref.from)
    const toFile = resolveRef(ref.to)
    if (!toFile || toFile === ref.from) continue

    if (!dependsOn.has(ref.from)) dependsOn.set(ref.from, new Set())
    dependsOn.get(ref.from)!.add(toFile)

    if (!dependedBy.has(toFile)) dependedBy.set(toFile, new Set())
    dependedBy.get(toFile)!.add(ref.from)
  }

  return { dependsOn, dependedBy }
}



export function findOrphans(
  resources: ResourceEntry[],
  dependedBy: Map<string, Set<string>>,
  packDir: string,
): ResourceEntry[] {
  const orphans: ResourceEntry[] = []

  // Read pack.mcmeta to check for load/tick tags
  const entryPoints = new Set<string>()
  try {
    const pmPath = join(packDir, 'pack.mcmeta')
    const pmContent = readFileSync(pmPath, 'utf-8')
    const pm = JSON.parse(pmContent)
    // Pack-level entry points are rare; mainly tags reference functions
  } catch { }

  for (const res of resources) {
    // Skip tags — they're organizational, not "callable"
    if (res.type.startsWith('tag/')) continue

    // Skip textures/models/blockstates — they're referenced by name, not always by file ref
    if (res.type === 'texture' || res.type === 'model' || res.type === 'blockstate') continue

    // A resource is orphaned if nothing depends on it
    const inbound = dependedBy.get(res.file)
    if (!inbound || inbound.size === 0) {
      // Exception: functions under tick/ or load/ tags are entry points
      if (res.type === 'function') {
        // Check if this function is referenced in any tag
        const isEntryPoint = resources.some(r =>
          r.type.startsWith('tag/') && r.file.includes('tick') || r.file.includes('load')
        )
        if (isEntryPoint) continue
      }
      orphans.push(res)
    }
  }

  return orphans
}



export function findCircularDeps(
  dependsOn: Map<string, Set<string>>,
): string[][] {
  const cycles: string[][] = []
  const visited = new Set<string>()
  const inStack = new Set<string>()

  function dfs(node: string, path: string[]) {
    if (inStack.has(node)) {
      const cycleStart = path.indexOf(node)
      if (cycleStart >= 0) {
        cycles.push([...path.slice(cycleStart), node])
      }
      return
    }
    if (visited.has(node)) return

    visited.add(node)
    inStack.add(node)
    path.push(node)

    const deps = dependsOn.get(node)
    if (deps) {
      for (const dep of deps) {
        dfs(dep, path)
      }
    }

    path.pop()
    inStack.delete(node)
  }

  for (const node of dependsOn.keys()) {
    dfs(node, [])
  }

  return cycles
}



export function computeMetrics(
  packDir: string,
  resources: ResourceEntry[],
): AnalysisMetrics {
  const funcResources = resources.filter(r => r.type === 'function')
  const jsonResources = resources.filter(r => r.type !== 'function' && r.type !== 'texture' && r.type !== 'model' && r.type !== 'blockstate')

  let totalCommands = 0
  let maxExecuteDepth = 0
  let largestFunction: { file: string; lines: number } | null = null
  const namespaceCounts: Record<string, number> = {}

  for (const func of funcResources) {
    const fullPath = join(packDir, func.file)
    let content: string
    try { content = readFileSync(fullPath, 'utf-8') } catch { continue }
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



export async function analyzePack(packDir: string): Promise<AnalysisResult> {
  const resources = buildResourceIndex(packDir)
  const mcfunctionRefs = parseMcfunctionRefs(packDir, resources)
  const jsonRefs = parseJsonRefs(packDir, resources)
  const allRefs = [...mcfunctionRefs, ...jsonRefs]
  const graph = buildDependencyGraph(resources, allRefs)
  const orphans = findOrphans(resources, graph.dependedBy, packDir)
  const circularDeps = findCircularDeps(graph.dependsOn)
  const brokenRefs = allRefs.filter(ref => {
    const resolved = [...resources].some(r => r.file === ref.to || r.fullPath === ref.to)
    return !resolved
  })
  const metrics = computeMetrics(packDir, resources)

  return {
    resources,
    references: allRefs,
    orphans,
    brokenRefs,
    circularDeps,
    metrics,
  }
}
