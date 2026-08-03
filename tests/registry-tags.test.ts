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
  // whitelist additions (verified against api.spyglassmc.com/mcje/versions)
  particle_type: ['block', 'ash'],
  stat_type: ['custom'],
  block_entity_type: ['chest'],
  chat_type: ['say_command'],
  'worldgen/material_rule': ['block'],
  'worldgen/material_condition': ['biome'],
  entity_type: ['cow', 'player'],
  'worldgen/biome': ['plains', 'the_end'],
}

function check(data: unknown, relPath: string, version?: string): ReturnType<typeof checkJsonFile> {
  const full = join(tmpDir, relPath)
  mkdirSync(join(full, '..'), { recursive: true })
  writeFileSync(full, JSON.stringify(data), 'utf-8')
  return checkJsonFile(full, REGISTRIES, version)
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

  it('skips pack-namespace values when no namespaced registry data is available', () => {
    // Pack-namespace values (e.g. mc:stone in namespace mc) are now resolved
    // against the pack's own registry (mc:item) first. If that registry data
    // doesn't exist (vanilla only), validation is skipped — the checker can't
    // verify pack-defined entries.
    const issues = check({ item: 'mc:stone' }, 'data/mc/recipes/x.json')
    expect(issues).toHaveLength(0)
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

  it('verifies particle_type values against the particle_type registry', () => {
    const ok = check({ particle_type: 'minecraft:ash' }, 'data/minecraft/worldgen/configured_feature/x.json')
    expect(ok.some(i => i.issue.includes('minecraft:ash'))).toBe(false)

    const bad = check({ particle_type: 'minecraft:not_a_particle' }, 'data/minecraft/worldgen/configured_feature/x.json')
    expect(bad.some(i => i.issue.includes('minecraft:not_a_particle') && i.issue.includes('minecraft:particle_type'))).toBe(true)
  })

  it('verifies stat_type values against the stat_type registry', () => {
    const ok = check({ stat_type: 'minecraft:custom' }, 'data/minecraft/advancements/x.json')
    expect(ok.some(i => i.issue.includes('minecraft:custom'))).toBe(false)

    const bad = check({ stat_type: 'minecraft:not_a_stat' }, 'data/minecraft/advancements/x.json')
    expect(bad.some(i => i.issue.includes('minecraft:not_a_stat') && i.issue.includes('minecraft:stat_type'))).toBe(true)
  })

  it('verifies block_entity_type values against the block_entity_type registry', () => {
    const ok = check({ block_entity_type: 'minecraft:chest' }, 'data/minecraft/block_definition/x.json')
    expect(ok.some(i => i.issue.includes('minecraft:chest'))).toBe(false)

    const bad = check({ block_entity_type: 'minecraft:not_a_block_entity' }, 'data/minecraft/block_definition/x.json')
    expect(bad.some(i => i.issue.includes('minecraft:not_a_block_entity') && i.issue.includes('minecraft:block_entity_type'))).toBe(true)
  })

  it('verifies chat_type values against the chat_type registry', () => {
    const ok = check({ chat_type: 'minecraft:say_command' }, 'data/minecraft/dimension_type/x.json')
    expect(ok.some(i => i.issue.includes('minecraft:say_command'))).toBe(false)

    const bad = check({ chat_type: 'minecraft:not_a_chat_type' }, 'data/minecraft/dimension_type/x.json')
    expect(bad.some(i => i.issue.includes('minecraft:not_a_chat_type') && i.issue.includes('minecraft:chat_type'))).toBe(true)
  })

  it('verifies worldgen/material_rule values against the worldgen/material_rule registry', () => {
    const ok = check({ 'worldgen/material_rule': 'minecraft:block' }, 'data/minecraft/worldgen/noise_settings/x.json')
    expect(ok.some(i => i.issue.includes('minecraft:block'))).toBe(false)

    const bad = check({ 'worldgen/material_rule': 'minecraft:not_a_rule' }, 'data/minecraft/worldgen/noise_settings/x.json')
    expect(bad.some(i => i.issue.includes('minecraft:not_a_rule') && i.issue.includes('minecraft:worldgen/material_rule'))).toBe(true)
  })

  it('verifies worldgen/material_condition values against the worldgen/material_condition registry', () => {
    const ok = check({ 'worldgen/material_condition': 'minecraft:biome' }, 'data/minecraft/worldgen/noise_settings/x.json')
    expect(ok.some(i => i.issue.includes('minecraft:biome'))).toBe(false)

    const bad = check({ 'worldgen/material_condition': 'minecraft:not_a_condition' }, 'data/minecraft/worldgen/noise_settings/x.json')
    expect(bad.some(i => i.issue.includes('minecraft:not_a_condition') && i.issue.includes('minecraft:worldgen/material_condition'))).toBe(true)
  })
})

describe('recipe result id mapping (1.20.5+)', () => {
  it('checks result.id against the item registry for 1.20.5+ packs', () => {
    const ok = check(
      { type: 'minecraft:crafting_shaped', result: { id: 'minecraft:stick', count: 4 } },
      'data/minecraft/recipe/x.json',
      '1.21',
    )
    expect(ok.some(i => i.issue.includes('minecraft:stick'))).toBe(false)

    const bad = check(
      { type: 'minecraft:crafting_shaped', result: { id: 'minecraft:not_an_item' } },
      'data/minecraft/recipe/x.json',
      '1.21',
    )
    expect(bad.some(i => i.issue.includes('minecraft:not_an_item') && i.issue.includes('minecraft:item'))).toBe(true)
  })

  it('does not check result.id before 1.20.5 (field was renamed from item)', () => {
    const issues = check(
      { type: 'minecraft:crafting_shaped', result: { id: 'minecraft:not_an_item' } },
      'data/minecraft/recipe/x.json',
      '1.20.4',
    )
    expect(issues.some(i => i.issue.includes('minecraft:not_an_item'))).toBe(false)
  })

  it('does not check generic "id" keys outside recipe results', () => {
    const issues = check(
      { id: 'minecraft:not_an_item', nested: { id: 'minecraft:also_not_an_item' } },
      'data/minecraft/advancements/x.json',
      '1.21',
    )
    expect(issues.some(i => i.issue.includes('minecraft:not_an_item') || i.issue.includes('minecraft:also_not_an_item'))).toBe(false)
  })

  it('does not check result.id when no target version is known', () => {
    const issues = check(
      { type: 'minecraft:crafting_shaped', result: { id: 'minecraft:not_an_item' } },
      'data/minecraft/recipe/x.json',
    )
    expect(issues.some(i => i.issue.includes('minecraft:not_an_item'))).toBe(false)
  })
})

describe('tag member registry checks', () => {
  it('flags an unknown minecraft block id in a block tag', () => {
    const issues = check({ values: ['minecraft:not_a_block'] }, 'data/minecraft/tags/block/weird.json')
    expect(issues.some(i => i.issue.includes("Value 'minecraft:not_a_block' not found in registry minecraft:block"))).toBe(true)
  })

  it('accepts a known block id in a block tag', () => {
    const issues = check({ values: ['minecraft:stone'] }, 'data/minecraft/tags/block/mineable.json')
    expect(issues).toHaveLength(0)
  })

  it('checks item tag members against the item registry', () => {
    const ok = check({ values: ['minecraft:stick'] }, 'data/minecraft/tags/item/tools.json')
    expect(ok).toHaveLength(0)

    const bad = check({ values: ['minecraft:not_an_item'] }, 'data/minecraft/tags/item/tools.json')
    expect(bad.some(i => i.issue.includes('minecraft:item'))).toBe(true)
  })

  it('checks entity_type tag members against the entity_type registry', () => {
    const ok = check({ values: ['minecraft:cow'] }, 'data/minecraft/tags/entity_type/raiders.json')
    expect(ok).toHaveLength(0)

    const bad = check({ values: ['minecraft:not_an_entity'] }, 'data/minecraft/tags/entity_type/raiders.json')
    expect(bad.some(i => i.issue.includes('minecraft:entity_type'))).toBe(true)
  })

  it('uses the legacy plural folder names (1.13-1.20.x)', () => {
    const bad = check({ values: ['minecraft:not_a_block'] }, 'data/minecraft/tags/blocks/mineable.json')
    expect(bad.some(i => i.issue.includes('minecraft:block'))).toBe(true)
  })

  it('maps two-level worldgen tag kinds (tags/worldgen/biome/...)', () => {
    const ok = check({ values: ['minecraft:plains'] }, 'data/minecraft/tags/worldgen/biome/has_structure.json')
    expect(ok.some(i => i.issue.includes('minecraft:plains'))).toBe(false)

    const bad = check({ values: ['minecraft:not_a_biome'] }, 'data/minecraft/tags/worldgen/biome/has_structure.json')
    expect(bad.some(i => i.issue.includes('minecraft:worldgen/biome'))).toBe(true)
  })

  it('skips tag references, wildcards, path ids and foreign namespaces', () => {
    const issues = check(
      { values: ['#minecraft:planks', '*', 'minecraft:chests/simple', 'mod:thing'] },
      'data/minecraft/tags/block/mixed.json',
    )
    expect(issues).toHaveLength(0)
  })

  it('skips tags whose kind has no registry (functions, trade, ...)', () => {
    const issues = check({ values: ['minecraft:not_checked'] }, 'data/minecraft/tags/function/load.json')
    expect(issues).toHaveLength(0)
  })
})
