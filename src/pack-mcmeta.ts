import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { PackMcmeta, McmetaFormatRange } from './types.js'

export type FormatTuple = [number, number]

// 25w31a+ (1.21.9) format range values are [major, minor] tuples. Bare ints
// mean "any minor" (0 for min, MAX_INT for max), and MCreator writes integral
// floats like 101.1, so truncate leniently. Anything else is unparseable.
export function normalizeFormatTuple(value: unknown): FormatTuple | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return [Math.trunc(value), 0]
  }
  if (Array.isArray(value)) {
    const [major, minor] = value
    if (typeof major === 'number' && Number.isFinite(major)) {
      if (minor === undefined) return [Math.trunc(major), 0]
      if (typeof minor === 'number' && Number.isFinite(minor)) {
        return [Math.trunc(major), Math.trunc(minor)]
      }
    }
  }
  return null
}

export function readPackMcmeta(dir: string): {
  pack_format: number | undefined
  supported_formats: McmetaFormatRange | null
  min_format: FormatTuple | null
  max_format: FormatTuple | null
} {
  const path = join(dir, 'pack.mcmeta')
  const raw = readFileSync(path, 'utf-8')
  const data: PackMcmeta = JSON.parse(raw)

  if (!data.pack) {
    // No pack key at all: return the same null-safe shape as new-style packs
    // instead of fabricating legacy pack_format values.
    return { pack_format: undefined, supported_formats: null, min_format: null, max_format: null }
  }

  const pack_format = data.pack.pack_format

  let supported_formats: McmetaFormatRange | null = null
  const sf = data.pack.supported_formats

  if (sf === undefined || sf === null) {
    // New-style packs (25w31a+) omit both pack_format and supported_formats;
    // return null so callers fall back to min_format/max_format resolution.
    supported_formats = Number.isFinite(pack_format) ? { min: pack_format, max: pack_format } : null
  } else if (typeof sf === 'number') {
    supported_formats = { min: sf, max: sf }
  } else if (Array.isArray(sf)) {
    if (sf.length === 0) {
      supported_formats = Number.isFinite(pack_format) ? { min: pack_format, max: pack_format } : null
    } else {
      supported_formats = { min: Math.min(...sf), max: Math.max(...sf) }
    }
  } else if (typeof sf === 'object' && 'min_inclusive' in sf && 'max_inclusive' in sf) {
    supported_formats = { min: sf.min_inclusive, max: sf.max_inclusive }
  }

  return {
    pack_format,
    supported_formats,
    min_format: normalizeFormatTuple(data.pack.min_format),
    max_format: normalizeFormatTuple(data.pack.max_format),
  }
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
