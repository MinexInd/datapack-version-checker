export interface MetadataProblem {
  severity: 'error' | 'warning'
  message: string
  detail?: string
}

type PackMetadata = {
  pack?: {
    pack_format?: unknown
    supported_formats?: unknown
  }
}

// These are intentionally broad edition ranges. They are used to catch the
// common case where a resource-pack range is pasted into a datapack (or vice
// versa), without making this small validator a second version database.
const MAX_KNOWN_FORMAT: Record<'datapack' | 'resourcepack', number> = {
  datapack: 48,
  resourcepack: 65,
}

function hasDirectory(files: Record<string, string>, directory: string): boolean {
  return Object.keys(files).some(path => path === directory || path.startsWith(`${directory}/`))
}

function metadataText(files: Record<string, string>): string | undefined {
  for (const path of ['pack.mcmeta', './pack.mcmeta', '/pack.mcmeta']) {
    if (files[path] !== undefined) return files[path]
  }
  return undefined
}

function detectedMode(files: Record<string, string>, mode: 'auto' | 'datapack' | 'resourcepack'):
  'datapack' | 'resourcepack' {
  if (mode !== 'auto') return mode
  return hasDirectory(files, 'data') ? 'datapack' : 'resourcepack'
}

export function validatePackMetadata(
  originalFiles: Record<string, string>,
  mode: 'auto' | 'datapack' | 'resourcepack',
): MetadataProblem[] {
  try {
    const problems: MetadataProblem[] = []
    const text = metadataText(originalFiles)
    if (text === undefined) {
      problems.push({ severity: 'error', message: 'Missing pack.mcmeta at pack root' })
    } else {
      let parsed: PackMetadata = {}
      let parsedSuccessfully = true
      try {
        parsed = JSON.parse(text) as PackMetadata
      } catch (error) {
        parsedSuccessfully = false
        problems.push({
          severity: 'error',
          message: `Invalid JSON in pack.mcmeta: ${error instanceof Error ? error.message : String(error)}`,
        })
        parsed = {}
      }

      const pack = parsedSuccessfully && parsed && typeof parsed === 'object' && parsed.pack && typeof parsed.pack === 'object'
        ? parsed.pack
        : undefined
      const hasLegacyFormat = typeof pack?.pack_format === 'number'
      const hasSupportedFormats = pack?.supported_formats !== undefined
      if (parsedSuccessfully && (!pack || (!hasLegacyFormat && !hasSupportedFormats))) {
        problems.push({ severity: 'error', message: 'pack.mcmeta has no pack_format or supported_formats' })
      }

      if (hasSupportedFormats) {
        const value = pack!.supported_formats
        const range = Array.isArray(value) && value.length === 2
          ? value
          : value && typeof value === 'object'
            ? [(value as { min_inclusive?: unknown }).min_inclusive, (value as { max_inclusive?: unknown }).max_inclusive]
            : null
        if (range) {
          const edition = detectedMode(originalFiles, mode)
          const max = MAX_KNOWN_FORMAT[edition]
          const valid = range.every(v => typeof v === 'number' && Number.isInteger(v) && v >= 1 && v <= max)
          const reversed = typeof range[0] === 'number' && typeof range[1] === 'number' && range[0] > range[1]
          if (!valid || reversed) {
            const likely = edition === 'datapack' ? 'resourcepack' : 'datapack'
            problems.push({
              severity: 'warning',
              message: `Unsupported ${edition} supported_formats range; likely ${likely} format mismatch`,
              detail: `The range does not match known ${edition} pack formats.`,
            })
          }
        }
      }
    }

    if (mode === 'datapack' && !hasDirectory(originalFiles, 'data')) {
      problems.push({ severity: 'warning', message: 'Declared mode datapack but no data/ directory found' })
    } else if (mode === 'resourcepack' && !hasDirectory(originalFiles, 'assets')) {
      problems.push({ severity: 'warning', message: 'Declared mode resourcepack but no assets/ directory found' })
    }
    return problems
  } catch {
    return []
  }
}
