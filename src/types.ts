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

export interface PackMcmeta {
  pack: {
    pack_format: number
    supported_formats?: number | number[] | { min_inclusive: number; max_inclusive: number }
    description?: string
  }
}

export interface McmetaFormatRange {
  min: number
  max: number
}

export interface ReferenceIssue {
  file: string
  line?: number
  reference: string
  type: string
  issue: string
  code?: string
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

export interface CommandTreeNode {
  type: 'root' | 'literal' | 'argument'
  children?: Record<string, CommandTreeNode>
  executable?: true
  parser?: string
  properties?: Record<string, unknown>
  redirect?: string[]
}

export interface CheckResult {
  target_version_id: string
  pack_format: number
  versions_checked: number
  compatible: VersionCompatibility[]
  incompatible: VersionCompatibility[]
}
