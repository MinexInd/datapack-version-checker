import { useState, useEffect, useMemo, useCallback, useId } from 'react'
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
  AnalysisResult,
} from '../api'

interface Props {
  result: CheckResult
  mode: string
  duration?: number
  onPortTo: (versionName: string) => void
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
  | { kind: 'cmd'; file: string; line: number; command: string; issue: string; snippet?: string; suggestion?: string; autoFixable?: boolean }
  | { kind: 'reg'; file: string; registry: string; entry: string; issue: string; suggestion?: string; autoFixable?: boolean }
  | { kind: 'struct'; file: string; issue: string; suggestion?: string; autoFixable?: boolean }
  | { kind: 'ref'; file: string; line?: number; reference: string; issue: string; code?: string; suggestion?: string; autoFixable?: boolean }
  | { kind: 'dep'; file: string; registry: string; entry: string; issue: string; suggestion?: string; autoFixable?: boolean }
  | { kind: 'bc'; file: string; issue: string; suggestion?: string; autoFixable?: boolean }

function flattenIssues(v: VersionCompatibility): FlatIssue[] {
  const issues: FlatIssue[] = []
  for (const i of v.mcfunction_issues ?? []) {
    issues.push({ kind: 'cmd', file: i.file, line: i.line, command: i.command, issue: i.issue, snippet: i.snippet, suggestion: i.suggestion, autoFixable: i.autoFixable })
  }
  for (const i of v.registry_issues ?? []) {
    issues.push({ kind: 'reg', file: i.file, registry: i.registry, entry: i.entry, issue: i.issue, suggestion: i.suggestion, autoFixable: i.autoFixable })
  }
  for (const i of v.structural_issues ?? []) {
    issues.push({ kind: 'struct', file: i.file, issue: i.issue, suggestion: i.suggestion, autoFixable: i.autoFixable })
  }
  for (const i of v.reference_issues ?? []) {
    issues.push({ kind: 'ref', file: i.file, line: i.line, reference: i.reference, issue: i.issue, code: i.code })
  }
  for (const i of v.deprecation_issues ?? []) {
    issues.push({ kind: 'dep', file: i.file, registry: i.registry, entry: i.entry, issue: i.issue, suggestion: i.suggestion, autoFixable: i.autoFixable })
  }
  for (const bc of v.breaking_changes ?? []) {
    issues.push({ kind: 'bc', file: '', issue: bc })
  }
  return issues
}

/** Issues that carry a suggestion, collected across all issue arrays of one version. */
interface ChecklistItem {
  file: string
  line?: number
  issue: string
  suggestion: string
  autoFixable?: boolean
}

function checklistItems(v: VersionCompatibility): ChecklistItem[] {
  const out: ChecklistItem[] = []
  for (const i of v.mcfunction_issues ?? []) {
    if (i.suggestion) out.push({ file: i.file, line: i.line, issue: i.issue, suggestion: i.suggestion, autoFixable: i.autoFixable })
  }
  for (const i of v.registry_issues ?? []) {
    if (i.suggestion) out.push({ file: i.file, issue: i.issue, suggestion: i.suggestion, autoFixable: i.autoFixable })
  }
  for (const i of v.structural_issues ?? []) {
    if (i.suggestion) out.push({ file: i.file, issue: i.issue, suggestion: i.suggestion, autoFixable: i.autoFixable })
  }
  for (const i of v.deprecation_issues ?? []) {
    if (i.suggestion) out.push({ file: i.file, issue: i.issue, suggestion: i.suggestion, autoFixable: i.autoFixable })
  }
  return out
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
  const autoFix = issue.autoFixable === true
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
      {issue.suggestion && (
        <div className={`issue-hint ${autoFix ? 'auto' : 'manual'}`}>
          <span className="issue-hint-dot" aria-hidden="true" />
          <span className="issue-hint-tag">{autoFix ? 'auto-fix' : 'manual'}</span>
          <span className="issue-hint-text">{issue.suggestion}</span>
        </div>
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
            <span key={k} className={`file-kind-tag ${k}`} title={KIND_META[k]?.label}>{KIND_META[k]?.icon}</span>
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

function ChecklistCard({ versionName, items }: { versionName: string; items: ChecklistItem[] }) {
  const [showAll, setShowAll] = useState(false)
  const listId = useId()
  const autoCount = items.filter(i => i.autoFixable).length
  const manualCount = items.length - autoCount
  const visible = showAll ? items : items.slice(0, 8)
  const hidden = items.length - visible.length

  return (
    <div className="checklist-card">
      <div className="checklist-head">
        <div className="checklist-title">Make compatible with {versionName}</div>
        {items.length > 0 && (
          <div className="checklist-chips">
            {autoCount > 0 && <span className="checklist-chip auto">{autoCount} auto-fixable</span>}
            {manualCount > 0 && <span className="checklist-chip manual">{manualCount} manual</span>}
          </div>
        )}
      </div>
      {items.length === 0 ? (
        <p className="checklist-empty">No known fixes for this version — check the breaking changes list below.</p>
      ) : (
        <>
          <ul className="checklist" id={listId}>
            {visible.map((it, i) => (
              <li
                key={i}
                className={`checklist-item ${it.autoFixable ? 'auto' : 'manual'}`}
                style={{ animationDelay: `${Math.min(i * 25, 200)}ms` }}
              >
                <div className="checklist-main">
                  <div className="checklist-loc">{it.file}{it.line ? ':' + it.line : ''}</div>
                  <div className="checklist-text">{it.issue}</div>
                  <div className="checklist-fix">{it.suggestion}</div>
                </div>
              </li>
            ))}
          </ul>
          {hidden > 0 && (
            <button
              className="btn btn-ghost btn-sm checklist-more"
              aria-expanded={showAll}
              aria-controls={listId}
              onClick={() => setShowAll(s => !s)}
            >
              {showAll ? 'Show less' : `Show ${hidden} more`}
            </button>
          )}
        </>
      )}
    </div>
  )
}

function IssueCountsBar({ c, activeKind, onKind }: { c: IssueCounts; activeKind: string | null; onKind: (k: string) => void }) {
  const entries: Array<[keyof IssueCounts, string, string]> = [
    ['cmd', 'cmd', 'cmd'],
    ['reg', 'reg', 'reg'],
    ['structural', 'struct', 'struct'],
    ['ref', 'ref', 'ref'],
    ['dep', 'dep', 'dep'],
    ['bc', 'bc', 'breaking'],
  ]
  return (
    <div className="issue-counts">
      {entries.map(([key, kind, label]) => c[key] > 0 ? (
        <button
          key={kind}
          className={`pill ${kind} pill-btn${activeKind === kind ? ' active' : ''}`}
          onClick={(e) => { e.stopPropagation(); onKind(kind) }}
        >
          {c[key]} {label}
        </button>
      ) : null)}
    </div>
  )
}

function VersionRow({ v, defaultOpen, index, filterKind, onFilterKind, onPortTo }: {
  v: VersionCompatibility
  defaultOpen?: boolean
  index: number
  filterKind: string | null
  onFilterKind: (k: string) => void
  onPortTo: (versionName: string) => void
}) {
  const [open, setOpen] = useState(defaultOpen ?? false)
  useEffect(() => { setOpen(defaultOpen ?? false) }, [defaultOpen])
  const c = issueCounts(v)
  const tagClass = v.version.type === 'snapshot' ? 'snapshot' : 'release'
  const isBroken = v.status === 'content_issues'

  const grouped = useMemo(() => {
    if (!open) return null
    const flat = flattenIssues(v).filter(i => !filterKind || i.kind === filterKind)
    return groupByFile(flat)
  }, [v, open, filterKind])

  const suggestions = useMemo(() => (isBroken ? checklistItems(v) : []), [v, isBroken])

  const emptyMsg = filterKind
    ? `No ${(KIND_META[filterKind]?.label ?? 'matching').toLowerCase()} issues in this version`
    : 'No issues in this version'

  return (
    <div
      className={`vrow ${open ? 'open' : ''}`}
      style={{ animationDelay: `${Math.min(index * 40, 400)}ms` }}
    >
      <div
        className="vhead"
        role="button"
        tabIndex={0}
        aria-expanded={open}
        onClick={() => setOpen(o => !o)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            setOpen(o => !o)
          }
        }}
      >
        <span className="vname">{v.version.name}</span>
        <span className={`vtag ${tagClass}`}>{v.version.type}</span>
        <div className="spacer" />
        {v.status === 'compatible' ? (
          <span className="pill ok">compatible</span>
        ) : v.status === 'outside_load_range' ? (
          <span className="pill reg">outside load range</span>
        ) : (
          <>
            <IssueCountsBar
              c={c}
              activeKind={filterKind}
              onKind={(k) => { onFilterKind(k); setOpen(true) }}
            />
            <button
              className="btn btn-primary btn-sm cta-port"
              onClick={(e) => { e.stopPropagation(); onPortTo(v.version.name) }}
              onKeyDown={(e) => e.stopPropagation()}
            >
              Port to {v.version.name}
            </button>
          </>
        )}
        <span className="chev">▶</span>
      </div>
      <div className="vbody">
        <div className="vbody-inner">
          {isBroken && (
            <ChecklistCard versionName={v.version.name} items={suggestions} />
          )}
          {grouped && grouped.size > 0 ? (
            <div className="issues-scroll">
              {[...grouped.entries()].map(([filePath, issues]) => (
                <FileGroup key={filePath} filePath={filePath} issues={issues} />
              ))}
            </div>
          ) : grouped && grouped.size === 0 ? (
            <div className="empty-state">{emptyMsg}</div>
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
  downloadFile('minex-datapack-checker-report.json', JSON.stringify(result, null, 2), 'application/json')
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
  const brokenVersions = result.incompatible.filter(v => v.status !== 'outside_load_range')
  lines.push(`## Broken (${brokenVersions.length})`)
  lines.push(``)
  for (const v of brokenVersions) {
    const issues: string[] = []
    for (const i of v.mcfunction_issues ?? []) issues.push(`- [cmd] ${i.file}:${i.line} — ${i.issue}`)
    for (const i of v.registry_issues ?? []) issues.push(`- [reg] ${i.file} — ${i.issue}`)
    for (const i of v.structural_issues ?? []) issues.push(`- [struct] ${i.file} — ${i.issue}`)
    for (const i of v.reference_issues ?? []) issues.push(`- [ref] ${i.file}${i.line ? ':' + i.line : ''} — ${i.issue}`)
    for (const i of v.deprecation_issues ?? []) issues.push(`- [deprec] ${i.file} — ${i.issue}`)
    for (const bc of v.breaking_changes ?? []) issues.push(`- [breaking] ${bc}`)
    lines.push(`### ${v.version.name} (${v.version.type})`)
    lines.push(``)
    lines.push(...issues)
    lines.push(``)
  }
  if (result.knowledge_hits?.length) {
    lines.push(`## Features Requiring a Minimum Version`)
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
  downloadFile('minex-datapack-checker-report.md', lines.join('\n'), 'text/markdown')
}

function AnalysisSection({ analysis }: { analysis: AnalysisResult }) {
  const [expanded, setExpanded] = useState(false)
  const m = analysis.metrics
  const orphansByType = useMemo(() => {
    const map = new Map<string, number>()
    for (const o of analysis.orphans) {
      map.set(o.type, (map.get(o.type) ?? 0) + 1)
    }
    return [...map.entries()].sort((a, b) => b[1] - a[1])
  }, [analysis.orphans])

  const refsByType = useMemo(() => {
    const map = new Map<string, number>()
    for (const r of analysis.references) {
      map.set(r.type, (map.get(r.type) ?? 0) + 1)
    }
    return [...map.entries()].sort((a, b) => b[1] - a[1])
  }, [analysis.references])

  return (
    <div className="card analysis-section">
      <h2>
        <span className="section-icon purple">A</span>
        Pack Analysis
        <span className="sub">{m.totalResources} resources indexed</span>
      </h2>

      <div className="stats">
        <div className="stat blue">
          <div className="num">{m.totalFunctions}</div>
          <div className="label">Functions</div>
        </div>
        <div className="stat blue">
          <div className="num">{m.totalJsonFiles}</div>
          <div className="label">JSON files</div>
        </div>
        <div className="stat blue">
          <div className="num">{m.totalCommands}</div>
          <div className="label">Commands</div>
        </div>
        <div className="stat blue">
          <div className="num">{m.avgCommandsPerFunction}</div>
          <div className="label">Commands per function</div>
        </div>
        <div className="stat blue">
          <div className="num">{m.maxExecuteDepth}</div>
          <div className="label">Max execute depth</div>
        </div>
        <div className="stat red">
          <div className="num">{analysis.orphans.length}</div>
          <div className="label">Orphans</div>
        </div>
        <div className="stat red">
          <div className="num">{analysis.brokenRefs.length}</div>
          <div className="label">Broken refs</div>
        </div>
        <div className="stat red">
          <div className="num">{analysis.circularDeps.length}</div>
          <div className="label">Circular deps</div>
        </div>
      </div>

      {m.largestFunction && (
        <div className="meta-line">
          Largest function: <b>{m.largestFunction.file}</b> ({m.largestFunction.lines} lines)
        </div>
      )}

      {Object.keys(m.namespaceCounts).length > 0 && (
        <div className="meta-line">
          Namespaces: {Object.entries(m.namespaceCounts).map(([ns, count]) => (
            <span key={ns} className="namespace-pill">{ns} ({count})</span>
          ))}
        </div>
      )}

      {/* Reference types */}
      {refsByType.length > 0 && (
        <div style={{ marginTop: 12 }}>
          <div className="meta-line" style={{ fontWeight: 600 }}>Cross-file references ({analysis.references.length} total):</div>
          <div className="ref-type-grid">
            {refsByType.map(([type, count]) => (
              <span key={type} className="ref-type-pill">{type}: {count}</span>
            ))}
          </div>
        </div>
      )}

      {/* Orphans */}
      {analysis.orphans.length > 0 && (
        <div style={{ marginTop: 12 }}>
          <button className="btn btn-ghost btn-sm" onClick={() => setExpanded(e => !e)}>
            {expanded ? 'Hide' : 'Show'} orphaned resources ({analysis.orphans.length})
          </button>
          {expanded && (
            <div className="orphan-list">
              {orphansByType.map(([type, count]) => (
                <div key={type} className="orphan-type-header">
                  <span className="orphan-type">{type}</span>
                  <span className="orphan-count">{count}</span>
                </div>
              ))}
              <div style={{ marginTop: 8, fontSize: '0.8rem', color: 'var(--text-faint)' }}>
                These resources are defined but not referenced by anything in the pack.
              </div>
            </div>
          )}
        </div>
      )}

      {/* Broken references */}
      {analysis.brokenRefs.length > 0 && (
        <div style={{ marginTop: 12 }}>
          <div className="meta-line" style={{ fontWeight: 600 }}>Broken references:</div>
          {analysis.brokenRefs.slice(0, 20).map((ref, i) => (
            <div key={i} className="broken-ref-item">
              <span className="broken-ref-from">{ref.file}</span>
              <span className="broken-ref-arrow"> --{`>`}</span>
              <span className="broken-ref-to">{ref.to}</span>
              <span className="broken-ref-type">({ref.type})</span>
            </div>
          ))}
          {analysis.brokenRefs.length > 20 && (
            <div className="meta-line">...and {analysis.brokenRefs.length - 20} more</div>
          )}
        </div>
      )}

      {/* Circular dependencies */}
      {analysis.circularDeps.length > 0 && (
        <div style={{ marginTop: 12 }}>
          <div className="meta-line" style={{ fontWeight: 600, color: 'var(--red)' }}>Circular dependencies:</div>
          {analysis.circularDeps.map((cycle, i) => (
            <div key={i} className="circular-dep-item">
              {cycle.map((f, j) => (
                <span key={j}>
                  <span className="circular-dep-file">{f.split('/').pop()}</span>
                  {j < cycle.length - 1 && <span className="circular-dep-arrow"> {'->'} </span>}
                </span>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  )
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

export default function Results({ result, mode, duration, onPortTo }: Props) {
  if (!result) return null

  const [allOpen, setAllOpen] = useState(false)
  const [filterKind, setFilterKind] = useState<string | null>(null)
  const compat = result.compatible || []
  const incompat = result.incompatible || []
  const broken = incompat.filter(v => v.status !== 'outside_load_range')
  const outsideRange = incompat.filter(v => v.status === 'outside_load_range')
  const totalIssues = incompat.reduce((acc, v) => acc + issueCounts(v).total, 0)

  // Filter broken versions by selected issue kind (hide versions with 0 matching issues)
  const filteredBroken = useMemo(() => {
    if (!filterKind) return broken
    return broken.filter(v => {
      const c = issueCounts(v)
      if (filterKind === 'cmd') return c.cmd > 0
      if (filterKind === 'reg') return c.reg > 0
      if (filterKind === 'struct') return c.structural > 0
      if (filterKind === 'ref') return c.ref > 0
      if (filterKind === 'dep') return c.dep > 0
      if (filterKind === 'bc') return c.bc > 0
      return true
    })
  }, [broken, filterKind])

  const dedupedKnowledge = useMemo(() => {
    if (!result.knowledge_hits?.length) return []
    const seen = new Set<string>()
    return result.knowledge_hits.filter(h => {
      if (seen.has(h.rule.id)) return false
      seen.add(h.rule.id)
      return true
    })
  }, [result.knowledge_hits])

  const kindTotals = useMemo(() => {
    const t: Record<string, number> = { cmd: 0, reg: 0, struct: 0, ref: 0, dep: 0, bc: 0 }
    for (const v of broken) {
      const c = issueCounts(v)
      t.cmd += c.cmd
      t.reg += c.reg
      t.struct += c.structural
      t.ref += c.ref
      t.dep += c.dep
      t.bc += c.bc
    }
    return t
  }, [broken])

  const toggleFilter = useCallback((k: string) => {
    setFilterKind(cur => cur === k ? null : k)
  }, [])

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

        {/* Parser availability notice */}
        {(() => {
          const allVersions = [...(result.compatible || []), ...(result.incompatible || [])]
          const anyParserActive = allVersions.some(v => v.parserActive)
          if (allVersions.length > 0 && !anyParserActive) {
            return (
              <div className="meta-line parser-notice">
                Parser unavailable — using built-in checks
              </div>
            )
          }
          return null
        })()}

        <div className="stats">
          <div className="stat green">
            <div className="num">{compat.length}</div>
            <div className="label">Compatible</div>
          </div>
          <div className="stat red">
            <div className="num">{broken.length}</div>
            <div className="label">Broken</div>
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
              <VersionRow key={v.version.id} v={v} defaultOpen={allOpen} index={i} filterKind={filterKind} onFilterKind={toggleFilter} onPortTo={onPortTo} />
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
          <span className="sub">{filterKind ? filteredBroken.length : broken.length}</span>
        </h2>
        {broken.length > 0 && (
          <div className="filter-bar">
            <span className="filter-label">Issue type</span>
            <button className={`filter-chip${!filterKind ? ' active' : ''}`} onClick={() => setFilterKind(null)}>All</button>
            {Object.entries(KIND_META).map(([k, meta]) => (
              <button
                key={k}
                className={`filter-chip${filterKind === k ? ' active' : ''}${kindTotals[k] ? '' : ' is-empty'}`}
                onClick={() => setFilterKind(filterKind === k ? null : k)}
                disabled={!kindTotals[k] && filterKind !== k}
                title={kindTotals[k] ? `Show only ${meta.label.toLowerCase()} issues` : `No ${meta.label.toLowerCase()} issues`}
              >
                {meta.label}
                <span className="count">{kindTotals[k]}</span>
              </button>
            ))}
          </div>
        )}
        {filteredBroken.length > 0 ? (
          <div className="vlist">
            {filteredBroken.map((v, i) => (
              <VersionRow key={v.version.id} v={v} defaultOpen={allOpen} index={i} filterKind={filterKind} onFilterKind={toggleFilter} onPortTo={onPortTo} />
            ))}
          </div>
        ) : (
          <div className="empty-state">
            {filterKind
              ? `No ${KIND_META[filterKind]?.label.toLowerCase() ?? ''} issues found across versions`
              : 'No content issues found'}
          </div>
        )}
      </div>

      {/* Outside declared load range */}
      <div className="card">
        <h2>
          <span className="section-icon amber">O</span>
          Outside Declared Load Range
          <span className="sub">{outsideRange.length}</span>
        </h2>
        {outsideRange.length > 0 ? (
          <div className="vlist">
            {outsideRange.map((v, i) => (
              <VersionRow key={v.version.id} v={v} defaultOpen={allOpen} index={i} filterKind={filterKind} onFilterKind={toggleFilter} onPortTo={onPortTo} />
            ))}
          </div>
        ) : (
          <div className="empty-state">No versions outside the declared load range</div>
        )}
      </div>

      {/* Knowledge hits */}
      {dedupedKnowledge.length > 0 && (
        <div className="card">
          <h2>
            <span className="section-icon blue">F</span>
            Features Requiring a Minimum Version
            <span className="sub">{dedupedKnowledge.length} feature{dedupedKnowledge.length !== 1 ? 's' : ''}</span>
          </h2>
          <div className="knowledge-grid">
            {dedupedKnowledge.map((h, i) => (
              <KnowledgeCard key={i} h={h} idx={i} />
            ))}
          </div>
        </div>
      )}

      {/* Analysis */}
      {result.analysis && (
        <AnalysisSection analysis={result.analysis} />
      )}
    </>
  )
}
