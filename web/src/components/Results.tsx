import { useState } from 'react'
import type { CheckResult, VersionCompatibility, KnowledgeHit, ReferenceIssue } from '../api'

interface Props {
  result: CheckResult
  mode: string
}

function issueCounts(v: VersionCompatibility) {
  const cmd = v.mcfunction_issues?.length ?? 0
  const reg = v.registry_issues?.length ?? 0
  const str = v.structural_issues?.length ?? 0
  const dep = v.deprecation_issues?.length ?? 0
  const ref = v.reference_issues?.length ?? 0
  const bc = v.breaking_changes?.length ?? 0
  return { cmd, reg, str, dep, ref, bc, total: cmd + reg + str + dep + ref + bc }
}

function IssueGroup({ kind, title, count, children }: { kind: string; title: string; count: number; children: React.ReactNode }) {
  if (count === 0) return null
  return (
    <div className="issue-group">
      <div className={`issue-group-title ${kind}`}>
        {title} <span style={{ opacity: 0.6 }}>({count})</span>
      </div>
      {children}
    </div>
  )
}

function VersionRow({ v }: { v: VersionCompatibility }) {
  const [open, setOpen] = useState(false)
  const c = issueCounts(v)
  const tagClass = v.version.type === 'snapshot' ? 'snapshot' : 'release'

  return (
    <div className={`vrow ${open ? 'open' : ''}`}>
      <div className="vhead" onClick={() => setOpen(o => !o)}>
        <span className="vname">{v.version.name}</span>
        <span className={`vtag ${tagClass}`}>{v.version.type}</span>
        <div className="spacer" />
        <div className="issue-counts">
          {v.status === 'compatible' ? (
            <span className="pill ok">✓ compatible</span>
          ) : (
            <>
              {c.cmd > 0 && <span className="pill cmd">⛔ {c.cmd} cmd</span>}
              {c.reg > 0 && <span className="pill reg">⚠ {c.reg} reg</span>}
              {c.str > 0 && <span className="pill struct">▦ {c.str} struct</span>}
              {c.ref > 0 && <span className="pill ref">🔗 {c.ref} ref</span>}
              {c.dep > 0 && <span className="pill dep">↺ {c.dep} deprec</span>}
              {v.status === 'outside_load_range' && <span className="badge outside">outside range</span>}
            </>
          )}
        </div>
        <span className="chev">▶</span>
      </div>
      <div className="vbody">
        <div className="vbody-inner">
          {v.status === 'outside_load_range' && (
            <div className="meta-line" style={{ marginTop: 12 }}>
              This version is <b>outside the pack's declared load range</b> — Minecraft will not load the pack here.
            </div>
          )}

          <IssueGroup kind="cmd" title="Command Issues" count={c.cmd}>
            {(v.mcfunction_issues ?? []).map((i, idx) => (
              <div key={idx} className="issue cmd">
                <span className="loc">{i.file}<span className="ln">:{i.line}</span></span>
                {' — '}<span className="msg">{i.issue}</span>
              </div>
            ))}
          </IssueGroup>

          <IssueGroup kind="reg" title="Registry Issues" count={c.reg}>
            {(v.registry_issues ?? []).map((i, idx) => (
              <div key={idx} className="issue reg">
                <span className="loc">{i.file}</span>
                {' — '}<span className="msg">{i.issue}</span>
              </div>
            ))}
          </IssueGroup>

          <IssueGroup kind="struct" title="Structural Issues (mcdoc)" count={c.str}>
            {(v.structural_issues ?? []).map((i, idx) => (
              <div key={idx} className="issue struct">
                <span className="loc">{i.file}</span>
                {' — '}<span className="msg">{i.issue}</span>
              </div>
            ))}
          </IssueGroup>

          <IssueGroup kind="ref" title="Broken References" count={c.ref}>
            {(v.reference_issues ?? []).map((i, idx) => (
              <div key={idx} className="issue ref">
                <span className="loc">{i.file}{i.line ? <span className="ln">:{i.line}</span> : ''}</span>
                {' — '}<span className="msg">{i.issue}</span>
                {i.code && (
                  <div className="code-snippet">{i.code}</div>
                )}
              </div>
            ))}
          </IssueGroup>

          <IssueGroup kind="dep" title="Deprecations (removed entries)" count={c.dep}>
            {(v.deprecation_issues ?? []).map((i, idx) => (
              <div key={idx} className="issue dep">
                <span className="loc">{i.file}</span>
                {' — '}<span className="msg">{i.issue}</span>
              </div>
            ))}
          </IssueGroup>

          <IssueGroup kind="bc" title="Breaking Changes" count={c.bc}>
            {(v.breaking_changes ?? []).map((bc, idx) => (
              <div key={idx} className="breaking">⚠ {bc}</div>
            ))}
          </IssueGroup>
        </div>
      </div>
    </div>
  )
}

