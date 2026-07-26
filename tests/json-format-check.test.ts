import { describe, it, expect } from 'vitest'
import { checkJsonFormatSemantics } from '../src/json-format-check.js'

// ---------------------------------------------------------------------------
// Predicate field renames (alternative ↔ any_of, requirements ↔ all_of)
// ---------------------------------------------------------------------------

describe('checkJsonFormatSemantics — predicate renames', () => {
  it('flags "alternative" key in predicate when checking against 1.20+', () => {
    const data = { alternative: [{ condition: 'minecraft:entity_properties', predicate: {} }] }
    const issues = checkJsonFormatSemantics(data, 'data/mc/predicates/test.json', '1.20')
    expect(issues.some(i => i.issue.includes("'alternative' renamed to 'any_of'"))).toBe(true)
  })

  it('does NOT flag "alternative" when checking against pre-1.20', () => {
    const data = { alternative: [{ condition: 'minecraft:entity_properties', predicate: {} }] }
    const issues = checkJsonFormatSemantics(data, 'data/mc/predicates/test.json', '1.19.4')
    expect(issues.some(i => i.issue.includes('alternative'))).toBe(false)
  })

  it('flags "any_of" key in predicate when checking against pre-1.20', () => {
    const data = { any_of: [{ condition: 'minecraft:entity_properties', predicate: {} }] }
    const issues = checkJsonFormatSemantics(data, 'data/mc/predicates/test.json', '1.19.4')
    expect(issues.some(i => i.issue.includes("'any_of' not available before 1.20"))).toBe(true)
  })

  it('does NOT flag "any_of" when checking against 1.20+', () => {
    const data = { any_of: [{ condition: 'minecraft:entity_properties', predicate: {} }] }
    const issues = checkJsonFormatSemantics(data, 'data/mc/predicates/test.json', '1.20')
    expect(issues.some(i => i.issue.includes('any_of'))).toBe(false)
  })

  it('flags "requirements" key in predicate when checking against 1.20+', () => {
    const data = { requirements: [[{ condition: 'minecraft:entity_properties' }]] }
    const issues = checkJsonFormatSemantics(data, 'data/mc/predicates/test.json', '1.20')
    expect(issues.some(i => i.issue.includes("'requirements' renamed to 'all_of'"))).toBe(true)
  })

  it('does NOT flag "requirements" when checking pre-1.20 (correct old format)', () => {
    const data = { requirements: [[{ condition: 'minecraft:entity_properties' }]] }
    const issues = checkJsonFormatSemantics(data, 'data/mc/predicates/test.json', '1.19.4')
    expect(issues.some(i => i.issue.includes('requirements'))).toBe(false)
  })

  it('flags "all_of" key in predicate when checking against pre-1.20', () => {
    const data = { all_of: [{ condition: 'minecraft:entity_properties' }] }
    const issues = checkJsonFormatSemantics(data, 'data/mc/predicates/test.json', '1.16')
    expect(issues.some(i => i.issue.includes("'all_of' not available before 1.20"))).toBe(true)
  })

  it('only checks predicate files, not arbitrary JSON', () => {
    const data = { alternative: 'something' }
    const issues = checkJsonFormatSemantics(data, 'data/mc/advancements/test.json', '1.20')
    expect(issues.some(i => i.issue.includes('alternative'))).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// Damage predicate boolean flags (removed in 1.19.4)
// ---------------------------------------------------------------------------

describe('checkJsonFormatSemantics — damage predicate flags', () => {
  it('flags bypasses_armor in predicate when checking 1.19.4+', () => {
    const data = { bypasses_armor: true }
    const issues = checkJsonFormatSemantics(data, 'data/mc/predicates/damage.json', '1.19.4')
    expect(issues.some(i => i.issue.includes('bypasses_armor'))).toBe(true)
  })

  it('flags is_fire in predicate when checking 1.20', () => {
    const data = { is_fire: true }
    const issues = checkJsonFormatSemantics(data, 'data/mc/predicates/dmg.json', '1.20')
    expect(issues.some(i => i.issue.includes('is_fire'))).toBe(true)
  })

  it('does NOT flag damage flags when checking pre-1.19.4', () => {
    const data = { bypasses_armor: true, is_fire: false }
    const issues = checkJsonFormatSemantics(data, 'data/mc/predicates/damage.json', '1.19.3')
    expect(issues.some(i => i.issue.includes('bypasses_armor'))).toBe(false)
  })

  it('flags all 8 removed damage flags', () => {
    const flags = [
      'bypasses_armor', 'bypasses_invulnerability', 'bypasses_magic',
      'is_fire', 'is_explosion', 'is_magic', 'is_projectile', 'is_lightning',
    ]
    for (const flag of flags) {
      const data = { [flag]: true }
      const issues = checkJsonFormatSemantics(data, 'data/mc/predicates/x.json', '1.20')
      expect(issues.some(i => i.issue.includes(flag))).toBe(true)
    }
  })

  it('does NOT flag damage flags outside predicate files', () => {
    const data = { bypasses_armor: true }
    const issues = checkJsonFormatSemantics(data, 'data/mc/advancements/test.json', '1.20')
    expect(issues).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// Biome precipitation field
// ---------------------------------------------------------------------------

describe('checkJsonFormatSemantics — biome precipitation', () => {
  it('flags "precipitation" string in biome when checking 1.19.4+', () => {
    const data = { precipitation: 'rain', effects: {} }
    const issues = checkJsonFormatSemantics(data, 'data/mc/worldgen/biome/plains.json', '1.19.4')
    expect(issues.some(i => i.issue.includes("'precipitation'") && i.issue.includes('has_precipitation'))).toBe(true)
  })

  it('does NOT flag "precipitation" string when checking pre-1.19.4', () => {
    const data = { precipitation: 'rain', effects: {} }
    const issues = checkJsonFormatSemantics(data, 'data/mc/worldgen/biome/plains.json', '1.19.3')
    expect(issues.some(i => i.issue.includes('precipitation'))).toBe(false)
  })

  it('flags "has_precipitation" boolean when checking pre-1.19.4', () => {
    const data = { has_precipitation: true, effects: {} }
    const issues = checkJsonFormatSemantics(data, 'data/mc/worldgen/biome/plains.json', '1.19.3')
    expect(issues.some(i => i.issue.includes("'has_precipitation' not available before 1.19.4"))).toBe(true)
  })

  it('does NOT flag "has_precipitation" when checking 1.19.4+', () => {
    const data = { has_precipitation: true, effects: {} }
    const issues = checkJsonFormatSemantics(data, 'data/mc/worldgen/biome/plains.json', '1.19.4')
    expect(issues.some(i => i.issue.includes('has_precipitation'))).toBe(false)
  })

  it('does NOT check biome fields in non-biome files', () => {
    const data = { precipitation: 'rain' }
    const issues = checkJsonFormatSemantics(data, 'data/mc/recipes/test.json', '1.20')
    expect(issues).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// Loot table function type fields
// ---------------------------------------------------------------------------

describe('checkJsonFormatSemantics — loot function type fields', () => {
  it('flags set_damage without type when checking 1.17+', () => {
    const data = { type: 'minecraft:loot_table', pools: [{ entries: [{ type: 'minecraft:item', name: 'minecraft:diamond_sword', functions: [{ function: 'minecraft:set_damage', damage: 0.5 }] }] }] }
    const issues = checkJsonFormatSemantics(data, 'data/mc/loot_tables/test.json', '1.17')
    expect(issues.some(i => i.issue.includes("'set_damage' requires a 'type' field"))).toBe(true)
  })

  it('does NOT flag set_damage with type present', () => {
    const data = { type: 'minecraft:loot_table', pools: [{ entries: [{ type: 'minecraft:item', name: 'minecraft:diamond_sword', functions: [{ function: 'minecraft:set_damage', type: 'minecraft:vanishing_curse', damage: 0.5 }] }] }] }
    const issues = checkJsonFormatSemantics(data, 'data/mc/loot_tables/test.json', '1.17')
    expect(issues.some(i => i.issue.includes('set_damage'))).toBe(false)
  })

  it('does NOT flag set_damage without type when checking pre-1.17', () => {
    const data = { pools: [{ entries: [{ functions: [{ function: 'minecraft:set_damage', damage: 0.5 }] }] }] }
    const issues = checkJsonFormatSemantics(data, 'data/mc/loot_tables/test.json', '1.16.5')
    expect(issues.some(i => i.issue.includes('set_damage'))).toBe(false)
  })

  it('flags set_contents without type when checking 1.18+', () => {
    const data = { pools: [{ entries: [{ functions: [{ function: 'minecraft:set_contents', name: 'minecraft:chest' }] }] }] }
    const issues = checkJsonFormatSemantics(data, 'data/mc/loot_tables/test.json', '1.18')
    expect(issues.some(i => i.issue.includes("'set_contents' requires a 'type' field"))).toBe(true)
  })

  it('flags set_loot_table without type when checking 1.18+', () => {
    const data = { pools: [{ entries: [{ functions: [{ function: 'minecraft:set_loot_table', name: 'minecraft:gameplay/fishing' }] }] }] }
    const issues = checkJsonFormatSemantics(data, 'data/mc/loot_tables/test.json', '1.18')
    expect(issues.some(i => i.issue.includes("'set_loot_table' requires a 'type' field"))).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// Recipe result key renames (item ↔ id)
// ---------------------------------------------------------------------------

describe('checkJsonFormatSemantics — recipe result keys', () => {
  it('flags "item" key in recipe result when checking 1.20.5+', () => {
    const data = { type: 'minecraft:crafting_shaped', result: { item: 'minecraft:diamond', count: 1 } }
    const issues = checkJsonFormatSemantics(data, 'data/mc/recipes/test.json', '1.20.5')
    expect(issues.some(i => i.issue.includes("Recipe result key 'item' renamed to 'id'"))).toBe(true)
  })

  it('does NOT flag "item" key when checking pre-1.20.5', () => {
    const data = { type: 'minecraft:crafting_shaped', result: { item: 'minecraft:diamond', count: 1 } }
    const issues = checkJsonFormatSemantics(data, 'data/mc/recipes/test.json', '1.20.4')
    expect(issues.some(i => i.issue.includes("item' renamed to 'id'"))).toBe(false)
  })

  it('flags "id" key in recipe result when checking pre-1.20.5', () => {
    const data = { type: 'minecraft:crafting_shaped', result: { id: 'minecraft:diamond', count: 1 } }
    const issues = checkJsonFormatSemantics(data, 'data/mc/recipes/test.json', '1.20.4')
    expect(issues.some(i => i.issue.includes("Recipe result key 'id' not available before 1.20.5"))).toBe(true)
  })

  it('does NOT flag "id" key when checking 1.20.5+', () => {
    const data = { type: 'minecraft:crafting_shaped', result: { id: 'minecraft:diamond', count: 1 } }
    const issues = checkJsonFormatSemantics(data, 'data/mc/recipes/test.json', '1.20.5')
    expect(issues.some(i => i.issue.includes("id' not available"))).toBe(false)
  })

  it('does NOT false-positive on ingredient objects with "item" key', () => {
    const data = { type: 'minecraft:crafting_shapeless', result: { item: 'minecraft:stick', count: 1 }, ingredients: [{ item: 'minecraft:planks' }] }
    const issues = checkJsonFormatSemantics(data, 'data/mc/recipes/test.json', '1.21')
    // ingredients have "item" but should NOT trigger (not under "result" or "output" key)
    // result has "item" which SHOULD trigger for 1.21 (should be "id")
    expect(issues.some(i => i.issue.includes("Recipe result key 'item' renamed to 'id'"))).toBe(true)
    // But the ingredients array items should NOT produce any issues
    expect(issues.length).toBe(1)
  })
})

// ---------------------------------------------------------------------------
// Edge cases
// ---------------------------------------------------------------------------

describe('checkJsonFormatSemantics — edge cases', () => {
  it('returns empty array for null data', () => {
    expect(checkJsonFormatSemantics(null, 'data/mc/predicates/test.json', '1.20')).toEqual([])
  })

  it('returns empty array for undefined data', () => {
    expect(checkJsonFormatSemantics(undefined, 'data/mc/predicates/test.json', '1.20')).toEqual([])
  })

  it('returns empty array for non-predicate/biome/loot/recipe files', () => {
    const data = { alternative: true, precipitation: 'rain' }
    expect(checkJsonFormatSemantics(data, 'data/mc/dimension_type/overworld.json', '1.20')).toEqual([])
  })

  it('handles deeply nested structures', () => {
    const data = {
      alternative: [
        { alternative: [{ condition: 'minecraft:entity_properties' }] },
      ],
    }
    const issues = checkJsonFormatSemantics(data, 'data/mc/predicates/test.json', '1.21')
    // Should flag both the top-level and nested "alternative"
    expect(issues.filter(i => i.issue.includes('alternative')).length).toBe(2)
  })

  it('checks both loot-table and predicate rules simultaneously for cross-directory paths', () => {
    // This tests the regex matchers for edge cases
    const lootData = { pools: [{ entries: [{ functions: [{ function: 'minecraft:set_damage', damage: 0.5 }] }] }] }
    const issues = checkJsonFormatSemantics(lootData, 'data/mc/loot_tables/chest/test.json', '1.17')
    expect(issues.some(i => i.issue.includes('set_damage'))).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// Number provider value wrapper (removed in 1.20.5)
// ---------------------------------------------------------------------------

describe('checkJsonFormatSemantics — number provider value wrapper', () => {
  it('flags uniform provider with value wrapper when checking 1.20.5+', () => {
    const data = { type: 'minecraft:uniform', value: { min_inclusive: 0, max_inclusive: 10 } }
    const issues = checkJsonFormatSemantics(data, 'data/mc/loot_tables/test.json', '1.20.5')
    expect(issues.some(i => i.issue.includes("no longer uses 'value' wrapper"))).toBe(true)
  })

  it('flags binomial provider with value wrapper when checking 1.20.5+', () => {
    const data = { type: 'minecraft:binomial', value: { n: 10, p: 0.5 } }
    const issues = checkJsonFormatSemantics(data, 'data/mc/loot_tables/test.json', '1.21')
    expect(issues.some(i => i.issue.includes("'minecraft:binomial' no longer uses 'value' wrapper"))).toBe(true)
  })

  it('does NOT flag uniform provider with value wrapper when checking pre-1.20.5', () => {
    const data = { type: 'minecraft:uniform', value: { min_inclusive: 0, max_inclusive: 10 } }
    const issues = checkJsonFormatSemantics(data, 'data/mc/loot_tables/test.json', '1.20.4')
    expect(issues.some(i => i.issue.includes('value wrapper'))).toBe(false)
  })

  it('does NOT flag uniform provider without direct fields when checking pre-1.20.5', () => {
    const data = { type: 'minecraft:uniform' }
    const issues = checkJsonFormatSemantics(data, 'data/mc/loot_tables/test.json', '1.20.4')
    expect(issues.some(i => i.issue.includes('value wrapper'))).toBe(false)
  })

  it('flags uniform provider missing value wrapper when checking pre-1.20.5', () => {
    const data = { type: 'minecraft:uniform', min_inclusive: 0, max_inclusive: 10 }
    const issues = checkJsonFormatSemantics(data, 'data/mc/loot_tables/test.json', '1.20.4')
    expect(issues.some(i => i.issue.includes("requires a 'value' wrapper"))).toBe(true)
  })

  it('does NOT flag uniform provider without value wrapper when checking 1.20.5+', () => {
    const data = { type: 'minecraft:uniform', min_inclusive: 0, max_inclusive: 10 }
    const issues = checkJsonFormatSemantics(data, 'data/mc/loot_tables/test.json', '1.21')
    expect(issues.some(i => i.issue.includes('value wrapper'))).toBe(false)
  })

  it('flags deeply nested number providers', () => {
    const data = {
      pools: [{
        entries: [{
          functions: [{
            function: 'minecraft:set_count',
            count: { type: 'minecraft:uniform', value: { min_inclusive: 1, max_inclusive: 5 } },
          }],
        }],
      }],
    }
    const issues = checkJsonFormatSemantics(data, 'data/mc/loot_tables/test.json', '1.21')
    expect(issues.some(i => i.issue.includes("no longer uses 'value' wrapper"))).toBe(true)
  })

  it('does NOT flag constant number provider', () => {
    const data = { type: 'minecraft:constant', value: 5 }
    const issues = checkJsonFormatSemantics(data, 'data/mc/loot_tables/test.json', '1.20.5')
    expect(issues.some(i => i.issue.includes('value wrapper'))).toBe(false)
  })

  it('works on any JSON file path', () => {
    const data = { type: 'minecraft:uniform', value: { min_inclusive: 0, max_inclusive: 10 } }
    const issues = checkJsonFormatSemantics(data, 'data/mc/worldgen/noise_settings/test.json', '1.20.5')
    expect(issues.some(i => i.issue.includes("no longer uses 'value' wrapper"))).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// Advancement trigger collapse (merged into minecraft:location in 1.20)
// ---------------------------------------------------------------------------

describe('checkJsonFormatSemantics — advancement triggers', () => {
  it('flags placed_block trigger when checking 1.20+', () => {
    const data = { trigger: 'minecraft:placed_block', conditions: {} }
    const issues = checkJsonFormatSemantics(data, 'data/mc/advancements/test.json', '1.20')
    expect(issues.some(i => i.issue.includes("'minecraft:placed_block' was merged into 'minecraft:location'"))).toBe(true)
  })

  it('flags item_used_on_block trigger when checking 1.20+', () => {
    const data = { trigger: 'minecraft:item_used_on_block', conditions: {} }
    const issues = checkJsonFormatSemantics(data, 'data/mc/advancements/test.json', '1.21')
    expect(issues.some(i => i.issue.includes("'minecraft:item_used_on_block' was merged"))).toBe(true)
  })

  it('flags allay_drop_item_on_block trigger when checking 1.20+', () => {
    const data = { trigger: 'minecraft:allay_drop_item_on_block', conditions: {} }
    const issues = checkJsonFormatSemantics(data, 'data/mc/advancements/test.json', '1.20')
    expect(issues.some(i => i.issue.includes("'minecraft:allay_drop_item_on_block' was merged"))).toBe(true)
  })

  it('does NOT flag placed_block when checking pre-1.20', () => {
    const data = { trigger: 'minecraft:placed_block', conditions: {} }
    const issues = checkJsonFormatSemantics(data, 'data/mc/advancements/test.json', '1.19.4')
    expect(issues.some(i => i.issue.includes('placed_block'))).toBe(false)
  })

  it('flags minecraft:location trigger when checking pre-1.20', () => {
    const data = { trigger: 'minecraft:location', conditions: {} }
    const issues = checkJsonFormatSemantics(data, 'data/mc/advancements/test.json', '1.19.4')
    expect(issues.some(i => i.issue.includes("'minecraft:location' not available before 1.20"))).toBe(true)
  })

  it('does NOT flag minecraft:location trigger when checking 1.20+', () => {
    const data = { trigger: 'minecraft:location', conditions: {} }
    const issues = checkJsonFormatSemantics(data, 'data/mc/advancements/test.json', '1.20')
    expect(issues.some(i => i.issue.includes('minecraft:location'))).toBe(false)
  })

  it('does NOT flag non-collapsed triggers', () => {
    const data = { trigger: 'minecraft:tick', conditions: {} }
    const issues = checkJsonFormatSemantics(data, 'data/mc/advancements/test.json', '1.20')
    expect(issues).toHaveLength(0)
  })

  it('does NOT check triggers outside advancement files', () => {
    const data = { trigger: 'minecraft:placed_block', conditions: {} }
    const issues = checkJsonFormatSemantics(data, 'data/mc/predicates/test.json', '1.21')
    expect(issues.some(i => i.issue.includes('placed_block'))).toBe(false)
  })
})
