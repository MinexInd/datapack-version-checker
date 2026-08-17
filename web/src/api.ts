import { fetchVersions as engineFetchVersions } from './engine/api'
import { checkCompatibilityContentBased, checkResourcePack } from './engine/engine'
import { fixDatapack, fixResourcePack } from './engine/fixer'
import type { PackFileMap as EngineFileMap } from './engine/engine'
import type { AnalysisResult } from './engine/analyzer'

export type { AnalysisResult }
import JSZip from 'jszip'

export type PackFileMap = Record<string, string>

export type Mode = 'auto' | 'datapack' | 'resourcepack'

export interface McmetaVersion {
  id: string
  name: string
  type: 'release' | 'snapshot'
  stable: boolean
  data_pack_version: number
  data_pack_version_minor: number
  resource_pack_version: number
  resource_pack_version_minor: number
  data_version: number
  release_time: string
}

export interface McfunctionIssue {
  file: string
  line: number
  command: string
  issue: string
  snippet?: string
  suggestion?: string
  autoFixable?: boolean
}

export interface RegistryIssue {
  file: string
  registry: string
  entry: string
  issue: string
  suggestion?: string
  autoFixable?: boolean
}

export interface StructuralIssue {
  file: string
  issue: string
  source?: 'mcdoc' | 'format'
  suggestion?: string
  autoFixable?: boolean
}

export interface RegistryDeprecation {
  file: string
  registry: string
  entry: string
  issue: string
  suggestion?: string
  autoFixable?: boolean
}

export interface ReferenceIssue {
  file: string
  line?: number
  reference: string
  type: string
  issue: string
  code?: string
}

export interface FeatureRule {
  id: string
  description: string
  type: 'command' | 'command_pattern' | 'registry' | 'json_field' | 'function_macro'
  match: string
  minVersion: string
  maxVersion?: string
  fix?: string
  note?: string
}

export interface KnowledgeHit {
  rule: FeatureRule
  file?: string
  line?: number
  text?: string
}

export interface VersionCompatibility {
  version: McmetaVersion
  pack_format_match: 'exact' | 'supported_range' | 'none'
  status?: 'compatible' | 'content_issues' | 'below_min' | 'outside_load_range'
  in_load_range?: boolean
  mcfunction_issues: McfunctionIssue[]
  registry_issues: RegistryIssue[]
  structural_issues?: StructuralIssue[]
  deprecation_issues?: RegistryDeprecation[]
  reference_issues?: ReferenceIssue[]
  breaking_changes?: string[]
  parserActive?: boolean
}

export interface LoadRange {
  min: number
  max: number
  min_name: string | null
  max_name: string | null
}

export interface CheckResult {
  target_version_id: string
  pack_format: number
  versions_checked: number
  compatible: VersionCompatibility[]
  incompatible: VersionCompatibility[]
  min_version: string | null
  knowledge_hits: KnowledgeHit[]
  load_range: LoadRange | null
  analysis: AnalysisResult | null
}

export interface CheckRequest {
  mode: Mode
  versions?: string[]
  all: boolean
  strict: boolean
  files: PackFileMap
  onProgress?: ProgressCallback
  /** Workspace revision the files were captured at (provenance). */
  revision?: number
}

export type ProgressCallback = (msg: string) => void

export interface CheckResponse {
  result: CheckResult
  mode: string
  /** Revision the check was run against, echoed back for staleness checks. */
  revision?: number
}

export interface FixRequest {
  files: PackFileMap
  targetVersion: string
  sourceVersion?: string
  /** Workspace revision the files were captured at (provenance). */
  revision?: number
}

export interface FixFileDetail {
  file: string
  patches: number
  details: string[]
}

export interface FixSummary {
  filesFixed: number
  totalPatches: number
  errors: string[]
}

export interface FixPlan {
  sourceVersion: string
  targetVersion: string
  direction: 'forward' | 'backward'
  rewrites: { id: string; description: string; count: number; files: string[] }[]
  jsonFixes: { type: string; count: number; files: string[] }[]
  manualAttention: { description: string; reason: string; files: string[] }[]
  cascadeEffects: { description: string; affectedFiles: string[] }[]
  summary: {
    totalFilesToPatch: number
    commandRewrites: number
    jsonFixes: number
    manualAttention: number
    mcdocRemovals: number
    packMcmetaUpdate: boolean
  }
}

export interface FixPreview {
  results: FixFileDetail[]
  summary: FixSummary
  plan: FixPlan
  isRp: boolean
  outputFiles?: PackFileMap
  /** Revision the preview was generated against, echoed back for staleness checks. */
  revision?: number
}

export async function fetchVersions(): Promise<McmetaVersion[]> {
  return engineFetchVersions()
}

export async function runCheck(req: CheckRequest): Promise<CheckResponse> {
  const { mode, versions, all, strict, files, onProgress } = req

  let result: any
  let detectedMode = mode

  if (mode === 'auto') {
    const hasData = Object.keys(files).some(k => k.startsWith('data/'))
    const hasAssets = Object.keys(files).some(k => k.startsWith('assets/'))
    if (hasAssets && !hasData) {
      detectedMode = 'resourcepack'
    } else {
      detectedMode = 'datapack'
    }
  }

  const versionList = all ? undefined : versions && versions.length > 0 ? versions : undefined

  try {
    if (detectedMode === 'resourcepack') {
      result = await checkResourcePack(files, versionList, all)
    } else {
      result = await checkCompatibilityContentBased(files, versionList, all, strict, onProgress)
    }
  } catch (err: any) {
    throw new Error(err.message || String(err))
  }

  return { result, mode: detectedMode, revision: req.revision }
}

export async function runFixPreview(req: FixRequest): Promise<FixPreview> {
  const { files, targetVersion, sourceVersion } = req
  const isRp = Object.keys(files).some(k => k.startsWith('assets/')) &&
    !Object.keys(files).some(k => k.startsWith('data/'))

  let fixResult: any
  try {
    if (isRp) {
      fixResult = await fixResourcePack({ files, targetVersion, sourceVersion })
    } else {
      fixResult = await fixDatapack({ files, targetVersion, sourceVersion })
    }
  } catch (err: any) {
    throw new Error(err.message || String(err))
  }

  return {
    results: fixResult.results,
    summary: fixResult.summary,
    plan: fixResult.plan,
    isRp,
    outputFiles: fixResult.files as PackFileMap,
    revision: req.revision,
  }
}

export async function runFix(req: FixRequest): Promise<Blob> {
  const { files, targetVersion, sourceVersion } = req
  const isRp = Object.keys(files).some(k => k.startsWith('assets/')) &&
    !Object.keys(files).some(k => k.startsWith('data/'))

  let fixResult: any
  try {
    if (isRp) {
      fixResult = await fixResourcePack({ files, targetVersion, sourceVersion })
    } else {
      fixResult = await fixDatapack({ files, targetVersion, sourceVersion })
    }
  } catch (err: any) {
    throw new Error(err.message || String(err))
  }

  // Build zip from the output file map
  const zip = new JSZip()
  for (const [path, content] of Object.entries(fixResult.files as Record<string, string>)) {
    zip.file(path, content)
  }

  return await zip.generateAsync({ type: 'blob' })
}

/** Zip up an arbitrary file map and return it as a download blob.
 *  Used by the IDE "Export" button to save the current pack (1.12). */
export async function exportZip(files: Record<string, string>): Promise<Blob> {
  const zip = new JSZip()
  for (const [path, content] of Object.entries(files)) {
    zip.file(path, content)
  }
  return await zip.generateAsync({ type: 'blob' })
}
