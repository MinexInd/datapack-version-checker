import { getCache, setCache } from './cache.js'
import { getLogger } from './logger.js'
import type { McmetaVersion, CommandTreeNode } from './types.js'

const BASE = 'https://api.spyglassmc.com/mcje'

const log = getLogger().child('api')

async function doFetch<T>(url: string, cacheKey: string, label: string): Promise<T> {
  const cached = getCache<T>(cacheKey)
  if (cached) {
    log.debug(`Cache HIT ${label}`)
    return cached
  }
  log.debug(`Cache MISS ${label} — fetching ${url}`)
  const res = await fetch(url)
  if (!res.ok) throw new Error(`${label}: HTTP ${res.status}`)
  const data = (await res.json()) as T
  setCache(cacheKey, data)
  log.debug(`Fetched ${label} (${Array.isArray(data) ? data.length : 'object'} items)`)
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
