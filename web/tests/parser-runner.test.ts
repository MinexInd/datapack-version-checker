import { describe, it, expect } from 'vitest'
import { analyzePackWithSpyglass } from '../src/engine/parser-runner'

describe('parser runner spike', () => {
  it('reports an unknown command in a mcfunction', { timeout: 120_000 }, async () => {
    const files = {
      'pack.mcmeta': JSON.stringify({ pack: { pack_format: 48, description: 't' } }),
      'data/demo/functions/hello.mcfunction': 'say hi\n/definitely_not_a_command foo\n',
    }
    const issues = await analyzePackWithSpyglass(files, '1.21')
    // The real Spyglass parser reports the unknown command via:
    // "Unexpected leading slash" + "Expected [valid commands]" (does NOT
    // include the bad command name in the message).  Any error on line 2 of
    // hello.mcfunction proves the parser ran.
    const bad = issues.find(
      (i) => i.file.endsWith('hello.mcfunction') && i.line === 2 && i.severity === 'error',
    )
    expect(bad).toBeTruthy()
  })
})
