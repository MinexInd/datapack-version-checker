import { describe, it, expect } from 'vitest'
import {
  suggestForCommand,
  suggestForRegistry,
  suggestForDeprecation,
  suggestForStructural,
  matchRegistryRename,
} from '../src/suggest.js'

describe('suggestForCommand', () => {
  it('prefers the auto-fixable rule and falls back to the fix description', () => {
    const s = suggestForCommand('item')
    expect(s.autoFixable).toBe(true)
    expect(s.suggestion).toBeDefined()
    expect(s.suggestion!.length).toBeGreaterThan(0)
    expect(s.suggestion).toMatch(/^Can be auto-fixed:/)
  })

  it('returns {} (no fields) when no rule matches', () => {
    expect(suggestForCommand('nonexistentroot')).toEqual({})
  })

  it('strips a leading slash and takes the first token before matching', () => {
    const s = suggestForCommand('/place')
    expect(s.autoFixable).toBe(true)
    expect(s.suggestion).toBeDefined()
    expect(s.suggestion).toMatch(/place/)
  })
})

describe('suggestForRegistry', () => {
  it('returns guidance for a knowledge registry rule entry', () => {
    const s = suggestForRegistry('minecraft:wolf_variant', 'wolf_variant')
    expect(s.suggestion).toBe('Remove wolf_variant references for pre-1.21.5.')
    expect(s.autoFixable).toBe(false)
  })

  it('returns {} for unknown registries', () => {
    expect(suggestForRegistry('minecraft:unknown_registry', 'some_entry')).toEqual({})
  })
})

describe('suggestForDeprecation', () => {
  it('falls back to the removed text when no rename is known', () => {
    const s = suggestForDeprecation('minecraft:item', 'minecraft:some_removed_item')
    expect(s.suggestion).toBe('Removed in this version — no automatic fix; check for a replacement entry')
    expect(s.autoFixable).toBe(false)
  })
})

describe('matchRegistryRename', () => {
  it('matches an injected rename table and marks the deprecation auto-fixable', () => {
    const table = [
      { from: 'minecraft:old_entry', to: 'minecraft:new_entry', since: '1.21' },
    ]
    const rename = matchRegistryRename('minecraft:old_entry', table)
    expect(rename?.to).toBe('minecraft:new_entry')
    expect(rename?.since).toBe('1.21')

    const s = suggestForDeprecation('minecraft:item', 'minecraft:old_entry', table)
    expect(s.suggestion).toBe("Renamed to 'minecraft:new_entry' in 1.21")
    expect(s.autoFixable).toBe(true)
  })

  it('returns undefined when the entry is not in the table', () => {
    const table = [{ from: 'minecraft:old_entry', to: 'minecraft:new_entry', since: '1.21' }]
    expect(matchRegistryRename('minecraft:unrelated', table)).toBeUndefined()
  })
})

describe('suggestForStructural', () => {
  it('marks rename_field issues as auto-fixable', () => {
    const s = suggestForStructural('Predicate field alternative renamed to any_of in 1.20')
    expect(s.autoFixable).toBe(true)
    expect(s.suggestion).toBeDefined()
  })

  it('returns {} for unrelated text', () => {
    expect(suggestForStructural('unrelated text')).toEqual({})
  })
})
