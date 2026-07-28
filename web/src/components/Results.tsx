import { useState, useEffect, useMemo } from 'react'
import { highlightMcfunction } from '../engine/highlight'
import type {
  CheckResult,
  VersionCompatibility,
  KnowledgeHit,
  McfunctionIssue,
  RegistryIssue,
  StructuralIssue,
  ReferenceIssue,
  RegistryDeprecation,
} from '../api'

interface Props {
  result: CheckResult
  mode: string
  duration?: number
}

interface IssueCounts {
  cmd: number
  reg: number
  structural: number
  dep: number
  ref: number
  bc: number
  total: number
}

function issueCounts(v: VersionCompatibility): IssueCounts {
  const structural = v.structural_issues?.length ?? 0
  const cmd = v.mcfunction_issues?.length ?? 0
  const reg = v.registry_issues?.length ?? 0
  const dep = v.deprecation_issues?.length ?? 0
  const ref = v.reference_issues?.length ?? 0
  const bc = v.breaking_changes?.length ?? 0
  return { cmd, reg, structural, dep, ref, bc, total: cmd + reg + structural + dep + ref + bc }
}

type FlatIssue =
  | { kind: 'cmd'; file: string; line: number; command: string; issue: string; snippet?: string }
  | { kind: 'reg'; file: string; registry: string; entry: string; issue: string }
  | { kind: 'struct'; file: string; issue: string }
  | { kind: 'ref'; file: string; line?: number; reference: string; issue: string; code?: string }
  | { kind: 'dep'; file: string; registry: string; entry: string; issue: string }
  | { kind: 'bc'; file: string; issue: string }

function flattenIssues(v: VersionCompatibility): FlatIssue[] {
  const issues: FlatIssue[] = []
  for (const i of v.mcfunction_issues ?? []) {
    issues.push({ kind: 'cmd', file: i.file, line: i.line, command: i.command, issue: i.issue, snippet: i.snippet })
  }
  for (const i of v.registry_issues ?? []) {
    issues.push({ kind: 'reg', file: i.file, registry: i.registry, entry: i.entry, issue: i.issue })
  }
  for (const i of v.structural_issues ?? []) {
    issues.push({ kind: 'struct', file: i.file, issue: i.issue })
  }
  for (const i of v.reference_issues ?? []) {
    issues.push({ kind: 'ref', file: i.file, line: i.line, reference: i.reference, issue: i.issue, code: i.code })
  }
  for (const i of v.deprecation_issues ?? []) {
    issues.push({ kind: 'dep', file: i.file, registry: i.registry, entry: i.entry, issue: i.issue })
  }
  for (const bc of v.breaking_changes ?? []) {
    issues.push({ kind: 'bc', file: '', issue: bc })
  }
  return issues
}

function groupByFile(issues: FlatIssue[]): Map<string, FlatIssue[]> {
  const map = new Map<string, FlatIssue[]>()
  for (const issue of issues) {
    const key = issue.file || '(global)'
    const existing = map.get(key)
    if (existing) existing.push(issue)
    else map.set(key, [issue])
  }
  return map
}

const KIND_META: Record<string, { label: string; icon: string; cssClass: string }> = {
  cmd:    { label: 'Command', icon: '!', cssClass: 'cmd' },
  reg:    { label: 'Registry', icon: '~', cssClass: 'reg' },
  struct: { label: 'Structural', icon: '#', cssClass: 'struct' },
  ref:    { label: 'Reference', icon: '@', cssClass: 'ref' },
  dep:    { label: 'Deprecated', icon: '-', cssClass: 'dep' },
  bc:     { label: 'Breaking', icon: '*', cssClass: 'bc' },
}

function IssueItem({ issue, idx }: { issue: FlatIssue; idx: number }) {
  const meta = KIND_META[issue.kind]
  return (
    <div
      className={`issue-item ${meta.cssClass}`}
      style={{ animationDelay: `${Math.min(idx * 30, 300)}ms` }}
    >
      <div className="issue-item-header">
        <span className={`issue-badge ${meta.cssClass}`}>{meta.icon} {meta.label}</span>
        {issue.kind === 'cmd' && 'line' in issue && issue.line > 0 && (
          <span className="issue-loc">L{issue.line}</span>
        )}
        {issue.kind === 'ref' && 'line' in issue && issue.line != null && issue.line > 0 && (
          <span className="issue-loc">L{issue.line}</span>
        )}
      </div>
      <div className="issue-item-body">{issue.issue}</div>
      {issue.kind === 'cmd' && 'command' in issue && issue.command && (
        <code className="issue-cmd">{issue.command}</code>
      )}
      {issue.kind === 'cmd' && 'snippet' in issue && issue.snippet && (
        <pre className="issue-snippet" dangerouslySetInnerHTML={{ __html: highlightMcfunction(issue.snippet) }} />
      )}
      {issue.kind === 'reg' && (
        <code className="issue-cmd">{issue.registry} → {issue.entry}</code>
      )}
      {issue.kind === 'dep' && (
        <code className="issue-cmd">{issue.registry} → {issue.entry}</code>
      )}
      {'code' in issue && issue.code && (
        <pre className="issue-code">{issue.code}</pre>
      )}
    </div>
  )
}

