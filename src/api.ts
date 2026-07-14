import { getCache, setCache } from './cache.js'
import type { McmetaVersion, CommandTreeNode } from './types.js'

const BASE = 'https://api.spyglassmc.com/mcje'

export async function fetchVersions(): Promise<McmetaVersion[]> {
  const cached = getCache<McmetaVersion[]>('mcje_versions')
  if (cached) return cached
  const res = await fetch(`${BASE}/versions`)
  if (!res.ok) throw new Error(`Failed to fetch versions: ${res.status}`)
  const data = (await res.json()) as McmetaVersion[]
  setCache('mcje_versions', data)
  return data
}

export async function fetchCommandTree(versionId: string): Promise<CommandTreeNode> {
  const key = 'mcje_commands_' + versionId
  const cached = getCache<CommandTreeNode>(key)
  if (cached) return cached
  const res = await fetch(`${BASE}/versions/${encodeURIComponent(versionId)}/commands`)
  if (!res.ok) throw new Error(`Failed to fetch commands for ${versionId}: ${res.status}`)
  const data = (await res.json()) as CommandTreeNode
  setCache(key, data)
  return data
}

export async function fetchRegistries(versionId: string): Promise<Record<string, string[]>> {
  const key = 'mcje_registries_' + versionId
  const cached = getCache<Record<string, string[]>>(key)
  if (cached) return cached
  const res = await fetch(`${BASE}/versions/${encodeURIComponent(versionId)}/registries`)
  if (!res.ok) throw new Error(`Failed to fetch registries for ${versionId}: ${res.status}`)
  const data = (await res.json()) as Record<string, string[]>
  setCache(key, data)
  return data
}
