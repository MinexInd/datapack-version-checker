import { cmpVer } from './mcdoc-check'
import type { StructuralIssue } from './types'

const PREDICATE_RENAMES: [string, string, string][] = [
  ['alternative', 'any_of', '1.20'],
  ['requirements', 'all_of', '1.20'],
]

const REMOVED_DAMAGE_FLAGS = [
  'bypasses_armor',
  'bypasses_invulnerability',
  'bypasses_magic',
  'is_fire',
  'is_explosion',
  'is_magic',
  'is_projectile',
  'is_lightning',
]

const LOOT_FUNCTIONS_NEEDING_TYPE: [string, string][] = [
  ['set_damage', '1.17'],
  ['set_contents', '1.18'],
  ['set_loot_table', '1.18'],
]

function isPredicateFile(rel: string): boolean {
  return /(?:^|\/)predicates?\//.test(rel)
}

function isBiomeFile(rel: string): boolean {
  return /(?:^|\/)worldgen\/biome\//.test(rel)
}

function isLootTableFile(rel: string): boolean {
  return /(?:^|\/)loot_tables?\//.test(rel)
}

function isRecipeFile(rel: string): boolean {
  return /(?:^|\/)recipes?\//.test(rel)
}

function isAdvancementFile(rel: string): boolean {
  return /(?:^|\/)advancements?\//.test(rel)
}

const NUMBER_PROVIDER_TYPES = ['minecraft:uniform', 'minecraft:binomial']

const COLLAPSED_TRIGGERS = [
  'minecraft:placed_block',
  'minecraft:item_used_on_block',
  'minecraft:allay_drop_item_on_block',
]

function checkPredicateRenames(data: any, rel: string, ver: string): StructuralIssue[] {
  const issues: StructuralIssue[] = []
  function walk(obj: any, path: string): void {
    if (!obj || typeof obj !== 'object') return
    if (Array.isArray(obj)) {
      obj.forEach((item, i) => walk(item, `${path}[${i}]`))
      return
    }
    for (const [key, val] of Object.entries(obj)) {
      for (const [oldName, newName, since] of PREDICATE_RENAMES) {
        if (key === oldName && cmpVer(ver, since) >= 0) {
          issues.push({
            file: rel,
            issue: `Predicate field '${oldName}' renamed to '${newName}' in ${since} (path: ${path}.${key})`,
          })
        }
        if (key === newName && cmpVer(ver, since) < 0) {
          issues.push({
            file: rel,
            issue: `Predicate field '${newName}' not available before ${since} — use '${oldName}' instead (path: ${path}.${key})`,
          })
        }
      }
      walk(val, `${path}.${key}`)
    }
  }
  walk(data, '$')
  return issues
}

function checkDamagePredicateFlags(data: any, rel: string, ver: string): StructuralIssue[] {
  if (cmpVer(ver, '1.19.4') < 0) return []
  const issues: StructuralIssue[] = []
  function walk(obj: any, path: string): void {
    if (!obj || typeof obj !== 'object') return
    if (Array.isArray(obj)) {
      obj.forEach((item, i) => walk(item, `${path}[${i}]`))
      return
    }
    for (const key of REMOVED_DAMAGE_FLAGS) {
      if (key in obj) {
        issues.push({
          file: rel,
          issue: `Damage predicate flag '${key}' removed in 1.19.4 — use damage_type tags instead (path: ${path}.${key})`,
        })
      }
    }
    for (const [k, v] of Object.entries(obj)) {
      walk(v, `${path}.${k}`)
    }
  }
  walk(data, '$')
  return issues
}

function checkBiomePrecipitation(data: any, rel: string, ver: string): StructuralIssue[] {
  const issues: StructuralIssue[] = []
  function walk(obj: any, path: string): void {
    if (!obj || typeof obj !== 'object') return
    if (Array.isArray(obj)) {
      obj.forEach((item, i) => walk(item, `${path}[${i}]`))
      return
    }
    if ('precipitation' in obj && typeof (obj as any).precipitation === 'string' && cmpVer(ver, '1.19.4') >= 0) {
      issues.push({
        file: rel,
        issue: `Biome field 'precipitation' (string) replaced by 'has_precipitation' (boolean) in 1.19.4 (path: ${path}.precipitation)`,
      })
    }
    if ('has_precipitation' in obj && typeof (obj as any).has_precipitation === 'boolean' && cmpVer(ver, '1.19.4') < 0) {
      issues.push({
        file: rel,
        issue: `Biome field 'has_precipitation' not available before 1.19.4 — use 'precipitation' string instead (path: ${path}.has_precipitation)`,
      })
    }
    for (const [k, v] of Object.entries(obj)) {
      walk(v, `${path}.${k}`)
    }
  }
  walk(data, '$')
  return issues
}

