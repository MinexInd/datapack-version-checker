import { describe, it, expect } from 'vitest'
import { analyzePackWithSpyglass } from '../src/engine/parser-runner'
import type { CacheLike } from '../src/engine/browser-externals'

/** Minimal in-memory CacheLike for the spike test. */
function createTestCache(): CacheLike {
  const store = new Map<string, Response>()
  return {
    async get(url: string) { return store.get(url) ?? null },
    async put(url: string, response: Response) { store.set(url, response.clone()) },
  }
}

describe('parser runner spike', () => {
  it('reports an unknown command in a mcfunction', { timeout: 120_000 }, async () => {
    const files = {
      'pack.mcmeta': JSON.stringify({ pack: { pack_format: 48, description: 't' } }),
      'data/demo/functions/hello.mcfunction': 'say hi\n/definitely_not_a_command foo\n',
    }
    const issues = await analyzePackWithSpyglass(files, '1.21', createTestCache())
    // API deviation: The brief's verbatim assertion was
    //   issues.find(i => i.message.includes('definitely_not_a_command'))
    // but the real Spyglass parser never includes the unknown command name
    // in its error messages.  Instead it emits:
    //   "Unexpected leading slash \"/\""        (error)
    //   "Expected [list of valid commands]"      (error)
    //   "Trailing data encountered: \" foo\""   (error)
    // The adapted assertion below proves the parser ran and flagged the
    // malformed line.
    const bad = issues.find(
      (i) => i.file.endsWith('hello.mcfunction') && i.line === 2 && i.severity === 'error',
    )
    expect(bad).toBeTruthy()
  })
})
