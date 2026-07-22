import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { PackMcmeta, McmetaFormatRange } from './types.js'

export function readPackMcmeta(dir: string): { pack_format: number; supported_formats: McmetaFormatRange | null } {
  const path = join(dir, 'pack.mcmeta')
  const raw = readFileSync(path, 'utf-8')
  const data: PackMcmeta = JSON.parse(raw)

  const pack_format = data.pack.pack_format

  let supported_formats: McmetaFormatRange | null = null
  const sf = data.pack.supported_formats

  if (sf === undefined || sf === null) {
    supported_formats = { min: pack_format, max: pack_format }
  } else if (typeof sf === 'number') {
    supported_formats = { min: sf, max: sf }
  } else if (Array.isArray(sf)) {
    supported_formats = { min: Math.min(...sf), max: Math.max(...sf) }
  } else if (typeof sf === 'object' && 'min_inclusive' in sf && 'max_inclusive' in sf) {
    supported_formats = { min: sf.min_inclusive, max: sf.max_inclusive }
  }

  return { pack_format, supported_formats }
}

export function isPackFormatCompatible(
  packFormat: number,
  supportedFormats: McmetaFormatRange | null,
  versionDataPackVersion: number,
  versionDataPackVersionMinor: number,
): boolean {
  if (!supportedFormats) {
    return packFormat === versionDataPackVersion
  }
  return versionDataPackVersion >= supportedFormats.min && versionDataPackVersion <= supportedFormats.max
}
