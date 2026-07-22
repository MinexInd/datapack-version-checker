import type { McmetaVersion } from './types'

export function versionNameToDataVersion(
  name: string,
  versions: McmetaVersion[],
): number | null {
  const found = versions.find(v => v.name === name || v.id === name)
  return found ? found.data_version : null
}

export function isVersionAtLeast(
  ver: McmetaVersion,
  minName: string,
  versions: McmetaVersion[],
): boolean {
  const minDv = versionNameToDataVersion(minName, versions)
  if (minDv === null) return true
  return ver.data_version >= minDv
}

export function formatReleaseDate(ver: McmetaVersion): string {
  return ver.release_time.slice(0, 10)
}
