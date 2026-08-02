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

  it('RESOURCE_FEATURE_RULES carries maxVersion for until-gated rules', () => {
    const rule = RESOURCE_FEATURE_RULES.find(r => r.id === 'painting_inline_variant')
    expect(rule).toBeDefined()
    expect(rule!.minVersion).toBe('1.21')
    expect(rule!.maxVersion).toBe('1.21.5')
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

describe('new rule behavior spot checks (1.21.11/26.1 era)', () => {
  // Mirrors the engine's matching logic in src/engine.ts applyKnowledgeRules:
  //   - type 'command'          -> first token (no leading slash) === match
  //   - type 'command_pattern'  -> new RegExp(match).test(line)
  // Version gating mirrors checkPackCore: a hit is reportable only when the
  // checked version is within [since, until).
  const byId = (id: string): PortRule => {
    const r = PORT_RULES.find(x => x.id === id)
    expect(r).toBeDefined()
    return r!
  }
  const hitRules = (line: string): PortRule[] => {
    return PORT_RULES.filter(r => {
      if (r.type === 'command') {
        const root = line.trim().replace(/^\//, '').split(/\s+/)[0]
        return root === r.match
      }
      if (r.type === 'command_pattern') return new RegExp(String(r.match)).test(line)
      return false
    })
  }
  const inWindow = (ver: string, r: PortRule): boolean => {
    if (r.since && cmpVer(ver, r.since) < 0) return false
    if (r.until && cmpVer(ver, r.until) >= 0) return false
    return true
  }

  it('stopwatch_cmd matches /stopwatch and is gated to 1.21.11+', () => {
    const hits = hitRules('stopwatch my_clock')
    expect(hits.some(r => r.id === 'stopwatch_cmd')).toBe(true)
    const rule = byId('stopwatch_cmd')
    expect(inWindow('1.21.10', rule)).toBe(false)
    expect(inWindow('1.21.11', rule)).toBe(true)
  })

  it('execute_if_stopwatch matches execute if/unless stopwatch', () => {
    const hits = hitRules('/execute if stopwatch my_clock 0..10')
    expect(hits.some(r => r.id === 'execute_if_stopwatch')).toBe(true)
    const hitsUnless = hitRules('execute unless stopwatch other 5..10')
    expect(hitsUnless.some(r => r.id === 'execute_if_stopwatch')).toBe(true)
    // plain /execute if with another condition must not match
    expect(hitRules('/execute if entity @e').some(r => r.id === 'execute_if_stopwatch')).toBe(false)
  })

  it('time_preset_removed matches /time set|query presets and dies in 26.1', () => {
    const hits = hitRules('/time set day')
    expect(hits.some(r => r.id === 'time_preset_removed')).toBe(true)
    expect(hitRules('/time set 1000').some(r => r.id === 'time_preset_removed')).toBe(false)
    expect(hitRules('/time query day').some(r => r.id === 'time_preset_removed')).toBe(true)
    const rule = byId('time_preset_removed')
    expect(inWindow('1.20', rule)).toBe(true)
    expect(inWindow('26.1', rule)).toBe(false)
    expect(inWindow('26.3 Snapshot 1', rule)).toBe(false) // pre-release of 26.3 is still past 26.1
  })

  it('time_world_clock matches the 26.1+ world-clock forms only', () => {
    expect(hitRules('/time of my_clock').some(r => r.id === 'time_world_clock')).toBe(true)
    expect(hitRules('/time query time').some(r => r.id === 'time_world_clock')).toBe(true)
    expect(hitRules('/time pause').some(r => r.id === 'time_world_clock')).toBe(true)
    expect(hitRules('/time set day').some(r => r.id === 'time_world_clock')).toBe(false)
    const rule = byId('time_world_clock')
    expect(inWindow('1.21', rule)).toBe(false)
    expect(inWindow('26.1', rule)).toBe(true)
  })

  it('gamerule camelCase vs snake_case rules are mutually exclusive by version', () => {
    const camel = byId('gamerule_camelcase_removed')
    const snake = byId('gamerule_snakecase')
    expect(hitRules('/gamerule doDaylightCycle true').some(r => r.id === 'gamerule_camelcase_removed')).toBe(true)
    expect(hitRules('/gamerule doDaylightCycle true').some(r => r.id === 'gamerule_snakecase')).toBe(false)
    expect(hitRules('/gamerule advance_time true').some(r => r.id === 'gamerule_snakecase')).toBe(true)
    expect(hitRules('/gamerule advance_time true').some(r => r.id === 'gamerule_camelcase_removed')).toBe(false)
    expect(inWindow('1.21.10', camel)).toBe(true)
    expect(inWindow('1.21.11', camel)).toBe(false)
    expect(inWindow('1.21.10', snake)).toBe(false)
    expect(inWindow('1.21.11', snake)).toBe(true)
  })

  it('locate_subcommands and locate_lowercase match modern /locate forms', () => {
    expect(hitRules('/locate structure minecraft:village').some(r => r.id === 'locate_subcommands')).toBe(true)
    expect(hitRules('/locate biome minecraft:plains').some(r => r.id === 'locate_subcommands')).toBe(true)
    expect(hitRules('/locate minecraft:village').some(r => r.id === 'locate_lowercase')).toBe(true)
    expect(hitRules('/locate Village').some(r => r.id === 'locate_lowercase')).toBe(false)
    const sub = byId('locate_subcommands')
    expect(inWindow('1.18.2', sub)).toBe(false)
    expect(inWindow('1.19', sub)).toBe(true)
  })

  it('function_with_macro matches /function <id> with block|entity|storage', () => {
    expect(hitRules('/function demo:macros with entity @e').some(r => r.id === 'function_with_macro')).toBe(true)
    expect(hitRules('/function demo:macros with storage demo:data path').some(r => r.id === 'function_with_macro')).toBe(true)
    expect(hitRules('/function demo:plain').some(r => r.id === 'function_with_macro')).toBe(false)
  })

  it('effect_infinite matches the infinite duration form only', () => {
    expect(hitRules('/effect give @p minecraft:speed infinite 1').some(r => r.id === 'effect_infinite')).toBe(true)
    expect(hitRules('/effect give @p minecraft:speed 30 1').some(r => r.id === 'effect_infinite')).toBe(false)
  })

  it('block_command_strict matches strict on fill/clone/setblock', () => {
    expect(hitRules('/fill 0 0 0 10 10 10 minecraft:stone strict').some(r => r.id === 'block_command_strict')).toBe(true)
    expect(hitRules('/setblock 0 0 0 minecraft:stone strict').some(r => r.id === 'block_command_strict')).toBe(true)
    expect(hitRules('/fill 0 0 0 10 10 10 minecraft:stone').some(r => r.id === 'block_command_strict')).toBe(false)
    expect(inWindow('1.21.4', byId('block_command_strict'))).toBe(false)
    expect(inWindow('1.21.5', byId('block_command_strict'))).toBe(true)
  })

  it('clone_from_to matches cross-dimension from/to only', () => {
    expect(hitRules('/clone from minecraft:overworld 0 0 0 1 1 1 to minecraft:the_nether 0 0 0').some(r => r.id === 'clone_from_to')).toBe(true)
    expect(hitRules('/clone 0 0 0 1 1 1 5 5 5').some(r => r.id === 'clone_from_to')).toBe(false)
  })

  it('datapack_create matches only the create subcommand', () => {
    expect(hitRules('/datapack create my_pack').some(r => r.id === 'datapack_create')).toBe(true)
    expect(hitRules('/datapack enable my_pack').some(r => r.id === 'datapack_create')).toBe(false)
    expect(inWindow('1.21.5', byId('datapack_create'))).toBe(false)
    expect(inWindow('1.21.6', byId('datapack_create'))).toBe(true)
  })

  it('debug_function and debug_report are mutually exclusive by version', () => {
    expect(hitRules('/debug function demo:f').some(r => r.id === 'debug_function')).toBe(true)
    expect(hitRules('/debug report').some(r => r.id === 'debug_report')).toBe(true)
    const rep = byId('debug_report')
    expect(inWindow('1.16', rep)).toBe(true)
    expect(inWindow('1.17', rep)).toBe(false)
    expect(inWindow('1.16', byId('debug_function'))).toBe(false)
    expect(inWindow('1.17', byId('debug_function'))).toBe(true)
  })

  it('playsound_ui matches the ui sound source only', () => {
    expect(hitRules('/playsound minecraft:block.note_block.pling ui @p').some(r => r.id === 'playsound_ui')).toBe(true)
    expect(hitRules('/stopsound @p ui').some(r => r.id === 'playsound_ui')).toBe(true)
    expect(hitRules('/playsound minecraft:block.note_block.pling master @p').some(r => r.id === 'playsound_ui')).toBe(false)
    expect(inWindow('1.21.5', byId('playsound_ui'))).toBe(false)
    expect(inWindow('1.21.6', byId('playsound_ui'))).toBe(true)
  })

  it('spreadplayers_under matches the under option', () => {
    expect(hitRules('/spreadplayers 0 0 10 100 false under 320').some(r => r.id === 'spreadplayers_under')).toBe(true)
    expect(hitRules('/spreadplayers 0 0 10 100 false').some(r => r.id === 'spreadplayers_under')).toBe(false)
    expect(inWindow('1.15', byId('spreadplayers_under'))).toBe(false)
    expect(inWindow('1.16', byId('spreadplayers_under'))).toBe(true)
  })
})
