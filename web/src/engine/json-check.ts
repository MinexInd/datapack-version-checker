import type { RegistryIssue, RegistryDeprecation } from './types'
import { cmpVer } from './mcdoc-check'

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
  // Registries verified against https://api.spyglassmc.com/mcje/versions/<id>/registries.
  // ('trade' is deliberately absent: no such registry exists in any version.)
  particle_type: 'particle_type',
  stat_type: 'stat_type',
  block_entity_type: 'block_entity_type',
  chat_type: 'chat_type',
  dialog: 'dialog',
  'worldgen/material_rule': 'worldgen/material_rule',
  'worldgen/material_condition': 'worldgen/material_condition',
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
  // Skip selector / predicate keywords (e.g. advancement `entity: "this"`)
  if (value === 'this') return
  if (isNonMinecraftRef(value, packNs)) return

  const colon = value.indexOf(':')
  if (colon > 0) {
    const ns = value.slice(0, colon)
    if (ns !== 'minecraft') {
      // Non-minecraft namespace (must be packNs at this point).
      // Try the namespaced registry key first (e.g. "entries:dialog").
      const namespacedKey = `${ns}:${regKey}`
      if (registries[namespacedKey]) {
        const bare = value.slice(colon + 1)
        if (!registries[namespacedKey].includes(bare)) {
          issues.push({
            file,
            registry: namespacedKey,
            entry: value,
            issue: `Value '${value}' not found in registry ${namespacedKey} (path: ${path})`,
          })
        }
        return
      }
      // No namespaced registry data available — can't validate
      // datapack-defined entries, so skip silently.
      return
    }
  }

  // minecraft namespace or bare name — check against minecraft:{regKey}
  if (!registries[regKey]) return
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
  version?: string,
  parentKey?: string,
): void {
  if (obj === null || obj === undefined) return

  if (Array.isArray(obj)) {
    obj.forEach((item, i) => walkJson(item, registries, issues, file, `${path}[${i}]`, packNs, version, parentKey))
    return
  }

  if (typeof obj === 'object') {
    for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
      const childPath = `${path}.${key}`
      // 1.20.5+ recipes put the item id at result.id (renamed from result.item,
      // see the recipe json_field rule in rules.ts). Only check it when the
      // target version is known to use the new format, and only under a
      // result/output object so generic "id" keys elsewhere stay unchecked.
      if (key === 'id' && (parentKey === 'result' || parentKey === 'output') && version && cmpVer(version, '1.20.5') >= 0) {
        if (typeof value === 'string') {
          checkRegistryValue(value, 'item', registries, issues, file, childPath, packNs)
        }
      }
      const regKey = FIELD_TO_REGISTRY[key]
      if (regKey) {
        if (typeof value === 'string') {
          checkRegistryValue(value, regKey, registries, issues, file, childPath, packNs)
        } else if (Array.isArray(value) && value.every(v => typeof v === 'string')) {
          // list-typed registry refs (e.g. advancement rewards.recipes)
          value.forEach((v, i) =>
            checkRegistryValue(v, regKey, registries, issues, file, `${childPath}[${i}]`, packNs),
          )
        }
      }
      walkJson(value, registries, issues, file, childPath, packNs, version, key)
    }
    return
  }
}

