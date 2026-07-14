import { readFileSync } from 'node:fs'
import type { RegistryIssue } from './types.js'

/** Maps common JSON field names to Spyglass registry keys */
const FIELD_TO_REGISTRY: Record<string, string> = {
  item: 'item',
  block: 'block',
  block_state: 'block',
  entity: 'entity_type',
  enchantment: 'enchantment',
  sound: 'sound_event',
  effect: 'mob_effect',
  potion: 'potion',
  biome: 'worldgen/biome',
  structure: 'structure',
  dimension: 'dimension_type',
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

function walkJson(
  obj: unknown,
  registries: Record<string, string[]>,
  issues: RegistryIssue[],
  file: string,
  path: string,
): void {
  if (obj === null || obj === undefined) return

  if (Array.isArray(obj)) {
    obj.forEach((item, i) => walkJson(item, registries, issues, file, `${path}[${i}]`))
    return
  }

  if (typeof obj === 'object') {
    for (const [key, value] of Object.entries(obj)) {
      // Check if this key maps to a known registry and value is a string
      const regKey = FIELD_TO_REGISTRY[key]
      if (regKey && typeof value === 'string' && registries[regKey]) {
        const stripped = stripNs(value)
        // Skip selector / predicate keywords (e.g. advancement `entity: "this"`
        // or `@s`, `@a`) — these are not registry entries.
        if (stripped === 'this' || stripped.startsWith('@')) continue
        if (!registries[regKey].includes(stripped)) {
          issues.push({
            file,
            registry: `minecraft:${regKey}`,
            entry: value,
            issue: `Value '${value}' not found in registry minecraft:${regKey} (path: ${path}.${key})`,
          })
        }
      }
      walkJson(value, registries, issues, file, `${path}.${key}`)
    }
    return
  }
}

export function checkJsonFile(
  file: string,
  registries: Record<string, string[]>,
): RegistryIssue[] {
  const issues: RegistryIssue[] = []
  try {
    const content = readFileSync(file, 'utf-8')
    const data = JSON.parse(content)
    walkJson(data, registries, issues, file, '$')
  } catch {
    // ignore parse errors (Spyglass handles those)
  }
  return issues
}
