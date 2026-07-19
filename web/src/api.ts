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
}

export interface RegistryIssue {
  file: string
  registry: string
  entry: string
  issue: string
}

export interface StructuralIssue {
  file: string
  issue: string
}

export interface RegistryDeprecation {
  file: string
  registry: string
  entry: string
  issue: string
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
  breaking_changes?: string[]
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
}

export interface CheckRequest {
  mode: Mode
  versions?: string[]
  all: boolean
  strict: boolean
  files: PackFileMap
}

export interface CheckResponse {
  result: CheckResult
  mode: string
}

export interface FixRequest {
  files: PackFileMap
  targetVersion: string
  sourceVersion?: string
}

function apiBase(): string {
  return import.meta.env.DEV ? '/api' : '/api'
}

export async function fetchVersions(): Promise<McmetaVersion[]> {
  const r = await fetch(`${apiBase()}/versions`)
  if (!r.ok) throw new Error(`Failed to fetch versions: ${r.statusText}`)
  return r.json()
}

export async function runCheck(req: CheckRequest): Promise<CheckResponse> {
  const r = await fetch(`${apiBase()}/check`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(req),
  })
  if (!r.ok) {
    let msg = r.statusText
    try { const j = await r.json(); if (j.error) msg = j.error } catch { const t = await r.text(); if (t) msg = t }
    throw new Error(msg)
  }
  return r.json()
}

export async function runFix(req: FixRequest): Promise<Blob> {
  const r = await fetch(`${apiBase()}/fix`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(req),
  })
  if (!r.ok) {
    let msg = r.statusText
    try { const j = await r.json(); if (j.error) msg = j.error } catch { const t = await r.text(); if (t) msg = t }
    throw new Error(msg)
  }
  return r.blob()
}
