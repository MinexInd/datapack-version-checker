import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { checkJsonFile } from '../src/json-check.js'

// ---------------------------------------------------------------------------
// Registry value + tag file validation (src/json-check.ts).
//
// checkJsonFile reads the file from disk and returns RegistryIssue[]:
//   - walkJson checks FIELD_TO_REGISTRY keys against the minecraft registries
//     (skipping #tag refs, @selectors, "this" and foreign namespaces)
//   - checkTagData structurally validates data/<ns>/tags/<type>/<id>.json
// ---------------------------------------------------------------------------

let tmpDir: string

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'jsoncheck-'))
})

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true })
})

const REGISTRIES: Record<string, string[]> = {
  item: ['stone', 'stick', 'diamond'],
  block: ['stone', 'dirt'],
  fluid: ['water', 'lava'],
  attribute: ['movement_speed', 'max_health'],
  recipe: ['stone_recipe'],
  'worldgen/structure': ['village', 'stronghold'],
  dimension: ['overworld', 'the_nether'],
  game_event: ['entity_damage'],
}

function check(data: unknown, relPath: string): ReturnType<typeof checkJsonFile> {
  const full = join(tmpDir, relPath)
  mkdirSync(join(full, '..'), { recursive: true })
  writeFileSync(full, JSON.stringify(data), 'utf-8')
  return checkJsonFile(full, REGISTRIES)
}

function issueTexts(issues: ReturnType<typeof checkJsonFile>): string[] {
  return issues.map(i => i.issue)
}

describe('tag file structural validation', () => {
  it('accepts a well-formed tag file (values: string[], replace: boolean)', () => {
    const issues = check({ replace: false, values: ['minecraft:stone', 'minecraft:dirt'] }, 'data/minecraft/tags/blocks/mineable.json')
    expect(issues).toHaveLength(0)
  })

  it('flags a non-object tag file', () => {
    const issues = check(['minecraft:stone'], 'data/minecraft/tags/blocks/bad.json')
    expect(issueTexts(issues)).toContain('Tag file must be an object with a "values" array')
  })

  it('flags a non-boolean replace field', () => {
    const issues = check({ replace: 'yes', values: [] }, 'data/minecraft/tags/blocks/bad.json')
    expect(issueTexts(issues)).toContain('Tag file field "replace" must be a boolean')
  })

  it('flags a missing values array', () => {
    const issues = check({ replace: false }, 'data/minecraft/tags/blocks/bad.json')
    expect(issueTexts(issues)).toContain('Tag file is missing the required "values" array')
  })

  it('flags a non-array values field', () => {
    const issues = check({ values: 'minecraft:stone' }, 'data/minecraft/tags/blocks/bad.json')
    expect(issueTexts(issues)).toContain('Tag file field "values" must be an array')
  })

  it('flags non-string tag entries', () => {
    const issues = check({ values: ['minecraft:stone', 42] }, 'data/minecraft/tags/blocks/bad.json')
    expect(issues.some(i => i.issue.includes('expected a string, got number'))).toBe(true)
  })

  it('flags malformed resource locations in tag entries', () => {
    const issues = check({ values: ['UPPERCASE', 'has space'] }, 'data/minecraft/tags/blocks/bad.json')
    expect(issues.some(i => i.issue.includes("'UPPERCASE' is not a valid resource location"))).toBe(true)
    expect(issues.some(i => i.issue.includes("'has space' is not a valid resource location"))).toBe(true)
  })

  it('accepts tag references, wildcards and namespaced path ids in entries', () => {
    const issues = check(
      { values: ['#minecraft:planks', '*', 'minecraft:chests/simple', 'minecraft:stone', 'mod:thing'] },
      'data/minecraft/tags/blocks/mixed.json',
    )
    expect(issues).toHaveLength(0)
  })

  it('rejects non-namespaced path-like ids (regex has no bare / support)', () => {
    const issues = check(
      { values: ['has_structure/ancient_city'] },
      'data/minecraft/tags/blocks/mixed.json',
    )
    expect(issues.some(i => i.issue.includes("'has_structure/ancient_city' is not a valid resource location"))).toBe(true)
  })

  it('does not structurally validate non-tag files', () => {
    const issues = check(['minecraft:stone'], 'data/minecraft/recipes/bad.json')
    expect(issueTexts(issues)).not.toContain('Tag file must be an object with a "values" array')
  })
})

