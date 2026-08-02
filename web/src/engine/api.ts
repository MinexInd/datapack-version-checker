import { getCache, setCache, getCachedEtag, setCachedEtag } from './cache'
import type { McmetaVersion, CommandTreeNode } from './types'

const BASE = 'https://api.spyglassmc.com/mcje'

async function doFetch<T>(url: string, cacheKey: string, label: string): Promise<T> {
  const cached = getCache<T>(cacheKey)
  const etag = getCachedEtag(cacheKey)
  if (cached && etag) {
    // Cache hit with a known ETag: revalidate cheaply instead of re-downloading.
    try {
      const res = await fetch(url, { headers: { 'If-None-Match': etag } })
      if (res.status === 304) {
        // Still fresh: bump the TTL and keep serving the cached copy.
        setCache(cacheKey, cached)
        setCachedEtag(cacheKey, etag)
        return cached
      }
      if (res.ok) {
        const data = (await res.json()) as T
        setCache(cacheKey, data)
        setCachedEtag(cacheKey, res.headers.get('etag'))
        return data
      }
      throw new Error(`${label}: HTTP ${res.status}`)
    } catch {
      // Offline or server hiccup during revalidation: fall back to the cached copy.
      return cached
    }
  }
  if (cached) return cached

  const res = await fetch(url)
  if (!res.ok) throw new Error(`${label}: HTTP ${res.status}`)
  const data = (await res.json()) as T
  setCache(cacheKey, data)
  setCachedEtag(cacheKey, res.headers.get('etag'))
  return data
}

export async function fetchVersions(): Promise<McmetaVersion[]> {
  return doFetch<McmetaVersion[]>(`${BASE}/versions`, 'mcje_versions', 'versions')
}

export async function fetchCommandTree(versionId: string): Promise<CommandTreeNode> {
  return doFetch<CommandTreeNode>(
    `${BASE}/versions/${encodeURIComponent(versionId)}/commands`,
    'mcje_commands_' + versionId,
    `command-tree:${versionId}`,
  )
}

export async function fetchRegistries(versionId: string): Promise<Record<string, string[]>> {
  return doFetch<Record<string, string[]>>(
    `${BASE}/versions/${encodeURIComponent(versionId)}/registries`,
    'mcje_registries_' + versionId,
    `registries:${versionId}`,
  )
}
