/**
 * Unified Fix Preview V2 data model and converters.
 */

export interface FixFileChange {
  file: string
  before: string
  after: string
  reason: string
  confidence: 'high' | 'medium' | 'low'
  skipped?: boolean
  skipReason?: string
}

export interface FixPreviewV2 {
  version: string
  changes: FixFileChange[]
  skipped: { file: string; reason: string }[]
  summary: string
}

export interface FixPreviewLike {
  results?: Array<{
    file: string
    patches?: number
    details?: string[]
  }>
  summary?: {
    filesFixed?: number
    totalPatches?: number
    errors?: string[]
  }
  plan?: {
    sourceVersion?: string
    targetVersion?: string
    direction?: 'forward' | 'backward'
    rewrites?: Array<{ id?: string; description?: string; count?: number; files?: string[] }>
    jsonFixes?: Array<{ type?: string; count?: number; files?: string[] }>
    manualAttention?: Array<{ description?: string; reason?: string; files?: string[] }>
    cascadeEffects?: Array<{ description?: string; affectedFiles?: string[] }>
    skippedFiles?: Array<{ file: string; registry?: string; reason?: string }>
    summary?: {
      totalFilesToPatch?: number
      commandRewrites?: number
      jsonFixes?: number
      manualAttention?: number
      skippedFiles?: number
      mcdocRemovals?: number
      packMcmetaUpdate?: boolean
    }
  }
  isRp?: boolean
  outputFiles?: Record<string, string>
  files?: Record<string, string>
  skipped?: Array<{ file: string; reason: string }>
  revision?: number
}

/**
 * Assigns a confidence score based on deterministic heuristics:
 * - 'high': Deterministic mechanical format and registry changes (pack.mcmeta format bumps,
 *   JSON schema renames / structural migrations without manual flags).
 * - 'low': Changes flagged for manual attention, warnings, or potential breaking semantics.
 * - 'medium': Standard command rewrites, macro updates, and general porting transformations.
 */
function determineConfidence(
  file: string,
  details: string[],
  plan?: FixPreviewLike['plan']
): 'high' | 'medium' | 'low' {
  // pack.mcmeta format bump is always high confidence mechanical change
  if (file === 'pack.mcmeta' || file.endsWith('/pack.mcmeta')) {
    return 'high'
  }

  // Low confidence if manual attention required or details indicate errors/warnings
  const hasManualFlag =
    plan?.manualAttention?.some(m => m.files?.includes(file)) ||
    details.some(d => {
      const lower = d.toLowerCase()
      return (
        lower.includes('manual') ||
        lower.includes('attention') ||
        lower.includes('warning') ||
        lower.includes('error') ||
        lower.includes('unsupported')
      )
    })

  if (hasManualFlag) {
    return 'low'
  }

  // High confidence if it's a mechanical JSON fix or registry/format rename
  const isJsonFix = plan?.jsonFixes?.some(j => j.files?.includes(file))
  const isMechanicalDetail = details.some(d => {
    const lower = d.toLowerCase()
    return (
      lower.includes('pack_format') ||
      lower.includes('registry') ||
      lower.includes('field rename') ||
      lower.includes('icon format') ||
      lower.includes('biome field') ||
      lower.includes('predicate')
    )
  })

  if (isJsonFix || isMechanicalDetail) {
    return 'high'
  }

  // Default to medium confidence for command syntax rewrites and standard translations
  return 'medium'
}

/**
 * Derives a human-readable reason for why a file is being modified.
 */
function deriveReason(
  file: string,
  details: string[],
  plan?: FixPreviewLike['plan'],
  targetVersion?: string
): string {
  if (details.length > 0) {
    // Clean and condense details
    const cleanDetails = details.map(d => d.replace(/^[^:]+:\d+:\s*/, '').trim()).filter(Boolean)
    if (cleanDetails.length > 0) {
      return cleanDetails.slice(0, 2).join('; ')
    }
  }

  if (file === 'pack.mcmeta' || file.endsWith('/pack.mcmeta')) {
    return targetVersion ? `Update pack format (pack_format) for ${targetVersion}` : 'Update pack format (pack_format) version'
  }

  if (plan?.manualAttention) {
    const manual = plan.manualAttention.find(m => m.files?.includes(file))
    if (manual) {
      return manual.reason || manual.description || 'Manual porting attention required'
    }
  }

  if (plan?.rewrites) {
    const rw = plan.rewrites.find(r => r.files?.includes(file))
    if (rw) {
      return rw.description || 'Command syntax rewrite'
    }
  }

  if (plan?.jsonFixes) {
    const jf = plan.jsonFixes.find(j => j.files?.includes(file))
    if (jf) {
      return jf.type ? `JSON format update (${jf.type})` : 'JSON structure format update'
    }
  }

  return targetVersion ? `Port to ${targetVersion}` : 'Version compatibility port'
}