function FileGroup({ filePath, issues }: { filePath: string; issues: FlatIssue[] }) {
  const kinds = new Set(issues.map(i => i.kind))
  return (
    <div className="file-group">
      <div className="file-group-header">
        <span className="file-path">{filePath}</span>
        <span className="file-issue-count">{issues.length}</span>
        <div className="file-kind-tags">
          {[...kinds].map(k => (
            <span key={k} className={`file-kind-tag ${k}`}>{KIND_META[k]?.icon}</span>
          ))}
        </div>
      </div>
      <div className="file-group-issues">
        {issues.map((issue, idx) => (
          <IssueItem key={idx} issue={issue} idx={idx} />
        ))}
      </div>
    </div>
  )
}

function IssueCountsBar({ c }: { c: IssueCounts }) {
  return (
    <div className="issue-counts">
      {c.cmd > 0 && <span className="pill cmd">{c.cmd} cmd</span>}
      {c.reg > 0 && <span className="pill reg">{c.reg} reg</span>}
      {c.structural > 0 && <span className="pill struct">{c.structural} struct</span>}
      {c.ref > 0 && <span className="pill ref">{c.ref} ref</span>}
      {c.dep > 0 && <span className="pill dep">{c.dep} dep</span>}
      {c.bc > 0 && <span className="pill bc">{c.bc} breaking</span>}
    </div>
  )
}

function VersionRow({ v, defaultOpen, index }: { v: VersionCompatibility; defaultOpen?: boolean; index: number }) {
  const [open, setOpen] = useState(defaultOpen ?? false)
  useEffect(() => { setOpen(defaultOpen ?? false) }, [defaultOpen])
  const c = issueCounts(v)
  const tagClass = v.version.type === 'snapshot' ? 'snapshot' : 'release'

  const grouped = useMemo(() => {
    if (!open) return null
    const flat = flattenIssues(v)
    return groupByFile(flat)
  }, [v, open])

  return (
    <div
      className={`vrow ${open ? 'open' : ''}`}
      style={{ animationDelay: `${Math.min(index * 40, 400)}ms` }}
    >
      <div className="vhead" onClick={() => setOpen(o => !o)}>
        <span className="vname">{v.version.name}</span>
        <span className={`vtag ${tagClass}`}>{v.version.type}</span>
        <div className="spacer" />
        {v.status === 'compatible' ? (
          <span className="pill ok">compatible</span>
        ) : (
          <IssueCountsBar c={c} />
        )}
        {v.status === 'outside_load_range' && (
          <span className="badge outside">outside range</span>
        )}
        <span className="chev">▶</span>
      </div>
      <div className="vbody">
        <div className="vbody-inner">
          {v.status === 'outside_load_range' && (
            <div className="outside-notice">
              <span className="outside-icon">!</span>
              <div>
                <strong>Outside declared load range</strong>
                <span>Minecraft will not load this pack for this version.</span>
              </div>
            </div>
          )}

          {grouped && grouped.size > 0 ? (
            <div className="issues-scroll">
              {[...grouped.entries()].map(([filePath, issues]) => (
                <FileGroup key={filePath} filePath={filePath} issues={issues} />
              ))}
            </div>
          ) : grouped && grouped.size === 0 ? (
            <div className="empty-state">No issues in this version</div>
          ) : null}
        </div>
      </div>
    </div>
  )
}

function KnowledgeCard({ h, idx }: { h: KnowledgeHit; idx: number }) {
  const rule = h.rule
  const typeIcons: Record<string, string> = {
    command: '>',
    command_pattern: '~',
    registry: '#',
    json_field: '{}',
    function_macro: '$',
  }
  return (
    <div className="krule" style={{ animationDelay: `${Math.min(idx * 50, 400)}ms` }}>
      <div className="krule-top">
        <span className="krule-icon">{typeIcons[rule.type] ?? '◈'}</span>
        <div className="krule-info">
          <div className="kfeat">{rule.description}</div>
          <div className="kmin">Requires: ≥ {rule.minVersion}</div>
        </div>
      </div>
      {rule.fix && <div className="kfix">{rule.fix}</div>}
      {h.file && (
        <div className="kfound">
          <span className="kfound-label">Found in:</span> {h.file}{h.line ? ':' + h.line : ''}
        </div>
      )}
    </div>
  )
}

