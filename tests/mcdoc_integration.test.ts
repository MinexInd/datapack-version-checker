import { describe, it, expect } from 'vitest'
import { getMcdocSymbols, checkMcdocFile, fileKindFromPath, type SymbolTable } from '../src/mcdoc-check.js'
import { writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

describe('mcdoc loot table validation', () => {
  it('accepts conditions and functions on pool entries', async () => {
    const table = await getMcdocSymbols()
    expect(table).not.toBeNull()

    const dir = join(tmpdir(), 'mcdoc-test-' + Date.now())
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
    const file = join(dir, 'test.json')

    // A loot table with conditions and functions on pool entries
    const lootTable = {
      pools: [{
        rolls: 1,
        entries: [{
          type: 'item',
          name: 'minecraft:stick',
          weight: 1,
          conditions: [{
            condition: 'minecraft:random_chance',
            chance: 0.5,
          }],
          functions: [{
            function: 'minecraft:set_count',
            count: 2,
          }],
        }],
      }],
    }

    writeFileSync(file, JSON.stringify(lootTable, null, 2))
    const issues = checkMcdocFile(file, 'data/minecraft/loot_table/test.json', '1.21', table!)
    console.log('Issues for 1.21:', JSON.stringify(issues, null, 2))
    const entryIssues = issues.filter(i => i.issue.includes('unknown field') && (i.issue.includes('conditions') || i.issue.includes('functions')))
    expect(entryIssues).toHaveLength(0)

    const issuesSnapshot = checkMcdocFile(file, 'data/minecraft/loot_table/test.json', '26w01a', table!)
    console.log('Issues for 26w01a:', JSON.stringify(issuesSnapshot, null, 2))
    const entryIssuesSnapshot = issuesSnapshot.filter(i => i.issue.includes('unknown field') && (i.issue.includes('conditions') || i.issue.includes('functions')))
    expect(entryIssuesSnapshot).toHaveLength(0)

    // Snapshots and pre-releases with the same numeric prefix should NOT trigger
    // the until gate (e.g., "26.3 Snapshot 1" < "26.3" because it's a pre-release)
    for (const ver of ['26.3 Snapshot 1', '26.3 Snapshot 6', '26.3 Pre-Release 2', '26.2']) {
      const issuesV = checkMcdocFile(file, 'data/minecraft/loot_table/test.json', ver, table!)
      const entryIssuesV = issuesV.filter(i => i.issue.includes('unknown field') && (i.issue.includes('conditions') || i.issue.includes('functions')))
      console.log(`Issues for "${ver}":`, JSON.stringify(issuesV, null, 2))
      expect(entryIssuesV).toHaveLength(0)
    }

    // Actual release 26.3 and later should flag them (schema says removed in 26.3).
    // Version-gated fields now get the precise "was removed in" message instead
    // of the generic "unknown field" wording.
    const issues26_3 = checkMcdocFile(file, 'data/minecraft/loot_table/test.json', '26.3', table!)
    const entryIssues26_3 = issues26_3.filter(i => (i.issue.includes('unknown field') || i.issue.includes('was removed in')) && (i.issue.includes('conditions') || i.issue.includes('functions')))
    console.log('Issues for 26.3 (release):', JSON.stringify(issues26_3, null, 2))
    expect(entryIssues26_3.length).toBeGreaterThan(0)
  })
})

// ---------------------------------------------------------------------------
// Shared fixture helper for the value-validation regression tests below.
// Mirrors the pattern of the existing loot-table test: write JSON to a temp
// file, run it through checkMcdocFile against the (cached) symbol table.
// ---------------------------------------------------------------------------

let fixtureCounter = 0

async function checkFixture(data: unknown, relPath: string, version = '1.21'): Promise<{ table: SymbolTable; issues: ReturnType<typeof checkMcdocFile> }> {
  const table = await getMcdocSymbols()
  expect(table).not.toBeNull()
  const dir = join(tmpdir(), 'mcdoc-reg-' + Date.now() + '-' + fixtureCounter++)
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  const file = join(dir, 'value.json')
  writeFileSync(file, JSON.stringify(data, null, 2))
  return { table: table!, issues: checkMcdocFile(file, relPath, version, table!) }
}

// ---------------------------------------------------------------------------
// Enum value validation (validateValue + checkEnumValue)
// ---------------------------------------------------------------------------

describe('mcdoc enum value validation', () => {
  it('flags an enum-typed field whose literal is not in the valid set', async () => {
    const { issues } = await checkFixture(
      { display: { frame: 'tazk' } },
      'data/minecraft/advancement/test.json',
    )
    expect(issues.some(i => i.issue.includes('unknown value "tazk" for enum AdvancementFrame'))).toBe(true)
  })

  it('accepts valid enum literals', async () => {
    const { issues } = await checkFixture(
      { display: { frame: 'task' } },
      'data/minecraft/advancement/test.json',
    )
    expect(issues.some(i => i.issue.includes('enum AdvancementFrame'))).toBe(false)
  })

  it('accepts valid enum literals with a minecraft: prefix', async () => {
    const { issues } = await checkFixture(
      { display: { frame: 'minecraft:goal' } },
      'data/minecraft/advancement/test.json',
    )
    expect(issues.some(i => i.issue.includes('enum AdvancementFrame'))).toBe(false)
  })

  it('flags a bad value on a nested enum-typed biome field', async () => {
    const { issues } = await checkFixture(
      { effects: { grass_color_modifier: 'red' } },
      'data/minecraft/worldgen/biome/plains.json',
    )
    expect(issues.some(i => i.issue.includes('unknown value "red" for enum GrassColorModifier'))).toBe(true)
  })

  it('does not flag foreign-namespace values in enum-typed fields', async () => {
    const { issues } = await checkFixture(
      { effects: { grass_color_modifier: 'mymod:custom' } },
      'data/minecraft/worldgen/biome/plains.json',
    )
    expect(issues.some(i => i.issue.includes('enum GrassColorModifier'))).toBe(false)
  })

  it('does not flag tag references in enum-typed fields', async () => {
    const { issues } = await checkFixture(
      { display: { frame: '#custom:frames' } },
      'data/minecraft/advancement/test.json',
    )
    expect(issues.some(i => i.issue.includes('enum AdvancementFrame'))).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// Primitive type validation (clear mismatches only)
// ---------------------------------------------------------------------------

describe('mcdoc primitive type validation', () => {
  it('flags a string where a float is expected', async () => {
    const { issues } = await checkFixture(
      { exhaustion: 'three' },
      'data/minecraft/damage_type/fall.json',
    )
    expect(issues.some(i => i.issue.includes('expected float, got string'))).toBe(true)
  })

  it('flags a string where an int is expected', async () => {
    const { issues } = await checkFixture(
      { width: 'wide' },
      'data/minecraft/painting_variant/foo.json',
    )
    expect(issues.some(i => i.issue.includes('expected int, got string'))).toBe(true)
  })

  it('flags a string where a boolean is expected', async () => {
    const { issues } = await checkFixture(
      { has_precipitation: 'yes' },
      'data/minecraft/worldgen/biome/plains.json',
    )
    expect(issues.some(i => i.issue.includes('expected boolean, got string'))).toBe(true)
  })

  it('accepts well-typed numeric and boolean values', async () => {
    const { issues } = await checkFixture(
      { exhaustion: 0.1, message_id: 'fall' },
      'data/minecraft/damage_type/fall.json',
    )
    expect(issues).toHaveLength(0)
  })

  it('accepts well-typed boolean and float values in biomes', async () => {
    const { issues } = await checkFixture(
      { temperature: 0.8, downfall: 0.4, has_precipitation: false, effects: {} },
      'data/minecraft/worldgen/biome/plains.json',
    )
    expect(issues).toHaveLength(0)
  })

  it('does not flag loose string literals that only match an out-of-version union branch', async () => {
    // set_count.count is a union; a string only fits the 26.3+ string branch,
    // which is version-gated out for 1.21 — the value must be tolerated, not
    // reported against the first candidate.
    const { issues } = await checkFixture(
      { pools: [{ rolls: 1, entries: [{ type: 'item', name: 'minecraft:stick', functions: [{ function: 'minecraft:set_count', count: 'three' }] }] }] },
      'data/minecraft/loot_table/test.json',
    )
    expect(issues.some(i => i.issue.includes('expected'))).toBe(false)
  })

  it('does not flag a number where a plain struct ref is expected', async () => {
    // biome effects is a BiomeEffects struct ref; a number is not a "clear
    // mismatch" against an unresolved object ref and must pass.
    const { issues } = await checkFixture(
      { effects: 5 },
      'data/minecraft/worldgen/biome/plains.json',
    )
    expect(issues).toHaveLength(0)
  })
})
