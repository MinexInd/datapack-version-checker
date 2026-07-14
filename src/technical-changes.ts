import { getCache, setCache } from './cache.js'
import type { McmetaVersion } from './types.js'

const REPO = 'misode/technical-changes'
const RAW = `https://raw.githubusercontent.com/${REPO}/main`
const TREE_API = `https://api.github.com/repos/${REPO}/git/trees/main?recursive=1`

export interface ChangeEntry {
  releaseFolder: string
  snapId: string
  tags: string[]
  content: string
}

function parseFile(content: string, releaseFolder: string, snapId: string): ChangeEntry[] {
  const out: ChangeEntry[] = []
  let current: ChangeEntry | null = null
  for (const raw of content.split('\n')) {
    const line = raw.trim()
    if (!line) {
      current = null
      continue
    }
    // Continuation bullet of the previous change
    if (line.startsWith('*')) {
      if (current) current.content += '\n' + line
      continue
    }
    // Strip leading edit markers (- / +) used inside bullets
    const body = line.replace(/^[-+]\s*/, '')
    const pipe = body.indexOf('|')
    if (pipe === -1) {
      current = null
      continue
    }
    const tags = body.slice(0, pipe).trim().split(/\s+/).filter(Boolean)
    const text = body.slice(pipe + 1).trim()
    current = { releaseFolder, snapId, tags, content: text }
    out.push(current)
  }
  return out
}

async function fetchTreePaths(): Promise<string[]> {
  const cached = getCache<string[]>('tc_tree')
  if (cached) return cached
  const res = await fetch(TREE_API, { headers: { 'User-Agent': 'dpcheck' } })
  if (!res.ok) throw new Error(`technical-changes tree ${res.status}`)
  const data = await res.json()
  const paths = (data.tree ?? [])
    .filter((e: { path?: string; type?: string }) => e.type === 'blob' && e.path?.endsWith('.md'))
    .map((e: { path: string }) => e.path)
  setCache('tc_tree', paths)
  return paths
}

async function fetchMd(path: string): Promise<string> {
  const cached = getCache<string>('tc_' + path)
  if (cached !== null) return cached
  const res = await fetch(`${RAW}/${path}`, { headers: { 'User-Agent': 'dpcheck' } })
  if (!res.ok) throw new Error(`technical-changes file ${path} ${res.status}`)
  const text = await res.text()
  setCache('tc_' + path, text)
  return text
}

/**
 * Returns breaking changes per checked version, keyed by the version name.
 * Each entry is a human-readable note of a change that can break a datapack
 * when updating to that version. Data is pulled live from misode/technical-changes.
 */
export async function getBreakingChanges(
  versions: McmetaVersion[],
): Promise<Record<string, string[]>> {
  const result: Record<string, string[]> = {}
  for (const v of versions) result[v.name] = []

  let paths: string[]
  try {
    paths = await fetchTreePaths()
  } catch {
    return result // Feature degrades gracefully if the API is unreachable.
  }

  // Map each checked version to the markdown files that apply to it.
  const needed = new Map<string, string[]>() // md path -> list of version names
  for (const v of versions) {
    for (const p of paths) {
      const slash = p.indexOf('/')
      if (slash === -1) continue
      const folder = p.slice(0, slash)
      const snapId = p.slice(slash + 1).replace(/\.md$/, '')
      if (folder === v.name || snapId === v.name) {
        const list = needed.get(p) ?? []
        list.push(v.name)
        needed.set(p, list)
      }
    }
  }

  for (const [path, versionNames] of needed) {
    const slash = path.indexOf('/')
    const folder = path.slice(0, slash)
    const snapId = path.slice(slash + 1).replace(/\.md$/, '')
    try {
      const content = await fetchMd(path)
      const entries = parseFile(content, folder, snapId).filter(
        e => e.tags.includes('breaking') && !e.tags.includes('obsolete'),
      )
      for (const e of entries) {
        const note = `[${snapId}] ${e.content}`
        for (const vn of versionNames) {
          result[vn].push(note)
        }
      }
    } catch {
      // Skip a single unreachable file; never fail the whole check.
    }
  }

  for (const v of versions) {
    if (result[v.name].length === 0) delete result[v.name]
  }
  return result
}
