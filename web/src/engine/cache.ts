import { clearIdbCache, API_CACHE_DB } from './idb-cache'

const _cache = new Map<string, { data: any; expiry: number; etag: string | null }>()
const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000

export async function clearCache(): Promise<void> {
  _cache.clear()
  await clearIdbCache(API_CACHE_DB)
}

export function getCache<T>(key: string, ttlMs: number = DEFAULT_TTL_MS): T | null {
  const entry = _cache.get(key)
  if (!entry) return null
  if (Date.now() > entry.expiry) {
    _cache.delete(key)
    return null
  }
  return entry.data as T
}

export function setCache<T>(key: string, value: T): void {
  _cache.set(key, { data: value, expiry: Date.now() + DEFAULT_TTL_MS, etag: null })
}

export function getCachedEtag(key: string): string | null {
  return _cache.get(key)?.etag ?? null
}

export function setCachedEtag(key: string, etag: string | null): void {
  const entry = _cache.get(key)
  if (entry) entry.etag = etag
}
