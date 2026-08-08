import type { McmetaVersion } from './types'

// ---------------------------------------------------------------------------
// Version parsing helpers — mirrors the approach in mcdoc-check.ts cmpVer()
// ---------------------------------------------------------------------------

/** Parse "1.21.5", "26.0", etc. into [major, minor, patch]. */
function parseVer(v: string): [number, number, number] | null {
  const m = v.match(/^(\d+)(?:\.(\d+))?(?:\.(\d+))?/)
  if (!m) return null
  return [parseInt(m[1], 10), m[2] ? parseInt(m[2], 10) : 0, m[3] ? parseInt(m[3], 10) : 0]
}

/** True when `v` has a trailing non-numeric suffix after its numeric prefix. */
function hasVersionSuffix(v: string): boolean {
  const m = v.match(/^(\d+(?:\.\d+)*)/)
  if (!m) return false
  return m[0].length < v.trim().length
}

function cmpTriple(a: [number, number, number], b: [number, number, number]): number {
  for (let i = 0; i < 3; i++) {
    if (a[i] !== b[i]) return a[i] < b[i] ? -1 : 1
  }
  return 0
}

// ---------------------------------------------------------------------------
// Map a version name to its data_version using floor semantics.
//
// - Exact match (by name or id): returns that version's data_version.
// - Otherwise, finds the highest known version whose numeric parts are
//   numerically <= the requested version (considering suffix as pre-release
//   which is less than bare).
// - If the requested version is below all known versions, clamps to the
//   lowest known version's data_version (so the gate is never silently
//   disabled).
// - If the requested version is above all known versions, clamps to the
//   highest known version's data_version.
// - Returns null ONLY for completely unparseable strings (no numeric parts)
//   or an empty versions list.
// ---------------------------------------------------------------------------

export function versionNameToDataVersion(
  name: string,
  versions: McmetaVersion[],
): number | null {
  if (versions.length === 0) return null

  // Fast path: exact match
  const exact = versions.find(v => v.name === name || v.id === name)
  if (exact) return exact.data_version

  const reqParsed = parseVer(name)
  if (!reqParsed) return null

  const reqSuffix = hasVersionSuffix(name)

  let best: McmetaVersion | null = null
  let bestParsed: [number, number, number] | null = null
  let bestSuffix = false
  let lowest: McmetaVersion | null = null
  let lowestParsed: [number, number, number] | null = null

  for (const v of versions) {
    const vParsed = parseVer(v.name)
    if (!vParsed) continue

    // Track the lowest known version as fallback (requested may be below all)
    if (!lowestParsed || cmpTriple(vParsed, lowestParsed) < 0) {
      lowest = v
      lowestParsed = vParsed
    } else if (cmpTriple(vParsed, lowestParsed) === 0 && lowest && hasVersionSuffix(lowest.name) && !hasVersionSuffix(v.name)) {
      lowest = v
      lowestParsed = vParsed
    }

    // Check if this known version is <= the requested version
    const numCmp = cmpTriple(vParsed, reqParsed)
    if (numCmp > 0) continue // known version is strictly newer, skip

    if (numCmp === 0) {
      // Same numeric parts: bare > suffixed (pre-release). A bare known
      // version is NOT <= a suffixed request (e.g. "26.1" > "26.0 Snap 1").
      if (!hasVersionSuffix(v.name) && reqSuffix) continue
    }
    // Known version has lower numeric parts, or same numbers with compatible suffix

    const vHasSuffix = hasVersionSuffix(v.name)
    if (!bestParsed) {
      best = v
      bestParsed = vParsed
      bestSuffix = vHasSuffix
      continue
    }

    // Among candidates <= requested, keep the highest
    const cmpBest = cmpTriple(vParsed, bestParsed)
    if (cmpBest > 0) {
      best = v
      bestParsed = vParsed
      bestSuffix = vHasSuffix
    } else if (cmpBest === 0 && bestSuffix && !vHasSuffix) {
      // Same numeric parts: prefer bare (no suffix) over suffixed
      best = v
      bestParsed = vParsed
      bestSuffix = false
    }
  }

  // Floor: if no known version is <= requested, clamp to the lowest known
  return (best ?? lowest)?.data_version ?? null
}
