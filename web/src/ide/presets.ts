/**
 * Vanilla recipe presets — fetches the full recipe dataset from the misode/mcmeta
 * CDN and caches it per version. Provides a sorted ID list and individual recipe
 * lookup for the IDE's visual recipe editor.
 */

import type { JsonValue } from './mcdoc-edit'

const CDN_BASE = 'https://cdn.jsdelivr.net/gh/misode/mcmeta'

interface CacheEntry {
  data: Record<string, JsonValue>
}

const cache = new Map<string, CacheEntry>()

function urlFor(version: string): string {
  return `${CDN_BASE}@${version}-summary/data/recipe/data.min.json`
}

async function load(version: string): Promise<Record<string, JsonValue> | null> {
  const cached = cache.get(version)
  if (cached) return cached.data

  try {
    const res = await fetch(urlFor(version))
    if (!res.ok) return null
    const json = await res.json()
    if (json === null || typeof json !== 'object' || Array.isArray(json)) return null
    const entry: CacheEntry = { data: json as Record<string, JsonValue> }
    cache.set(version, entry)
    return entry.data
  } catch {
    return null
  }
}

/**
 * Fetch sorted vanilla recipe IDs for the given game version.
 * Returns [] on network failure or invalid data.
 */
export async function fetchRecipeIds(version: string): Promise<string[]> {
  const data = await load(version)
  if (!data) return []
  return Object.keys(data).sort()
}

/**
 * Fetch a single recipe preset by its ID for the given game version.
 * Returns null on failure or if the ID does not exist.
 */
export async function fetchRecipePreset(version: string, id: string): Promise<JsonValue | null> {
  const data = await load(version)
  if (!data) return null
  const entry = data[id]
  return entry !== undefined ? structuredClone(entry) : null
}