function checkLootFunctions(data: any, rel: string, ver: string): StructuralIssue[] {
  const issues: StructuralIssue[] = []
  function walk(obj: any, path: string): void {
    if (!obj || typeof obj !== 'object') return
    if (Array.isArray(obj)) {
      obj.forEach((item, i) => walk(item, `${path}[${i}]`))
      return
    }
    if (typeof obj === 'object' && typeof obj.function === 'string') {
      const fn = obj.function.replace(/^minecraft:/, '')
      for (const [fnName, minVer] of LOOT_FUNCTIONS_NEEDING_TYPE) {
        if (fn === fnName && cmpVer(ver, minVer) >= 0 && !('type' in obj)) {
          issues.push({
            file: rel,
            issue: `Loot function '${fn}' requires a 'type' field since ${minVer} (path: ${path}.function)`,
          })
        }
      }
    }
    for (const [k, v] of Object.entries(obj)) {
      walk(v, `${path}.${k}`)
    }
  }
  walk(data, '$')
  return issues
}

function checkRecipeResult(data: any, rel: string, ver: string): StructuralIssue[] {
  const issues: StructuralIssue[] = []
  function walk(obj: any, path: string, parentKey?: string): void {
    if (!obj || typeof obj !== 'object') return
    if (Array.isArray(obj)) {
      obj.forEach((item, i) => walk(item, `${path}[${i}]`, parentKey))
      return
    }
    const isResultObject = parentKey === 'result' || parentKey === 'output'
    if (isResultObject) {
      if ('item' in obj && !('id' in obj) && typeof (obj as any).item === 'string' && cmpVer(ver, '1.20.5') >= 0) {
        issues.push({
          file: rel,
          issue: `Recipe result key 'item' renamed to 'id' in 1.20.5 (path: ${path}.item)`,
        })
      }
      if ('id' in obj && !('item' in obj) && typeof (obj as any).id === 'string' && cmpVer(ver, '1.20.5') < 0) {
        issues.push({
          file: rel,
          issue: `Recipe result key 'id' not available before 1.20.5 — use 'item' instead (path: ${path}.id)`,
        })
      }
    }
    for (const [k, v] of Object.entries(obj)) {
      walk(v, `${path}.${k}`, k)
    }
  }
  walk(data, '$')
  return issues
}

function checkNumberProviderValue(data: any, rel: string, ver: string): StructuralIssue[] {
  const issues: StructuralIssue[] = []
  function walk(obj: any, path: string): void {
    if (!obj || typeof obj !== 'object') return
    if (Array.isArray(obj)) {
      obj.forEach((item, i) => walk(item, `${path}[${i}]`))
      return
    }
    if (typeof obj.type === 'string' && NUMBER_PROVIDER_TYPES.includes(obj.type)) {
      if (cmpVer(ver, '1.20.5') >= 0 && obj.value && typeof obj.value === 'object') {
        issues.push({
          file: rel,
          issue: `Number provider '${obj.type}' no longer uses 'value' wrapper in 1.20.5 — move fields to the top level (path: ${path}.value)`,
        })
      }
      if (cmpVer(ver, '1.20.5') < 0 && !obj.value && (obj.min_inclusive !== undefined || obj.n !== undefined)) {
        issues.push({
          file: rel,
          issue: `Number provider '${obj.type}' requires a 'value' wrapper object before 1.20.5 (path: ${path})`,
        })
      }
    }
    for (const [k, v] of Object.entries(obj)) {
      walk(v, `${path}.${k}`)
    }
  }
  walk(data, '$')
  return issues
}

function checkAdvancementTriggers(data: any, rel: string, ver: string): StructuralIssue[] {
  const issues: StructuralIssue[] = []
  if (!data || typeof data !== 'object') return issues
  if (typeof data.trigger === 'string') {
    if (COLLAPSED_TRIGGERS.includes(data.trigger) && cmpVer(ver, '1.20') >= 0) {
      issues.push({
        file: rel,
        issue: `Advancement trigger '${data.trigger}' was merged into 'minecraft:location' in 1.20`,
      })
    }
    if (data.trigger === 'minecraft:location' && cmpVer(ver, '1.20') < 0) {
      issues.push({
        file: rel,
        issue: `Advancement trigger 'minecraft:location' not available before 1.20 — use the specific trigger instead`,
      })
    }
  }
  return issues
}

export function checkJsonFormatSemantics(
  data: any,
  rel: string,
  versionName: string,
): StructuralIssue[] {
  const out: StructuralIssue[] = []

  if (isPredicateFile(rel)) {
    for (const iss of checkPredicateRenames(data, rel, versionName)) out.push({ ...iss, source: 'format' })
    for (const iss of checkDamagePredicateFlags(data, rel, versionName)) out.push({ ...iss, source: 'format' })
  }
  if (isBiomeFile(rel)) {
    for (const iss of checkBiomePrecipitation(data, rel, versionName)) out.push({ ...iss, source: 'format' })
  }
  if (isLootTableFile(rel)) {
    for (const iss of checkLootFunctions(data, rel, versionName)) out.push({ ...iss, source: 'format' })
  }
  if (isRecipeFile(rel)) {
    for (const iss of checkRecipeResult(data, rel, versionName)) out.push({ ...iss, source: 'format' })
  }
  for (const iss of checkNumberProviderValue(data, rel, versionName)) out.push({ ...iss, source: 'format' })
  if (isAdvancementFile(rel)) {
    for (const iss of checkAdvancementTriggers(data, rel, versionName)) out.push({ ...iss, source: 'format' })
  }

  return out
}