function KnowledgeCard({ h, idx }: { h: KnowledgeHit; idx: number }) {
  const rule = h.rule
  return (
    <div className="krule" key={idx}>
      <div className="kfeat">{rule.description}</div>
      <div className="kmin">Requires: ≥ {rule.minVersion}</div>
      {rule.fix && <div className="kfix">Fix: {rule.fix}</div>}
      {h.file && (
        <div className="kfound">
          Found: {h.file}{h.line ? ':' + h.line : ''}
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

export default function Results({ result, mode }: Props) {
  if (!result) return null

  const compat = result.compatible || []
  const incompat = result.incompatible || []
  const outside = incompat.filter(v => v.status === 'outside_load_range')
  const broken = incompat.filter(v => v.status !== 'outside_load_range')
  const totalIssues = incompat.reduce((acc, v) => acc + issueCounts(v).total, 0)

  return (
    <>
      {/* Summary */}
      <div className="card">
        <h2>📊 Results <span className="sub">{result.versions_checked} versions checked</span></h2>
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
          <div className="stats" style={{ marginTop: 14 }}>
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
        <div style={{ marginTop: 12, display: 'flex', gap: 8 }}>
          <button className="btn btn-ghost btn-sm" onClick={() => exportJson(result)}>⬇ Export JSON</button>
          <button className="btn btn-ghost btn-sm" onClick={() => exportMarkdown(result)}>⬇ Export Markdown</button>
        </div>
      </div>

      {/* Compatible */}
      <div className="card">
        <h2>✅ Compatible Versions <span className="sub">{compat.length}</span></h2>
        {compat.length > 0 ? (
          <div className="vlist">{compat.map(v => <VersionRow key={v.version.id} v={v} />)}</div>
        ) : (
          <div className="empty-sm">No compatible versions to show</div>
        )}
      </div>

      {/* Broken / content issues */}
      <div className="card">
        <h2>❌ Content Breaks <span className="sub">{broken.length}</span></h2>
        {broken.length > 0 ? (
          <div className="vlist">{broken.map(v => <VersionRow key={v.version.id} v={v} />)}</div>
        ) : (
          <div className="empty-sm">No content issues found</div>
        )}
      </div>

      {/* Outside load range */}
      <div className="card">
        <h2>⛔ Outside Declared Load Range <span className="sub">{outside.length}</span></h2>
        {outside.length > 0 ? (
          <div className="vlist">{outside.map(v => <VersionRow key={v.version.id} v={v} />)}</div>
        ) : (
          <div className="empty-sm">All versions are within the declared load range</div>
        )}
      </div>

      {/* Knowledge hits (deduplicated by rule.id) */}
      {result.knowledge_hits?.length > 0 && (() => {
        const seen = new Set<string>()
        const unique = result.knowledge_hits.filter(h => {
          if (seen.has(h.rule.id)) return false
          seen.add(h.rule.id)
          return true
        })
        return (
          <div className="card">
            <h2>📋 Features Setting Minimum Version <span className="sub">{unique.length} feature{unique.length !== 1 ? 's' : ''} found in content</span></h2>
            <div className="scl-box" style={{ maxHeight: 430 }}>
              {unique.map((h, i) => (
                <KnowledgeCard key={i} h={h} idx={i} />
              ))}
            </div>
          </div>
        )
      })()}
    </>
  )
}
