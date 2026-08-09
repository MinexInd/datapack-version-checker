import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// fake-indexeddb can't simulate quota/private-mode storage failures, so mock
// the idb-cache module and stub global fetch to exercise the failure paths in
// api.ts directly.
const { createIdbCacheMock, clearIdbCacheMock } = vi.hoisted(() => ({
  createIdbCacheMock: vi.fn(),
  clearIdbCacheMock: vi.fn(),
}))

vi.mock('../src/engine/idb-cache', () => ({
  createIdbCache: createIdbCacheMock,
  clearIdbCache: clearIdbCacheMock,
  API_CACHE_DB: 'test-db',
}))

async function loadApi() {
  vi.resetModules()
  return await import('../src/engine/api')
}

function stubFetch(body: unknown, status = 200, headers: Record<string, string> = {}) {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify(body), { status, headers })))
}

beforeEach(() => {
  createIdbCacheMock.mockReset()
  clearIdbCacheMock.mockReset()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('api fetch failure paths', () => {
  it('returns network data even when cache.put rejects on a fresh fetch', async () => {
    createIdbCacheMock.mockResolvedValue({
      get: async () => null,
      put: async () => { throw new Error('quota exceeded') },
    })
    stubFetch({ ok: true })
    const api = await loadApi()
    await expect(api.fetchVersions()).resolves.toEqual({ ok: true })
  })

  it('returns fresh data when cache.put fails during revalidation (no stale serve)', async () => {
    createIdbCacheMock.mockResolvedValue({
      get: async () => new Response(JSON.stringify({ v: 'stale' }), { status: 200, headers: { etag: '"old"' } }),
      put: async () => { throw new Error('quota exceeded') },
    })
    stubFetch({ v: 'fresh' }, 200, { etag: '"new"' })
    const api = await loadApi()
    await expect(api.fetchVersions()).resolves.toEqual({ v: 'fresh' })
  })

  it('falls back to a fresh fetch when cache.get rejects', async () => {
    createIdbCacheMock.mockResolvedValue({
      get: async () => { throw new Error('idb blocked') },
      put: async () => {},
    })
    stubFetch({ ok: true })
    const api = await loadApi()
    await expect(api.fetchVersions()).resolves.toEqual({ ok: true })
  })

  it('uses a no-op cache when createIdbCache rejects (idb unavailable)', async () => {
    createIdbCacheMock.mockRejectedValue(new Error('idb unavailable'))
    stubFetch({ ok: true })
    const api = await loadApi()
    await expect(api.fetchVersions()).resolves.toEqual({ ok: true })
  })
})