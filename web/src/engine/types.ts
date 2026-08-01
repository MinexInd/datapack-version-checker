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
    // 25w31a+ (1.21.9) format range keys: bare int, [int], or [major, minor]
    min_format?: number | number[]
    max_format?: number | number[]
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

export interface AnalysisMetrics {
  totalFunctions: number
  totalJsonFiles: number
  totalResources: number
  totalCommands: number
  avgCommandsPerFunction: number
  maxExecuteDepth: number
  largestFunction: { file: string; lines: number } | null
  namespaceCounts: Record<string, number>
}

export interface AnalysisResult {
  resources: Array<{
    type: string
    namespace: string
    name: string
    fullPath: string
    file: string
    size: number
  }>
  references: Array<{
    from: string
    to: string
    type: string
    file: string
    line?: number
    code?: string
  }>
  orphans: Array<{
    type: string
    namespace: string
    name: string
    fullPath: string
    file: string
    size: number
  }>
  brokenRefs: Array<{
    from: string
    to: string
    type: string
    file: string
    line?: number
    code?: string
  }>
  circularDeps: string[][]
  metrics: AnalysisMetrics
}

export interface PortingPlan {
  sourceVersion: string
  targetVersion: string
  portingForward: boolean
  actions: Array<{
    file: string
    line?: number
    type: string
    description: string
    oldCode?: string
    newCode?: string
    autoFixable: boolean
  }>
  cascadeEffects: Array<{
    trigger: string
    triggerFile: string
    affectedFiles: string[]
    description: string
  }>
  manualAttention: Array<{
    file: string
    description: string
    reason: string
  }>
  summary: {
    totalActions: number
    autoFixable: number
    manualRequired: number
    filesAffected: number
    cascadeCount: number
  }
}
