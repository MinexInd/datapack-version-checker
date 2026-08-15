import { createIdbCache, clearIdbCache, API_CACHE_DB } from './idb-cache'
import type { CacheLike } from './idb-cache'
import type { McmetaVersion, CommandTreeNode } from './types'

/**
 * Data source: misode/mcmeta via jsDelivr CDN.
 * CORS-enabled (Access-Control-Allow-Origin: *), no server-side proxy needed.
 * The SpyglassMC API (api.spyglassmc.com) has intermittent CORS issues —
 * its BunnyCDN origin sometimes returns 502 without CORS headers, and
 * OPTIONS preflight consistently fails. jsDelivr serves the same data
 * directly from GitHub with proper CORS support.
 */
const VERSIONS_URL = 'https://cdn.jsdelivr.net/gh/misode/mcmeta@summary/versions/data.json'
function registriesUrl(versionId: string): string {
  return `https://cdn.jsdelivr.net/gh/misode/mcmeta@${versionId}-summary/registries/data.json`
}
function commandsUrl(versionId: string): string {
  return `https://cdn.jsdelivr.net/gh/misode/mcmeta@${versionId}-summary/commands/data.json`
}

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
  return doFetch<McmetaVersion[]>(VERSIONS_URL, 'versions')
}

export async function fetchCommandTree(versionId: string): Promise<CommandTreeNode> {
  return doFetch<CommandTreeNode>(commandsUrl(versionId), `command-tree:${versionId}`)
}

export async function fetchRegistries(versionId: string): Promise<Record<string, string[]>> {
  return doFetch<Record<string, string[]>>(registriesUrl(versionId), `registries:${versionId}`)
}