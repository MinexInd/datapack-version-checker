import type { RegistryIssue, RegistryDeprecation } from './types'

/** Maps common JSON field names to Spyglass registry keys.
 *
 *  Only fields whose registry semantics are unambiguous are listed here.
 *  Field names are backed by mcdoc `#[id=...]` annotations where available
 *  (e.g. `recipe_id` in advancement triggers). Generic names like `id`, `type`
 *  or `parent` are deliberately absent: they map to different registries
 *  depending on context and would produce false positives.
 */
const FIELD_TO_REGISTRY: Record<string, string> = {
  item: 'item',
  block: 'block',
  block_state: 'block',
  entity: 'entity_type',
  enchantment: 'enchantment',
  enchantments: 'enchantment',
  sound: 'sound_event',
  effect: 'mob_effect',
  to_apply: 'mob_effect',
  potion: 'potion',
  fluid: 'fluid',
  fluids: 'fluid',
  biome: 'worldgen/biome',
  biomes: 'worldgen/biome',
  structure: 'worldgen/structure',
  structures: 'worldgen/structure',
  dimension: 'dimension',
  recipe: 'recipe',
  recipes: 'recipe',
  recipe_id: 'recipe',
  loot: 'loot_table',
  loot_table: 'loot_table',
  attribute: 'attribute',
  trim_material: 'trim_material',
  trim_pattern: 'trim_pattern',
  banner_pattern: 'banner_pattern',
  instrument: 'instrument',
  painting_variant: 'painting_variant',
  cat_variant: 'cat_variant',
  frog_variant: 'frog_variant',
  wolf_variant: 'wolf_variant',
  pig_variant: 'pig_variant',
  damage_type: 'damage_type',
  jukebox_song: 'jukebox_song',
  activity: 'activity',
  memory_module: 'memory_module_type',
  sensor: 'sensor_type',
  schedule: 'schedule',
  game_event: 'game_event',
  villager_type: 'villager_type',
  profession: 'villager_profession',
  poi: 'point_of_interest_type',
}

function stripNs(value: string): string {
  return value.startsWith('minecraft:') ? value.slice('minecraft:'.length) : value
}

/** Namespace of the pack owning `file` (segment after data/ or assets/), if any. */
function packNamespace(file: string): string | null {
  const segs = file.replace(/\\/g, '/').split('/')
  for (let i = 0; i < segs.length - 1; i++) {
    if (segs[i] === 'data' || segs[i] === 'assets') return segs[i + 1] || null
  }
  return null
}

/**
 * True when the value is a tag reference or belongs to a foreign namespace,
 * i.e. something only the game (or another mod) can resolve. Such values must
 * not be reported as "not found" against minecraft's registries.
 */
function isNonMinecraftRef(value: string, packNs: string | null): boolean {
  if (value.startsWith('#')) return true // tag reference, e.g. #minecraft:planks
  if (value.startsWith('@')) return true // entity selector
  const colon = value.indexOf(':')
  if (colon > 0) {
    const ns = value.slice(0, colon)
    if (ns !== 'minecraft' && ns !== packNs) return true
  }
  return false
}

function checkRegistryValue(
  value: string,
  regKey: string,
  registries: Record<string, string[]>,
  issues: RegistryIssue[],
  file: string,
  path: string,
  packNs: string | null,
): void {
  if (!registries[regKey]) return
  // Skip selector / predicate keywords (e.g. advancement `entity: "this"`)
  if (value === 'this') return
  if (isNonMinecraftRef(value, packNs)) return
  const stripped = stripNs(value)
  if (!registries[regKey].includes(stripped)) {
    issues.push({
      file,
      registry: `minecraft:${regKey}`,
      entry: value,
      issue: `Value '${value}' not found in registry minecraft:${regKey} (path: ${path})`,
    })
  }
}

function walkJson(
  obj: unknown,
  registries: Record<string, string[]>,
  issues: RegistryIssue[],
  file: string,
  path: string,
  packNs: string | null = null,
): void {
  if (obj === null || obj === undefined) return

  if (Array.isArray(obj)) {
    obj.forEach((item, i) => walkJson(item, registries, issues, file, `${path}[${i}]`, packNs))
    return
  }

  if (typeof obj === 'object') {
    for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
      const regKey = FIELD_TO_REGISTRY[key]
      if (regKey) {
        const childPath = `${path}.${key}`
        if (typeof value === 'string') {
          checkRegistryValue(value, regKey, registries, issues, file, childPath, packNs)
        } else if (Array.isArray(value) && value.every(v => typeof v === 'string')) {
          // list-typed registry refs (e.g. advancement rewards.recipes)
          value.forEach((v, i) =>
            checkRegistryValue(v, regKey, registries, issues, file, `${childPath}[${i}]`, packNs),
          )
        }
      }
      walkJson(value, registries, issues, file, `${path}.${key}`, packNs)
    }
    return
  }
}

