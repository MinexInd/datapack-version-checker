import { describe, it, expect } from 'vitest'
import { analyzePackWithSpyglass, hashPack } from '../src/engine/parser-runner'
import type { CacheLike } from '../src/engine/browser-externals'
import type { McmetaVersion } from '../src/engine/types'

/** Minimal in-memory CacheLike for the spike test. */
function createTestCache(): CacheLike {
  const store = new Map<string, Response>()
  return {
    async get(url: string) { return store.get(url) ?? null },
    async put(url: string, response: Response) { store.set(url, response.clone()) },
  }
}

/** Minimal McmetaVersion stub for the target version. */
function stubVersion(name: string): McmetaVersion {
  return {
    id: name,
    name,
    type: 'release',
    stable: true,
    data_pack_version: 48,
    data_pack_version_minor: 0,
    resource_pack_version: 34,
    resource_pack_version_minor: 0,
    data_version: 3955,
    release_time: '2025-06-01T00:00:00Z',
  }
}

describe('parser runner spike', () => {
  it('reports an unknown command in a mcfunction', { timeout: 120_000 }, async () => {
    // The Spyglass mcfunction parser flags syntax errors (e.g. incomplete
    // execute chain). Use a guaranteed parse failure rather than an unknown
    // command, because the parser's command-tree mode may silently accept
    // unknown roots.
    const files = {
      'pack.mcmeta': JSON.stringify({ pack: { pack_format: 48, description: 't' } }),
      'data/demo/functions/hello.mcfunction': 'say hi\n/execute as @s\n',
    }
    const allVersions = [stubVersion('1.21')]
    const results = await analyzePackWithSpyglass(files, allVersions, ['1.21'], createTestCache())
    const issues = results.get('1.21') ?? []
    const bad = issues.find(
      (i) => i.file.endsWith('hello.mcfunction') && i.severity === 'error',
    )
    expect(bad).toBeTruthy()
  })
})

describe('hashPack', () => {
  it('is deterministic for the same input', () => {
    const files = { 'a.mcfunction': 'say hi', 'b.json': '{"x":1}' }
    expect(hashPack(files)).toBe(hashPack(files))
  })

  it('is order-independent', () => {
    const a = { 'x/a.mcfunction': 'hello', 'x/b.json': 'world' }
    const b = { 'x/b.json': 'world', 'x/a.mcfunction': 'hello' }
    expect(hashPack(a)).toBe(hashPack(b))
  })

  it('changes when file content changes', () => {
    const a = { 'data/f.mcfunction': 'say hi' }
    const b = { 'data/f.mcfunction': 'say bye' }
    expect(hashPack(a)).not.toBe(hashPack(b))
  })

  it('changes when a file is added', () => {
    const a = { 'data/f.mcfunction': 'say hi' }
    const b = { 'data/f.mcfunction': 'say hi', 'data/g.json': '{}' }
    expect(hashPack(a)).not.toBe(hashPack(b))
  })
})
