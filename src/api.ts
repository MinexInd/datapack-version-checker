import type { McmetaVersion, CommandTreeNode } from './types.js'

const BASE = 'https://api.spyglassmc.com/mcje'

export async function fetchVersions(): Promise<McmetaVersion[]> {
  const res = await fetch(`${BASE}/versions`)
  if (!res.ok) throw new Error(`Failed to fetch versions: ${res.status}`)
  return res.json() as Promise<McmetaVersion[]>
}

export async function fetchCommandTree(versionId: string): Promise<CommandTreeNode> {
  const res = await fetch(`${BASE}/versions/${encodeURIComponent(versionId)}/commands`)
  if (!res.ok) throw new Error(`Failed to fetch commands for ${versionId}: ${res.status}`)
  return res.json() as Promise<CommandTreeNode>
}

export async function fetchRegistries(versionId: string): Promise<Record<string, string[]>> {
  const res = await fetch(`${BASE}/versions/${encodeURIComponent(versionId)}/registries`)
  if (!res.ok) throw new Error(`Failed to fetch registries for ${versionId}: ${res.status}`)
  return res.json() as Promise<Record<string, string[]>>
}
