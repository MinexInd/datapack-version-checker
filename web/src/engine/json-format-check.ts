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
  function walk(obj: any, path: string): void {
    if (!obj || typeof obj !== 'object') return
    if (Array.isArray(obj)) {
      obj.forEach((item, i) => walk(item, `${path}[${i}]`))
      return
    }
    if ('item' in obj && !('id' in obj) && typeof (obj as any).item === 'string' && cmpVer(ver, '1.20.5') >= 0) {
      const keys = Object.keys(obj)
      const looksLikeRecipeResult = keys.length <= 4 && (
        keys.includes('count') || keys.includes('data') || keys.includes('components') || keys.length === 1
      )
      if (looksLikeRecipeResult) {
        issues.push({
          file: rel,
          issue: `Recipe result key 'item' renamed to 'id' in 1.20.5 (path: ${path}.item)`,
        })
      }
    }
    if ('id' in obj && !('item' in obj) && typeof (obj as any).id === 'string' && cmpVer(ver, '1.20.5') < 0) {
      const keys = Object.keys(obj)
      const looksLikeRecipeResult = keys.length <= 4 && (
        keys.includes('count') || keys.includes('data') || keys.includes('components') || keys.length === 1
      )
      if (looksLikeRecipeResult) {
        issues.push({
          file: rel,
          issue: `Recipe result key 'id' not available before 1.20.5 — use 'item' instead (path: ${path}.id)`,
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

export function checkJsonFormatSemantics(
  data: any,
  rel: string,
  versionName: string,
): StructuralIssue[] {
  const issues: StructuralIssue[] = []

  if (isPredicateFile(rel)) {
    issues.push(...checkPredicateRenames(data, rel, versionName))
    issues.push(...checkDamagePredicateFlags(data, rel, versionName))
  }
  if (isBiomeFile(rel)) {
    issues.push(...checkBiomePrecipitation(data, rel, versionName))
  }
  if (isLootTableFile(rel)) {
    issues.push(...checkLootFunctions(data, rel, versionName))
  }
  if (isRecipeFile(rel)) {
    issues.push(...checkRecipeResult(data, rel, versionName))
  }

  return issues
}
