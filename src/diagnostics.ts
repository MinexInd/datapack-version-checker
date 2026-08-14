import type { CheckResult } from './types.js'
import type { ChangeEntry } from './technical-changes.js'

export type UnifiedSeverity = 'error' | 'warning' | 'info' | 'hint'

export interface UnifiedDiagnostic {
  source: 'command' | 'registry' | 'mcdoc' | 'structural' | 'dependency' | 'technical-change' | 'metadata'
  code?: string
  file: string
  line: number
  column: number
  endLine?: number
  endColumn?: number
  message: string
  version?: string
  data?: Record<string, unknown>
  severity?: UnifiedSeverity
}

export interface UnifiedResult {
  version: string
  diagnostics: UnifiedDiagnostic[]
  errorCount: number
  warningCount: number
  infoCount: number
}

type Problem = {
  severity?: UnifiedSeverity
  message?: string
  issue?: string
  file?: string
  path?: string
  line?: number
  column?: number
  code?: string
  source?: string
}

/** The response wrapper used by the web API, with the Node result shape underneath. */
export interface CheckResponse {
  result?: CheckResult & { problems?: Problem[] }
  problems?: Problem[]
}

function diagnostic(
  source: UnifiedDiagnostic['source'],
  problem: Problem,
  version: string,
  fallbackSeverity: UnifiedSeverity = 'error',
): UnifiedDiagnostic {
  return {
    source,
    ...(problem.code ? { code: problem.code } : {}),
    file: (problem.file ?? problem.path ?? '').replace(/\\/g, '/'),
    line: problem.line && problem.line > 0 ? problem.line : 1,
    column: problem.column && problem.column > 0 ? problem.column : 1,
    message: problem.message ?? problem.issue ?? '',
    version,
    severity: problem.severity ?? fallbackSeverity,
  }
}

function sourceFor(problem: Problem): UnifiedDiagnostic['source'] {
  if (problem.source === 'command' || problem.source === 'registry' || problem.source === 'dependency' || problem.source === 'technical-change' || problem.source === 'metadata') {
    return problem.source
  }
  if (problem.source === 'mcdoc') return 'mcdoc'
  if (problem.source === 'format') return 'structural'
  return 'structural'
}

/** Normalize the legacy web/API problem list and the Node compatibility result. */
export function normalizeCheckResponse(resp: CheckResponse, version: string): UnifiedDiagnostic[] {
  const result = resp.result as (CheckResult & { problems?: Problem[] }) | undefined
  const direct = [...(resp.problems ?? []), ...(result?.problems ?? [])]
  if (direct.length > 0) return direct.map(p => diagnostic(sourceFor(p), p, version))

  const versions = [...(result?.compatible ?? []), ...(result?.incompatible ?? [])]
  const selected = versions.filter(v => !version || v.version.name === version || v.version.id === version)
  const lanes = selected.length > 0 ? selected : versions
  const out: UnifiedDiagnostic[] = []
  for (const checked of lanes) {
    const add = (source: UnifiedDiagnostic['source'], items: Problem[], severity: UnifiedSeverity = 'error') =>
      out.push(...items.map(item => diagnostic(source, item, version, severity)))
    add('command', checked.mcfunction_issues.map(i => ({ ...i, message: i.issue })))
    add('registry', checked.registry_issues.map(i => ({ ...i, message: i.issue })))
    add('structural', (checked.structural_issues ?? []).map(i => ({ ...i, message: i.issue })))
    add('registry', (checked.deprecation_issues ?? []).map(i => ({ ...i, message: i.issue })), 'warning')
    add('dependency', (checked.reference_issues ?? []).map(i => ({ ...i, message: i.issue })))
    out.push(...(checked.breaking_changes ?? []).map(message => ({
      source: 'technical-change' as const, file: '', line: 1, column: 1, message, version, severity: 'warning' as const,
    })))
  }
  return out
}

export function normalizeTechnicalChanges(
  changes: Record<string, string[]> | ChangeEntry[] | string[],
  version: string,
): UnifiedDiagnostic[] {
  const entries: Array<{ message: string; data?: Record<string, unknown> }> = []
  if (Array.isArray(changes)) {
    for (const change of changes) {
      if (typeof change === 'string') entries.push({ message: change })
      else entries.push({
        message: change.content,
        data: { releaseFolder: change.releaseFolder, snapId: change.snapId, tags: change.tags },
      })
    }
  } else {
    for (const message of changes[version] ?? []) entries.push({ message })
  }
  return entries.map(({ message, data }) => ({
    source: 'technical-change', file: '', line: 1, column: 1, message, version, data, severity: 'warning',
  }))
}

export function normalizeMetadata(problems: Array<{ severity: UnifiedSeverity; message: string; file?: string }>, version: string): UnifiedDiagnostic[] {
  return problems.map(problem => diagnostic('metadata', problem, version))
}

export function countBySeverity(diagnostics: UnifiedDiagnostic[]): Record<UnifiedSeverity, number> {
  const counts: Record<UnifiedSeverity, number> = { error: 0, warning: 0, info: 0, hint: 0 }
  for (const item of diagnostics) counts[item.severity ?? 'error']++
  return counts
}

export function toUnifiedResult(version: string, diagnostics: UnifiedDiagnostic[]): UnifiedResult {
  const counts = countBySeverity(diagnostics)
  return { version, diagnostics, errorCount: counts.error, warningCount: counts.warning, infoCount: counts.info }
}

export function mergeResults(...results: UnifiedResult[]): UnifiedResult {
  const diagnostics = results.flatMap(result => result.diagnostics)
  return toUnifiedResult(results[0]?.version ?? '', diagnostics)
}
