import { describe, it, expect } from 'vitest'
import { cmpVer, inRange, fileKindFromPath } from '../src/mcdoc-check.js'

// parseType is intentionally not exported — it's an internal helper.

describe('cmpVer', () => {
  it('compares equal versions', () => {
    expect(cmpVer('1.20.4', '1.20.4')).toBe(0)
  })

  it('detects greater version', () => {
    expect(cmpVer('1.21', '1.20.4')).toBeGreaterThan(0)
  })

  it('detects lesser version', () => {
    expect(cmpVer('1.20.4', '1.21')).toBeLessThan(0)
  })

  it('handles two-part versions', () => {
    expect(cmpVer('1.20', '1.20.0')).toBe(0)
    expect(cmpVer('1.20', '1.20.1')).toBeLessThan(0)
  })

  it('handles snapshot-style versions', () => {
    expect(cmpVer('24w09a', '23w45a')).toBeGreaterThan(0)
  })

  it('handles unparsable versions with string fallback', () => {
    expect(cmpVer('a', 'b')).toBeLessThan(0)
  })
})

describe('inRange', () => {
  it('returns true when version is within [since, until)', () => {
    expect(inRange('1.20.4', '1.20', '1.21')).toBe(true)
  })

  it('returns false when version is below since', () => {
    expect(inRange('1.19', '1.20', '1.21')).toBe(false)
  })

  it('returns false when version is at or above until', () => {
    expect(inRange('1.21', '1.20', '1.21')).toBe(false)
  })

  it('returns true when since is undefined', () => {
    expect(inRange('1.19', undefined, '1.21')).toBe(true)
  })

  it('returns true when until is undefined', () => {
    expect(inRange('1.21', '1.20', undefined)).toBe(true)
  })

  it('returns true when both bounds are undefined', () => {
    expect(inRange('1.20', undefined, undefined)).toBe(true)
  })
})

describe('fileKindFromPath', () => {
  it('detects recipes', () => {
    expect(fileKindFromPath('data/minecraft/recipe/diamond.json')).toBe('recipe')
  })

  it('detects loot tables', () => {
    expect(fileKindFromPath('data/minecraft/loot_table/chests/simple_dungeon.json')).toBe('loot_table')
  })

  it('detects advancements', () => {
    expect(fileKindFromPath('data/minecraft/advancement/story/mine_diamond.json')).toBe('advancement')
  })

  it('detects predicates', () => {
    expect(fileKindFromPath('data/minecraft/predicate/weather_check.json')).toBe('predicate')
  })

  it('detects item_modifier', () => {
    expect(fileKindFromPath('data/minecraft/item_modifier/set_damage.json')).toBe('item_modifier')
  })

  it('detects worldgen types', () => {
    expect(fileKindFromPath('data/minecraft/worldgen/biome/plains.json')).toBe('worldgen/biome')
  })

  it('detects resource pack types', () => {
    expect(fileKindFromPath('assets/minecraft/models/block/stone.json')).toBe('models')
  })

  it('skips non-minecraft namespaces', () => {
    expect(fileKindFromPath('data/mymod/recipe/test.json')).toBeNull()
  })

  it('skips tags directory', () => {
    expect(fileKindFromPath('data/minecraft/tags/blocks/dirt.json')).toBeNull()
  })

  it('detects sounds.json', () => {
    expect(fileKindFromPath('data/minecraft/sounds.json')).toBe('sounds')
  })

  it('detects .mcmeta files', () => {
    expect(fileKindFromPath('assets/minecraft/textures/block/stone.png.mcmeta')).toBe('texture_meta')
  })

  it('detects blockstates', () => {
    expect(fileKindFromPath('assets/minecraft/blockstates/stone.json')).toBe('blockstates')
  })
})

describe('parseType', () => {
  it.skip('parses a primitive type (internal helper, not exported)', () => { })
})