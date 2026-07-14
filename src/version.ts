import type { McmetaVersion } from './types.js'

/** Map a version name/range string to its data_version using the known versions list */
export function versionNameToDataVersion(
  name: string,
  versions: McmetaVersion[],
): number | null {
  const found = versions.find(v => v.name === name || v.id === name)
  return found ? found.data_version : null
}

/** Check if a version's data_version is >= the data_version of another version name */
export function isVersionAtLeast(
  ver: McmetaVersion,
  minName: string,
  versions: McmetaVersion[],
): boolean {
  const minDv = versionNameToDataVersion(minName, versions)
  if (minDv === null) return true // unknown min version, assume ok
  return ver.data_version >= minDv
}

export function formatReleaseDate(ver: McmetaVersion): string {
  return ver.release_time.slice(0, 10)
}