export function checkJsonData(
  data: unknown,
  file: string,
  registries: Record<string, string[]>,
  version?: string,
): RegistryIssue[] {
  const issues: RegistryIssue[] = []
  try {
    walkJson(data, registries, issues, file, '$', packNamespace(file), version)
    checkTagData(data, file, issues, registries, packNamespace(file))
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

/**
 * Maps the tag directory kind (segment after tags/) to the Spyglass registry
 * key whose entries a tag's values must resolve against. Both the modern
 * singular names (1.21+) and the legacy plural names (1.13-1.20.x) are
 * covered; keys were verified against
 * https://api.spyglassmc.com/mcje/versions/<id>/registries. Kinds with no
 * registry — e.g. `function`, `trade` — are deliberately absent: their tags
 * are not registry-backed and must not be checked (nor invented).
 */
const TAG_KIND_TO_REGISTRY: Record<string, string> = {
  // modern singular names (1.21+)
  block: 'block',
  item: 'item',
  entity_type: 'entity_type',
  fluid: 'fluid',
  game_event: 'game_event',
  damage_type: 'damage_type',
  enchantment: 'enchantment',
  painting_variant: 'painting_variant',
  wolf_variant: 'wolf_variant',
  instrument: 'instrument',
  jukebox_song: 'jukebox_song',
  trim_pattern: 'trim_pattern',
  trim_material: 'trim_material',
  banner_pattern: 'banner_pattern',
  cat_variant: 'cat_variant',
  frog_variant: 'frog_variant',
  pig_variant: 'pig_variant',
  cow_variant: 'cow_variant',
  chicken_variant: 'chicken_variant',
  decorated_pot_pattern: 'decorated_pot_pattern',
  particle_type: 'particle_type',
  attribute: 'attribute',
  chat_type: 'chat_type',
  dialog: 'dialog',
  point_of_interest_type: 'point_of_interest_type',
  potion: 'potion',
  villager_trade: 'villager_trade',
  timeline: 'timeline',
  biome: 'worldgen/biome',
  // legacy plural names (1.13-1.20.x)
  blocks: 'block',
  items: 'item',
  entity_types: 'entity_type',
  fluids: 'fluid',
  game_events: 'game_event',
  damage_types: 'damage_type',
  enchantments: 'enchantment',
  painting_variants: 'painting_variant',
  wolf_variants: 'wolf_variant',
  instruments: 'instrument',
  jukebox_songs: 'jukebox_song',
  trim_patterns: 'trim_pattern',
  trim_materials: 'trim_material',
  banner_patterns: 'banner_pattern',
  cat_variants: 'cat_variant',
  frog_variants: 'frog_variant',
  pig_variants: 'pig_variant',
  cow_variants: 'cow_variant',
  chicken_variants: 'chicken_variant',
  decorated_pot_patterns: 'decorated_pot_pattern',
  particle_types: 'particle_type',
  attributes: 'attribute',
  chat_types: 'chat_type',
  point_of_interest_types: 'point_of_interest_type',
  potions: 'potion',
  villager_trades: 'villager_trade',
  biomes: 'worldgen/biome',
  // two-level worldgen kinds (tags/worldgen/<sub>/...)
  'worldgen/biome': 'worldgen/biome',
  'worldgen/structure': 'worldgen/structure',
  'worldgen/structure_set': 'worldgen/structure_set',
  'worldgen/placed_feature': 'worldgen/placed_feature',
  'worldgen/configured_feature': 'worldgen/configured_feature',
  'worldgen/template_pool': 'worldgen/template_pool',
  'worldgen/noise_settings': 'worldgen/noise_settings',
  'worldgen/density_function': 'worldgen/density_function',
  'worldgen/world_preset': 'worldgen/world_preset',
  'worldgen/flat_level_generator_preset': 'worldgen/flat_level_generator_preset',
}

/** Tag kind of a tag file path: the segment after tags/ (two segments when it
 *  starts with worldgen/). Returns null for non-tag paths. */
function tagKindFromPath(file: string): string | null {
  const segs = file.replace(/\\/g, '/').split('/')
  const idx = segs.indexOf('tags')
  if (idx < 0 || idx + 1 >= segs.length) return null
  const kind = segs[idx + 1]
  if (kind === 'worldgen' && idx + 2 < segs.length) return `worldgen/${segs[idx + 2]}`
  return kind
}

function checkTagData(
  data: unknown,
  file: string,
  issues: RegistryIssue[],
  registries: Record<string, string[]>,
  packNs: string | null,
): void {
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
  // The registry this tag kind's values must resolve against; unknown kinds
  // (functions, trade, ...) are silently skipped.
  const kind = tagKindFromPath(file)
  const regKey = kind ? TAG_KIND_TO_REGISTRY[kind] : undefined
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
    } else if (regKey && entry !== '*' && !entry.startsWith('#') && !entry.includes('/') && !isNonMinecraftRef(entry, packNs)) {
      // minecraft:thing and bare thing entries must exist in the registry;
      // path-like ids (chests/simple) are only structurally validated.
      checkRegistryValue(entry, regKey, registries, issues, file, path, packNs)
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
