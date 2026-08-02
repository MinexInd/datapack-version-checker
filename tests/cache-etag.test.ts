import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { existsSync, rmSync, statSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { getCache, setCache, getCachedEtag, setCachedEtag } from '../src/cache.js'
import { fetchVersions } from '../src/api.js'
import type { McmetaVersion } from '../src/types.js'

// ---------------------------------------------------------------------------
// ETag revalidation (src/api.ts doFetch + src/cache.ts etag sidecar).
//
// fetchVersions is the real function; only the network is mocked. The cache
// lives in the shared tmpdir dpcheck-cache dir, so this suite cleans up its
// own keys (mcje_versions.*) before and after every test and never touches
// other keys (e.g. mcdoc_symbols.json used by the mcdoc integration tests).
// ---------------------------------------------------------------------------

const CACHE_DIR = join(tmpdir(), 'dpcheck-cache')
const VERSIONS_FILE = join(CACHE_DIR, 'mcje_versions.json')
const VERSIONS_ETAG = join(CACHE_DIR, 'mcje_versions.etag')

const FIXTURE: McmetaVersion[] = [
  {
    id: '1.21',
    name: '1.21',
    type: 'release',
    stable: true,
    data_pack_version: 57,
    data_pack_version_minor: 0,
    resource_pack_version: 34,
    resource_pack_version_minor: 0,
    data_version: 4082,
    release_time: '2024-06-13T00:00:00Z',
  },
]

const FRESH: McmetaVersion[] = [
  {
    id: '26.1',
    name: '26.1',
    type: 'release',
    stable: true,
    data_pack_version: 101,
    data_pack_version_minor: 0,
    resource_pack_version: 70,
    resource_pack_version_minor: 0,
    data_version: 9000,
    release_time: '2026-01-01T00:00:00Z',
  },
]

function cleanKeys(): void {
  try { rmSync(VERSIONS_FILE, { force: true }) } catch { /* best-effort */ }
  try { rmSync(VERSIONS_ETAG, { force: true }) } catch { /* best-effort */ }
}

function mockResponse(status: number, body?: unknown, etag?: string) {
  return {
    status,
    ok: status >= 200 && status < 300,
    json: async () => body,
    headers: { get: (name: string) => (name.toLowerCase() === 'etag' ? etag ?? null : null) },
  }
}

beforeEach(() => {
  if (!existsSync(CACHE_DIR)) mkdirSync(CACHE_DIR, { recursive: true })
  cleanKeys()
})

afterEach(() => {
  vi.unstubAllGlobals()
  cleanKeys()
})

describe('api ETag revalidation', () => {
  it('revalidates a cached payload with If-None-Match on 304 and refreshes the TTL', async () => {
    setCache('mcje_versions', FIXTURE)
    setCachedEtag('mcje_versions', '"v1"')

    const fetchMock = vi.fn(async () => mockResponse(304))
    vi.stubGlobal('fetch', fetchMock)

    const result = await fetchVersions()
    expect(result).toEqual(FIXTURE)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toContain('/mcje/versions')
    expect((init.headers as Record<string, string>)['If-None-Match']).toBe('"v1"')

    // The 304 path rewrites the cache file to bump its mtime (TTL refresh).
    expect(existsSync(VERSIONS_FILE)).toBe(true)
    expect(Date.now() - statSync(VERSIONS_FILE).mtimeMs).toBeLessThan(5000)
    expect(getCachedEtag('mcje_versions')).toBe('"v1"')
  })

  it('stores the fresh payload and new ETag when revalidation returns 200', async () => {
    setCache('mcje_versions', FIXTURE)
    setCachedEtag('mcje_versions', '"v1"')

    const fetchMock = vi.fn(async () => mockResponse(200, FRESH, '"v2"'))
    vi.stubGlobal('fetch', fetchMock)

    const result = await fetchVersions()
    expect(result).toEqual(FRESH)
    expect(getCache('mcje_versions')).toEqual(FRESH)
    expect(getCachedEtag('mcje_versions')).toBe('"v2"')
  })

  it('falls back to the cached payload when revalidation fails', async () => {
    setCache('mcje_versions', FIXTURE)
    setCachedEtag('mcje_versions', '"v1"')

    const fetchMock = vi.fn(async () => { throw new Error('network down') })
    vi.stubGlobal('fetch', fetchMock)

    const result = await fetchVersions()
    expect(result).toEqual(FIXTURE)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('uses the cached payload without any network call when no ETag is stored', async () => {
    setCache('mcje_versions', FIXTURE)
    expect(getCachedEtag('mcje_versions')).toBeNull()

    const fetchMock = vi.fn(async () => { throw new Error('should not be called') })
    vi.stubGlobal('fetch', fetchMock)

    const result = await fetchVersions()
    expect(result).toEqual(FIXTURE)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('fetches on a cache miss and stores payload + ETag', async () => {
    const fetchMock = vi.fn(async () => mockResponse(200, FIXTURE, '"v1"'))
    vi.stubGlobal('fetch', fetchMock)

    const result = await fetchVersions()
    expect(result).toEqual(FIXTURE)
    expect(getCache('mcje_versions')).toEqual(FIXTURE)
    expect(getCachedEtag('mcje_versions')).toBe('"v1"')
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toContain('/mcje/versions')
    expect(init?.headers).toBeUndefined() // plain miss: no conditional headers
  })
})
