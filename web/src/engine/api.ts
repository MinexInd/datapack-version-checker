import { createIdbCache, clearIdbCache, API_CACHE_DB } from './idb-cache'
import type { CacheLike } from './idb-cache'
import type { McmetaVersion, CommandTreeNode } from './types'

const BASE = 'https://api.spyglassmc.com/mcje'

const nullCache: CacheLike = { get: async () => null, put: async () => {} }

let cachePromise: Promise<CacheLike> | null = null

export function getCache(): Promise<CacheLike> {
  if (!cachePromise) {
    // Fall back to a no-op cache if IndexedDB is unavailable (private mode, etc.)
    cachePromise = createIdbCache(API_CACHE_DB).catch(() => nullCache)
  }
  return cachePromise
}

export async function clearCache(): Promise<void> {
  cachePromise = null
  await clearIdbCache(API_CACHE_DB)
}

// A failed read is a cache miss: never let storage problems block a fetch.
async function safeGet(cache: CacheLike, url: string): Promise<Response | null> {
  try {
    return await cache.get(url)
  } catch {
    return null
  }
}

// A failed write must not fail a fetch that already succeeded over the network.
async function safePut(cache: CacheLike, url: string, res: Response): Promise<void> {
  try {
    await cache.put(url, res)
  } catch {
    // Storage full or blocked: the network result still wins.
  }
}

async function doFetch<T>(url: string, label: string): Promise<T> {
  const cache = await getCache()
  const cached = await safeGet(cache, url)
  const etag = cached?.headers.get('etag') ?? null
  if (cached && etag) {
    // Cache hit with a known ETag: revalidate cheaply instead of re-downloading.
    try {
      const res = await fetch(url, { headers: { 'If-None-Match': etag } })
      if (res.status === 304) {
        // Still fresh: keep serving the cached copy.
        return (await cached.json()) as T
      }
      if (res.ok) {
        await safePut(cache, url, res)
        return (await res.json()) as T
      }
      throw new Error(`${label}: HTTP ${res.status}`)
    } catch {
      // Offline or server hiccup during revalidation: fall back to the cached copy.
      return (await cached.json()) as T
    }
  }
  if (cached) return (await cached.json()) as T

  const res = await fetch(url)
  if (!res.ok) throw new Error(`${label}: HTTP ${res.status}`)
  await safePut(cache, url, res)
  return (await res.json()) as T
}

export async function fetchVersions(): Promise<McmetaVersion[]> {
  return doFetch<McmetaVersion[]>(`${BASE}/versions`, 'versions')
}

export async function fetchCommandTree(versionId: string): Promise<CommandTreeNode> {
  return doFetch<CommandTreeNode>(
    `${BASE}/versions/${encodeURIComponent(versionId)}/commands`,
    `command-tree:${versionId}`,
  )
}

export async function fetchRegistries(versionId: string): Promise<Record<string, string[]>> {
  return doFetch<Record<string, string[]>>(
    `${BASE}/versions/${encodeURIComponent(versionId)}/registries`,
    `registries:${versionId}`,
  )
}