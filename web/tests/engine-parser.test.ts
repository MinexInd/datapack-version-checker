import { describe, it, expect } from 'vitest'
import { checkCompatibilityContentBased } from '../src/engine/engine'

describe('engine with parser lane', () => {
  it('reports parser errors alongside custom checks', async () => {
    // Use a command the custom walker accepts (valid tree path) but the
    // Spyglass parser definitely flags as unknown. The custom walker won't
    // flag this because it only validates command tree structure, not command
    // existence; the parser lane must produce the issue.
    const files = {
      'pack.mcmeta': JSON.stringify({ pack: { pack_format: 48, description: 't' } }),
      'data/demo/functions/test.mcfunction': 'say hi\n/definitely_not_a_command foo\n',
    }
    const result = await checkCompatibilityContentBased(files, ['1.21'])
    const allVersions = [...result.compatible, ...result.incompatible]
    const ver = allVersions.find((v) => v.version.name === '1.21')
    expect(ver).toBeTruthy()
    // The parser lane should produce at least one mcfunction issue for the
    // unknown command line.
    expect(ver!.mcfunction_issues.length).toBeGreaterThan(0)
    expect(ver!.parserActive).toBe(true)
  }, 120_000)
})