function downloadFile(filename: string, content: string, mime: string) {
  const blob = new Blob([content], { type: mime })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

function exportJson(result: CheckResult) {
  downloadFile('dpcheck-report.json', JSON.stringify(result, null, 2), 'application/json')
}

function exportMarkdown(result: CheckResult) {
  const lines: string[] = []
  lines.push(`# dpcheck Report`)
  lines.push(``)
  lines.push(`Versions checked: ${result.versions_checked}`)
  if (result.load_range) {
    lines.push(`Load range: ${result.load_range.min_name ?? result.load_range.min} – ${result.load_range.max_name ?? result.load_range.max}`)
  }
  if (result.min_version) {
    lines.push(`Minimum version from content: ${result.min_version}`)
  }
  lines.push(``)
  lines.push(`## Compatible (${result.compatible.length})`)
  lines.push(``)
  for (const v of result.compatible) {
    lines.push(`- **${v.version.name}** (${v.version.type})`)
  }
  lines.push(``)
  lines.push(`## Broken (${result.incompatible.length})`)
  lines.push(``)
  for (const v of result.incompatible) {
    const issues: string[] = []
    for (const i of v.mcfunction_issues ?? []) issues.push(`- [cmd] ${i.file}:${i.line} — ${i.issue}`)
    for (const i of v.registry_issues ?? []) issues.push(`- [reg] ${i.file} — ${i.issue}`)
    for (const i of v.structural_issues ?? []) issues.push(`- [struct] ${i.file} — ${i.issue}`)
    for (const i of v.reference_issues ?? []) issues.push(`- [ref] ${i.file}${i.line ? ':' + i.line : ''} — ${i.issue}`)
    for (const i of v.deprecation_issues ?? []) issues.push(`- [deprec] ${i.file} — ${i.issue}`)
    for (const bc of v.breaking_changes ?? []) issues.push(`- [breaking] ${bc}`)
    if (issues.length === 0) issues.push(`- No specific issues (outside load range)`)
    lines.push(`### ${v.version.name} (${v.version.type})`)
    lines.push(``)
    lines.push(...issues)
    lines.push(``)
  }
  if (result.knowledge_hits?.length) {
    lines.push(`## Features Setting Minimum Version`)
    lines.push(``)
    const seen = new Set<string>()
    for (const h of result.knowledge_hits) {
      if (seen.has(h.rule.id)) continue
      seen.add(h.rule.id)
      lines.push(`- **${h.rule.description}** — requires ≥ ${h.rule.minVersion}`)
      if (h.rule.fix) lines.push(`  - Fix: ${h.rule.fix}`)
      if (h.file) lines.push(`  - Found: ${h.file}${h.line ? ':' + h.line : ''}`)
    }
    lines.push(``)
  }
  downloadFile('dpcheck-report.md', lines.join('\n'), 'text/markdown')
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`
  const m = Math.floor(ms / 60000)
  const s = Math.round((ms % 60000) / 1000)
  return `${m}m ${s}s`
}

async function copyReport(result: CheckResult) {
  const text = generateReportText(result)
  try {
    await navigator.clipboard.writeText(text)
  } catch { /* fallback: ignore */ }
}

function generateReportText(result: CheckResult): string {
  const lines: string[] = []
  lines.push(`dpcheck Report — ${result.versions_checked} versions checked`)
  if (result.load_range) {
    lines.push(`Load range: ${result.load_range.min_name ?? result.load_range.min} – ${result.load_range.max_name ?? result.load_range.max}`)
  }
  if (result.min_version) {
    lines.push(`Min version: ${result.min_version}`)
  }
  lines.push(``)
  for (const v of result.compatible ?? []) {
    lines.push(`✓ ${v.version.name} — compatible`)
  }
  for (const v of result.incompatible ?? []) {
    const c = issueCounts(v)
    lines.push(`✗ ${v.version.name} — ${c.total} issue(s)`)
    for (const i of v.mcfunction_issues ?? []) lines.push(`  [cmd] ${i.file}:${i.line} — ${i.issue}`)
    for (const i of v.registry_issues ?? []) lines.push(`  [reg] ${i.file} — ${i.issue}`)
    for (const i of v.structural_issues ?? []) lines.push(`  [struct] ${i.file} — ${i.issue}`)
    for (const i of v.reference_issues ?? []) lines.push(`  [ref] ${i.file}${i.line ? ':' + i.line : ''} — ${i.issue}`)
    for (const i of v.deprecation_issues ?? []) lines.push(`  [dep] ${i.file} — ${i.issue}`)
    for (const bc of v.breaking_changes ?? []) lines.push(`  [breaking] ${bc}`)
  }
  return lines.join('\n')
}

export default function Results({ result, mode, duration }: Props) {
  if (!result) return null

  const [allOpen, setAllOpen] = useState(false)
  const [filterKind, setFilterKind] = useState<string | null>(null)
  const compat = result.compatible || []
  const incompat = result.incompatible || []
  const outside = incompat.filter(v => v.status === 'outside_load_range')
  const broken = incompat.filter(v => v.status !== 'outside_load_range')
  const totalIssues = incompat.reduce((acc, v) => acc + issueCounts(v).total, 0)

  const dedupedKnowledge = useMemo(() => {
    if (!result.knowledge_hits?.length) return []
    const seen = new Set<string>()
    return result.knowledge_hits.filter(h => {
      if (seen.has(h.rule.id)) return false
      seen.add(h.rule.id)
      return true
    })
  }, [result.knowledge_hits])

  return (
    <>
      {/* Summary */}
      <div className="card result-summary">
        <div className="result-header-row">
          <h2>
            <span className="result-header-icon">R</span>
            Results
            <span className="sub">{result.versions_checked} versions checked</span>
          </h2>
          <div className="result-actions">
            <button className="btn btn-sm" onClick={() => setAllOpen(o => !o)}>
              {allOpen ? '▲ Collapse All' : '▼ Expand All'}
            </button>
            <button className="btn btn-ghost btn-sm" onClick={() => copyReport(result)}>Copy</button>
            <button className="btn btn-ghost btn-sm" onClick={() => exportJson(result)}>JSON</button>
            <button className="btn btn-ghost btn-sm" onClick={() => exportMarkdown(result)}>MD</button>
          </div>
        </div>

        {result.load_range && (
          <div className="meta-line">
            Load range (pack.mcmeta): <b>{result.load_range.min_name ?? result.load_range.min}</b>
            {' – '}<b>{result.load_range.max_name ?? result.load_range.max}</b>
          </div>
        )}
        {result.min_version && (
          <div className="meta-line">
            Minimum version from content: <b>{result.min_version}</b>
          </div>
        )}

        <div className="stats">
          <div className="stat green">
            <div className="num">{compat.length}</div>
            <div className="label">Compatible</div>
          </div>
          <div className="stat red">
            <div className="num">{broken.length}</div>
            <div className="label">Broken</div>
          </div>
          <div className="stat amber">
            <div className="num">{outside.length}</div>
            <div className="label">Outside range</div>
          </div>
          <div className="stat blue">
            <div className="num">{totalIssues}</div>
            <div className="label">Total issues</div>
          </div>
        </div>

        {duration != null && duration > 0 && (
          <div className="meta-line duration-line">
            Completed in <b>{formatDuration(duration)}</b>
          </div>
        )}
      </div>

      {/* Compatible */}
      <div className="card">
        <h2>
          <span className="section-icon green">V</span>
          Compatible Versions
          <span className="sub">{compat.length}</span>
        </h2>
        {compat.length > 0 ? (
          <div className="vlist">
            {compat.map((v, i) => (
              <VersionRow key={v.version.id} v={v} defaultOpen={allOpen} index={i} />
            ))}
          </div>
        ) : (
          <div className="empty-state">No compatible versions found</div>
        )}
      </div>

      {/* Content breaks */}
      <div className="card">
        <h2>
          <span className="section-icon red">X</span>
          Content Breaks
          <span className="sub">{broken.length}</span>
        </h2>
        {broken.length > 0 ? (
          <div className="vlist">
            {broken.map((v, i) => (
              <VersionRow key={v.version.id} v={v} defaultOpen={allOpen} index={i} />
            ))}
          </div>
        ) : (
          <div className="empty-state">No content issues found</div>
        )}
      </div>

      {/* Outside load range */}
      <div className="card">
        <h2>
          <span className="section-icon amber">!</span>
          Outside Declared Load Range
          <span className="sub">{outside.length}</span>
        </h2>
        {outside.length > 0 ? (
          <div className="vlist">
            {outside.map((v, i) => (
              <VersionRow key={v.version.id} v={v} defaultOpen={allOpen} index={i} />
            ))}
          </div>
        ) : (
          <div className="empty-state">All versions are within the declared load range</div>
        )}
      </div>

      {/* Knowledge hits */}
      {dedupedKnowledge.length > 0 && (
        <div className="card">
          <h2>
            <span className="section-icon blue">F</span>
            Features Setting Minimum Version
            <span className="sub">{dedupedKnowledge.length} feature{dedupedKnowledge.length !== 1 ? 's' : ''}</span>
          </h2>
          <div className="knowledge-grid">
            {dedupedKnowledge.map((h, i) => (
              <KnowledgeCard key={i} h={h} idx={i} />
            ))}
          </div>
        </div>
      )}
    </>
  )
}
