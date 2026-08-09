import { describe, it, expect } from 'vitest'
import { createBrowserExternals } from '../src/engine/browser-externals'

describe('browser externals', () => {
  it('decompresses a gzipped tar into DecompressedFile entries', async () => {
    // Build a tiny tar.gz in-memory: one file "data/foo.txt" with content "hi"
    // Use the same tar+gunzip helpers the web app already has in
    // web/src/engine/mcdoc-check.ts (lines ~94-126) — extract them into a
    // shared module `web/src/engine/tar.ts` (export gunzipBytes + parseTar)
    // and reuse here to CREATE the fixture, then decompressBall must round-trip.
    const { createTarGzFixture } = await import('./fixtures/tar-fixture')
    const ext = createBrowserExternals({ get: async () => null, put: async () => {} } as any)
    const files = await ext.archive.decompressBall(await createTarGzFixture(), { stripLevel: 0 })
    expect(files.length).toBe(1)
    expect(files[0].path).toBe('data/foo.txt')
    expect(new TextDecoder().decode(files[0].data)).toBe('hi')
  })

  it('error helpers mirror NodeJsExternals behavior', () => {
    const ext = createBrowserExternals({ get: async () => null, put: async () => {} } as any)
    const err = ext.error.createKind('network', 'boom')
    expect(ext.error.isKind(err, 'network')).toBe(true)
    expect(ext.error.isKind(err, 'other')).toBe(false)
  })
})