import { describe, it, expect } from 'vitest'
import { mapParserIssues } from '../src/engine/parser-issues'

describe('mapParserIssues', () => {
  it('maps mcfunction errors to McfunctionIssue', () => {
    const out = mapParserIssues(
      [{ file: 'data/demo/functions/a.mcfunction', line: 2, message: 'Unknown command', severity: 'error', source: 'mcfunction' }],
      new Map([['data/demo/functions/a.mcfunction', 'say hi\n/foo\n']]),
    )
    expect(out.mcfunction).toHaveLength(1)
    expect(out.mcfunction[0].file).toBe('data/demo/functions/a.mcfunction')
    expect(out.mcfunction[0].line).toBe(2)
    expect(out.mcfunction[0].issue).toContain('Unknown command')
  })

  it('maps json errors to StructuralIssue with source mcdoc', () => {
    const out = mapParserIssues(
      [{ file: 'data/demo/advancements/x.json', line: 1, message: 'Missing required field', severity: 'error', source: 'json' }],
      new Map(),
    )
    expect(out.structural).toHaveLength(1)
    expect(out.structural[0].source).toBe('mcdoc')
  })

  it('maps registry reference errors to RegistryIssue', () => {
    const out = mapParserIssues(
      [{ file: 'data/demo/recipes/r.json', line: 1, message: 'Unknown item minecraft:not_a_thing', severity: 'error', source: 'json' }],
      new Map(),
    )
    expect(out.registry).toHaveLength(1)
    expect(out.registry[0].entry).toBe('minecraft:not_a_thing')
  })
})