describe('registry value checks', () => {
  it('flags an unknown minecraft item', () => {
    const issues = check({ item: 'minecraft:not_an_item' }, 'data/minecraft/recipes/x.json')
    expect(issues.some(i => i.issue.includes("Value 'minecraft:not_an_item' not found in registry minecraft:item"))).toBe(true)
  })

  it('accepts a known minecraft item', () => {
    const issues = check({ item: 'minecraft:stone' }, 'data/minecraft/recipes/x.json')
    expect(issues).toHaveLength(0)
  })

  it('does not flag foreign-namespace values (mod:thing)', () => {
    const issues = check({ item: 'mymod:custom_item' }, 'data/minecraft/recipes/x.json')
    expect(issues).toHaveLength(0)
  })

  it('does not exempt pack-namespace values from registry checks (bare-name lookup flags them)', () => {
    // isNonMinecraftRef lets the pack's own namespace through, so "mc:stone"
    // is compared against bare registry ids and reported as not found.
    const issues = check({ item: 'mc:stone' }, 'data/mc/recipes/x.json')
    expect(issues.some(i => i.issue.includes("Value 'mc:stone' not found in registry minecraft:item"))).toBe(true)
  })

  it('does not flag #tag references in registry fields', () => {
    const issues = check({ item: '#minecraft:planks' }, 'data/minecraft/recipes/x.json')
    expect(issues).toHaveLength(0)
  })

  it('does not flag entity selectors or the "this" keyword', () => {
    const issues = check(
      { entity: '@e', block: 'this' },
      'data/minecraft/advancements/x.json',
    )
    expect(issues).toHaveLength(0)
  })

  it('checks list-typed registry fields (advancement rewards.recipes)', () => {
    const issues = check(
      { rewards: { recipes: ['minecraft:stone_recipe', 'minecraft:missing_recipe'] } },
      'data/minecraft/advancements/x.json',
    )
    expect(issues.some(i => i.issue.includes('minecraft:missing_recipe') && i.issue.includes('$.rewards.recipes[1]'))).toBe(true)
    expect(issues.some(i => i.issue.includes('minecraft:stone_recipe'))).toBe(false)
  })
})

describe('registry whitelist additions', () => {
  it('verifies fluid values against the fluid registry', () => {
    const issues = check({ fluid: 'minecraft:water' }, 'data/minecraft/worldgen/configured_feature/x.json')
    expect(issues.some(i => i.issue.includes('minecraft:water'))).toBe(false)

    const bad = check({ fluid: 'minecraft:water_extra' }, 'data/minecraft/worldgen/configured_feature/x.json')
    expect(bad.some(i => i.issue.includes('minecraft:water_extra'))).toBe(true)
  })

  it('verifies attribute values against the attribute registry', () => {
    const issues = check({ attribute: 'minecraft:movement_speed' }, 'data/minecraft/enchantment/x.json')
    expect(issues.some(i => i.issue.includes('minecraft:movement_speed'))).toBe(false)

    const bad = check({ attribute: 'minecraft:movement_speed_plus' }, 'data/minecraft/enchantment/x.json')
    expect(bad.some(i => i.issue.includes('minecraft:movement_speed_plus'))).toBe(true)
  })

  it('maps structure fields to the worldgen/structure registry', () => {
    const issues = check({ structure: 'minecraft:village' }, 'data/minecraft/advancements/x.json')
    expect(issues.some(i => i.issue.includes('minecraft:village'))).toBe(false)

    // a value only present in the legacy "structure" registry must still flag
    const bad = check({ structure: 'minecraft:ancient_city' }, 'data/minecraft/advancements/x.json')
    expect(bad.some(i => i.issue.includes('minecraft:ancient_city') && i.issue.includes('minecraft:worldgen/structure'))).toBe(true)
  })

  it('maps dimension fields to the dimension registry', () => {
    const issues = check({ dimension: 'minecraft:overworld' }, 'data/minecraft/recipes/x.json')
    expect(issues.some(i => i.issue.includes('minecraft:overworld'))).toBe(false)

    const bad = check({ dimension: 'minecraft:the_end_plus' }, 'data/minecraft/recipes/x.json')
    expect(bad.some(i => i.issue.includes('minecraft:the_end_plus'))).toBe(true)
  })

  it('maps recipe references (recipe/recipes/recipe_id) to the recipe registry', () => {
    const issues = check({ recipe: 'minecraft:stone_recipe' }, 'data/minecraft/advancements/x.json')
    expect(issues.some(i => i.issue.includes('minecraft:stone_recipe'))).toBe(false)

    const bad = check({ recipe_id: 'minecraft:stone_recipe_missing' }, 'data/minecraft/advancements/x.json')
    expect(bad.some(i => i.issue.includes('minecraft:stone_recipe_missing'))).toBe(true)
  })
})
