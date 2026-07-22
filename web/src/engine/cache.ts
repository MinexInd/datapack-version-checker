const _cache = new Map<string, { data: any; expiry: number }>()
const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000

export function clearCache(): void {
  _cache.clear()
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
  _cache.set(key, { data: value, expiry: Date.now() + DEFAULT_TTL_MS })
}
