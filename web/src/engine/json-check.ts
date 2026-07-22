import type { RegistryIssue, RegistryDeprecation } from './types'

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
    for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
      const regKey = FIELD_TO_REGISTRY[key]
      if (regKey && typeof value === 'string' && registries[regKey]) {
        const stripped = stripNs(value)
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

export function checkJsonData(
  data: unknown,
  file: string,
  registries: Record<string, string[]>,
): RegistryIssue[] {
  const issues: RegistryIssue[] = []
  try {
    walkJson(data, registries, issues, file, '$')
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
): void {
  if (obj === null || obj === undefined) return

  if (Array.isArray(obj)) {
    obj.forEach((item, i) => walkDeprecations(item, sourceRegs, targetRegs, issues, file, `${path}[${i}]`))
    return
  }

  if (typeof obj === 'object') {
    for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
      const regKey = FIELD_TO_REGISTRY[key]
      if (regKey && typeof value === 'string' && sourceRegs[regKey] && targetRegs[regKey]) {
        const stripped = stripNs(value)
        if (stripped === 'this' || stripped.startsWith('@')) continue
        if (sourceRegs[regKey].includes(stripped) && !targetRegs[regKey].includes(stripped)) {
          issues.push({
            file,
            registry: `minecraft:${regKey}`,
            entry: value,
            issue: `'${value}' was available in source but REMOVED from registry minecraft:${regKey} (path: ${path}.${key})`,
          })
        }
      }
      walkDeprecations(value, sourceRegs, targetRegs, issues, file, `${path}.${key}`)
    }
  }
}

export function checkDeprecatedRegistryEntries(
  data: unknown,
  file: string,
  sourceRegistries: Record<string, string[]>,
  targetRegistries: Record<string, string[]>,
): RegistryDeprecation[] {
  const issues: RegistryDeprecation[] = []
  try {
    walkDeprecations(data, sourceRegistries, targetRegistries, issues, file, '$')
  } catch {
  }
  return issues
}
