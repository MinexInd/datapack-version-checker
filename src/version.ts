import type { McmetaVersion } from './types.js'

/** Map a version name/range string to its data_version using the known versions list */
export function versionNameToDataVersion(
  name: string,
  versions: McmetaVersion[],
): number | null {
  const found = versions.find(v => v.name === name || v.id === name)
  return found ? found.data_version : null
}