export function checkJsonData(
  data: unknown,
  file: string,
  registries: Record<string, string[]>,
): RegistryIssue[] {
  const issues: RegistryIssue[] = []
  try {
    walkJson(data, registries, issues, file, '$', packNamespace(file))
    checkTagData(data, file, issues)
  } catch {
  }
  return issues
}

function walkDeprecations(
  obj: unknown,
  sourceRegs: Record<string, string[]>,
  targetRegs: Record<string, string[]>,
  issues: RegistryDeprecation[],
  file: string,
  path: string,
  packNs: string | null = null,
): void {
  if (obj === null || obj === undefined) return

  if (Array.isArray(obj)) {
    obj.forEach((item, i) =>
      walkDeprecations(item, sourceRegs, targetRegs, issues, file, `${path}[${i}]`, packNs),
    )
    return
  }

  if (typeof obj === 'object') {
    for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
      const regKey = FIELD_TO_REGISTRY[key]
      if (regKey && sourceRegs[regKey] && targetRegs[regKey]) {
        const childPath = `${path}.${key}`
        const check = (v: string, vPath: string) => {
          if (v === 'this' || isNonMinecraftRef(v, packNs)) return
          const stripped = stripNs(v)
          if (sourceRegs[regKey].includes(stripped) && !targetRegs[regKey].includes(stripped)) {
            issues.push({
              file,
              registry: `minecraft:${regKey}`,
              entry: v,
              issue: `'${v}' was available in source but REMOVED from registry minecraft:${regKey} (path: ${vPath})`,
            })
          }
        }
        if (typeof value === 'string') {
          check(value, childPath)
        } else if (Array.isArray(value) && value.every(v => typeof v === 'string')) {
          value.forEach((v, i) => check(v, `${childPath}[${i}]`))
        }
      }
      walkDeprecations(value, sourceRegs, targetRegs, issues, file, `${path}.${key}`, packNs)
    }
  }
}

// ---------------------------------------------------------------------------
// Tag file validation (data/<ns>/tags/<type>/<id>.json)
// ---------------------------------------------------------------------------

function isTagPath(file: string): boolean {
  return file.replace(/\\/g, '/').split('/').includes('tags')
}

/** Loose resource-location shape; allows tag refs (#x), namespaced and plain
 *  ids, path-like ids (e.g. has_structure/ancient_city) and the `*` wildcard
 *  used by block tags. */
const TAG_ENTRY_RE = /^(\*|#?[a-z0-9_.-]+(:[a-z0-9_./-]+)?)$/

function checkTagData(data: unknown, file: string, issues: RegistryIssue[]): void {
  if (!isTagPath(file)) return
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    issues.push({
      file,
      registry: 'minecraft:tags',
      entry: '',
      issue: 'Tag file must be an object with a "values" array',
    })
    return
  }
  const obj = data as Record<string, unknown>
  if ('replace' in obj && typeof obj.replace !== 'boolean') {
    issues.push({
      file,
      registry: 'minecraft:tags',
      entry: String(obj.replace),
      issue: 'Tag file field "replace" must be a boolean',
    })
  }
  if (!('values' in obj)) {
    issues.push({
      file,
      registry: 'minecraft:tags',
      entry: '',
      issue: 'Tag file is missing the required "values" array',
    })
    return
  }
  if (!Array.isArray(obj.values)) {
    issues.push({
      file,
      registry: 'minecraft:tags',
      entry: '',
      issue: 'Tag file field "values" must be an array',
    })
    return
  }
  obj.values.forEach((entry, i) => {
    const path = `$.values[${i}]`
    if (typeof entry !== 'string') {
      issues.push({
        file,
        registry: 'minecraft:tags',
        entry: String(entry),
        issue: `Invalid tag entry at ${path}: expected a string, got ${Array.isArray(entry) ? 'array' : typeof entry}`,
      })
    } else if (!TAG_ENTRY_RE.test(entry)) {
      issues.push({
        file,
        registry: 'minecraft:tags',
        entry,
        issue: `Invalid tag entry at ${path}: '${entry}' is not a valid resource location`,
      })
    }
  })
}

export function checkDeprecatedRegistryEntries(
  data: unknown,
  file: string,
  sourceRegistries: Record<string, string[]>,
  targetRegistries: Record<string, string[]>,
): RegistryDeprecation[] {
  const issues: RegistryDeprecation[] = []
  try {
    walkDeprecations(data, sourceRegistries, targetRegistries, issues, file, '$', packNamespace(file))
  } catch {
  }
  return issues
}
