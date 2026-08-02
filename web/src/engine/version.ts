import type { McmetaVersion } from './types'

export function versionNameToDataVersion(
  name: string,
  versions: McmetaVersion[],
): number | null {
  const found = versions.find(v => v.name === name || v.id === name)
  return found ? found.data_version : null
}
