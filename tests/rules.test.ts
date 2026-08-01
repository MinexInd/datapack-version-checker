import { describe, it, expect } from 'vitest'
import {
  PORT_RULES,
  FEATURE_RULES,
  RESOURCE_FEATURE_RULES,
  CMD_REWRITES,
  REGISTRY_RENAMES,
  jsonFieldRenames,
  type PortRule,
} from '../src/rules.js'
import { cmpVer } from '../src/mcdoc-check.js'

describe('PORT_RULES consistency', () => {
  it('has unique rule ids', () => {
    const ids = PORT_RULES.map(r => r.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('every rule has id, description, and a valid type', () => {
    const types = new Set(['command', 'command_pattern', 'registry', 'json_field', 'function_macro', 'resource_path'])
    for (const r of PORT_RULES) {
      expect(r.id.length).toBeGreaterThan(0)
      expect(r.description.length).toBeGreaterThan(0)
      expect(types.has(r.type)).toBe(true)
    }
  })

  it('regex-typed matches compile (command_pattern / function_macro / resource_path)', () => {
    for (const r of PORT_RULES) {
      if (r.type === 'command_pattern' || r.type === 'function_macro' || r.type === 'resource_path') {
        expect(() => new RegExp(String(r.match))).not.toThrow()
      }
    }
  })

  it('version windows are sane (since <= until when both present)', () => {
    for (const r of PORT_RULES) {
      if (r.since && r.until) {
        expect(cmpVer(r.since, r.until)).toBeLessThanOrEqual(0)
      }
    }
  })

  it('rewrite fixes carry a compiled pattern and a replacement', () => {
    const rewrites = PORT_RULES.filter(r => r.fix?.kind === 'rewrite')
    expect(rewrites.length).toBeGreaterThan(0)
    for (const r of rewrites) {
      const fix = r.fix!
      if (fix.kind === 'rewrite') {
        expect(fix.pattern).toBeInstanceOf(RegExp)
        expect(fix.replacement.length).toBeGreaterThan(0)
      }
    }
  })

  it('rename_field fixes carry from/to/since', () => {
    for (const r of PORT_RULES) {
      if (r.fix?.kind === 'rename_field') {
        expect(r.fix.from.length).toBeGreaterThan(0)
        expect(r.fix.to.length).toBeGreaterThan(0)
        expect(r.fix.since.length).toBeGreaterThan(0)
      }
    }
  })
})

describe('derived views', () => {
  it('FEATURE_RULES is exactly the datapack knowledge rules (no rewrites / json_field / resource)', () => {
    const expected = PORT_RULES.filter(
      r => r.scope !== 'resource_pack' && r.fix?.kind !== 'rewrite' && r.type !== 'json_field',
    )
    expect(FEATURE_RULES.length).toBe(expected.length)
    const fIds = new Set(FEATURE_RULES.map(r => r.id))
    expect(fIds.size).toBe(FEATURE_RULES.length)
    for (const r of expected) expect(fIds.has(r.id)).toBe(true)
    // every derived entry maps minVersion back to since
    for (const r of FEATURE_RULES) {
      expect(r.minVersion.length).toBeGreaterThan(0)
      expect(typeof r.fix === 'string' || r.fix === undefined).toBe(true)
    }
  })

  it('RESOURCE_FEATURE_RULES is exactly the resource-pack rules', () => {
    const expected = PORT_RULES.filter(r => r.scope === 'resource_pack')
    expect(RESOURCE_FEATURE_RULES.length).toBe(expected.length)
    const ids = new Set(RESOURCE_FEATURE_RULES.map(r => r.id))
    for (const r of expected) expect(ids.has(r.id)).toBe(true)
  })

  it('CMD_REWRITES is exactly the rewrite strategies', () => {
    const expected = PORT_RULES.filter(r => r.fix?.kind === 'rewrite')
    expect(CMD_REWRITES.length).toBe(expected.length)
    for (const rw of CMD_REWRITES) {
      expect(rw.pattern).toBeInstanceOf(RegExp)
      expect(rw.replacement.length).toBeGreaterThan(0)
      // pattern-scoped rewrites (macro_comment) intentionally have no root match
      if (rw.id !== 'macro_comment') expect(rw.matchRoot.length).toBeGreaterThan(0)
    }
    const ids = new Set(CMD_REWRITES.map(rw => rw.id))
    for (const r of expected) expect(ids.has(r.id)).toBe(true)
  })

  it('jsonFieldRenames returns the seeded rename tables', () => {
    expect(jsonFieldRenames('predicate')).toEqual([
      ['alternative', 'any_of', '1.20'],
      ['requirements', 'all_of', '1.20'],
    ])
    expect(jsonFieldRenames('recipe')).toEqual([['item', 'id', '1.20.5']])
  })

  it('REGISTRY_RENAMES entries are well-formed', () => {
    for (const r of REGISTRY_RENAMES) {
      expect(r.from.length).toBeGreaterThan(0)
      expect(r.to.length).toBeGreaterThan(0)
      expect(r.since.length).toBeGreaterThan(0)
    }
  })
})

describe('REGISTRY_RENAMES seed', () => {
  test('contains the verified block/enchantment renames', () => {
    const byFrom = new Map(REGISTRY_RENAMES.map(r => [r.from, r]))
    expect(byFrom.get('minecraft:grass')).toMatchObject({ to: 'minecraft:short_grass', since: '1.20.3' })
    expect(byFrom.get('minecraft:sweeping')).toMatchObject({ to: 'minecraft:sweeping_edge', since: '1.20.5' })
  })

  test('contains the verified game-rule renames', () => {
    const byFrom = new Map(REGISTRY_RENAMES.map(r => [r.from, r]))
    expect(REGISTRY_RENAMES.filter(r => r.registry === 'game_rule')).toHaveLength(9)
    expect(byFrom.get('doDaylightCycle')).toMatchObject({ to: 'minecraft:advance_time', since: '1.21.11', registry: 'game_rule' })
    expect(byFrom.get('disableElytraMovementCheck')).toMatchObject({ to: 'minecraft:elytra_movement_check', since: '1.21.11' })
    expect(byFrom.get('useLocatorBar')).toMatchObject({ to: 'locatorBar', since: '1.21.6' })
  })
})

describe('known-rule spot checks', () => {
  const byId = (id: string): PortRule => {
    const r = PORT_RULES.find(x => x.id === id)
    expect(r).toBeDefined()
    return r!
  }

  it('knowledge rule /tag maps since/guidance correctly', () => {
    const tag = byId('tag')
    expect(tag.type).toBe('command')
    expect(tag.since).toBe('1.13')
    expect(tag.guidance).toBeTruthy()
    expect(tag.fix).toBeUndefined()
  })

  it('rewrite rule /item -> /replaceitem keeps windows and pattern', () => {
    const r = byId('item_to_replaceitem')
    expect(r.fix?.kind).toBe('rewrite')
    const fix = r.fix!
    if (fix.kind === 'rewrite') {
      expect(fix.replacement.startsWith('/replaceitem')).toBe(true)
      expect(fix.targetUntil).toBe('1.20.4')
    }
  })

  it('predicate rename rule is json_field with rename_field fix', () => {
    const r = byId('predicate_alternative_to_any_of')
    expect(r.type).toBe('json_field')
    expect(r.jsonKind).toBe('predicate')
    expect(r.fix?.kind).toBe('rename_field')
  })

  it('trade_registry is a registry rule from 26.1', () => {
    const r = byId('trade_registry')
    expect(r.type).toBe('registry')
    expect(r.since).toBe('26.1')
  })

  it('predicate_durability_removed is json_field with remove_field fix', () => {
    const r = byId('predicate_durability_removed')
    expect(r.type).toBe('json_field')
    expect(r.jsonKind).toBe('predicate')
    expect(r.fix?.kind).toBe('remove_field')
  })
})