/**
 * Pure function to map a legacy FixPreview and workspace file contents
 * to a structured FixPreviewV2 with before/after diffs, reasons, and confidence.
 */
export function toFixPreviewV2(
  preview: FixPreviewLike | null | undefined,
  files: Record<string, string> = {}
): FixPreviewV2 {
  if (!preview) {
    return {
      version: '',
      changes: [],
      skipped: [],
      summary: 'No fix preview available',
    }
  }

  const version = preview.plan?.targetVersion || ''
  const outputFiles = preview.outputFiles ?? preview.files ?? {}

  // Collect skipped files
  const skipped: { file: string; reason: string }[] = []
  const skippedFilesMap = new Map<string, string>()

  if (preview.plan?.skippedFiles) {
    for (const s of preview.plan.skippedFiles) {
      const reason = s.reason || (s.registry ? `Skipped unsupported registry "${s.registry}"` : 'Skipped file')
      skipped.push({ file: s.file, reason })
      skippedFilesMap.set(s.file, reason)
    }
  }

  if (preview.skipped) {
    for (const s of preview.skipped) {
      if (!skippedFilesMap.has(s.file)) {
        skipped.push({ file: s.file, reason: s.reason })
        skippedFilesMap.set(s.file, s.reason)
      }
    }
  }

  // Identify all changed files
  const changedFilesSet = new Set<string>()

  // 1. Files from preview results
  if (preview.results) {
    for (const r of preview.results) {
      if (r.file) changedFilesSet.add(r.file)
    }
  }

  // 2. Files with differing output contents
  for (const [file, outContent] of Object.entries(outputFiles)) {
    if (outContent !== files[file]) {
      changedFilesSet.add(file)
    }
  }

  // 3. Files in rewrites / jsonFixes plans
  if (preview.plan?.rewrites) {
    for (const rw of preview.plan.rewrites) {
      for (const f of rw.files || []) changedFilesSet.add(f)
    }
  }
  if (preview.plan?.jsonFixes) {
    for (const jf of preview.plan.jsonFixes) {
      for (const f of jf.files || []) changedFilesSet.add(f)
    }
  }

  // 4. Skipped files
  for (const sf of skippedFilesMap.keys()) {
    changedFilesSet.add(sf)
  }

  const changes: FixFileChange[] = []

  for (const file of changedFilesSet) {
    const before = files[file] ?? ''
    const after = outputFiles[file] !== undefined ? outputFiles[file] : before
    const res = preview.results?.find(r => r.file === file)
    const details = res?.details ?? []

    const isSkipped = skippedFilesMap.has(file)
    const skipReason = skippedFilesMap.get(file)

    const reason = deriveReason(file, details, preview.plan, version)
    const confidence = determineConfidence(file, details, preview.plan)

    changes.push({
      file,
      before,
      after,
      reason,
      confidence,
      ...(isSkipped ? { skipped: true, skipReason } : {}),
    })
  }

  // Sort changes by file path
  changes.sort((a, b) => a.file.localeCompare(b.file))

  // Build summary message
  const totalPatches = preview.summary?.totalPatches ?? changes.length
  const filesFixed = preview.summary?.filesFixed ?? changes.length
  let summary = `${filesFixed} file${filesFixed === 1 ? '' : 's'} changed (${totalPatches} patch${totalPatches === 1 ? '' : 'es'})`
  if (version) {
    summary += ` for ${version}`
  }
  if (preview.summary?.errors && preview.summary.errors.length > 0) {
    summary += ` with ${preview.summary.errors.length} error(s)`
  }

  return {
    version,
    changes,
    skipped,
    summary,
  }
}
