import { describe, expect, it } from 'vitest'
import { validatePackMetadata } from '../src/ide/metadata-validation'

describe('validatePackMetadata', () => {
  it('reports missing pack.mcmeta', () => {
    const problems = validatePackMetadata({ 'data/example/functions/main.mcfunction': '' }, 'auto')
    expect(problems).toHaveLength(1)
    expect(problems[0]).toMatchObject({ severity: 'error', message: 'Missing pack.mcmeta at pack root' })
  })

  it('reports invalid JSON', () => {
    const problems = validatePackMetadata({ 'pack.mcmeta': '{' }, 'auto')
    expect(problems.some(problem => problem.severity === 'error' && problem.message.startsWith('Invalid JSON'))).toBe(true)
  })

  it('accepts minimal valid pack metadata', () => {
    expect(validatePackMetadata({ 'pack.mcmeta': '{"pack":{"pack_format":48}}' }, 'auto')).toEqual([])
  })

  it('warns when a datapack has no data directory', () => {
    const problems = validatePackMetadata({ 'pack.mcmeta': '{"pack":{"pack_format":48}}' }, 'datapack')
    expect(problems).toContainEqual({ severity: 'warning', message: 'Declared mode datapack but no data/ directory found' })
  })
})
