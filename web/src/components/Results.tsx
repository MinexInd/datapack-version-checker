import { useState } from 'react'
import type { CheckResult, VersionCompatibility, KnowledgeHit } from '../api'

interface Props {
  result: CheckResult
  mode: string
}

function issueCounts(v: VersionCompatibility) {
  const cmd = v.mcfunction_issues?.length ?? 0
  const reg = v.registry_issues?.length ?? 0
  const str = v.structural_issues?.length ?? 0
  const dep = v.deprecation_issues?.length ?? 0
  const bc = v.breaking_changes?.length ?? 0
  return { cmd, reg, str, dep, bc, total: cmd + reg + str + dep + bc }
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
      </div>

      {/* Compatible */}
      <div className="card">
        <h2>✅ Compatible Versions <span className="sub">{compat.length}</span></h2>
        {compat.length > 0 ? (
          <div className="scl-box" style={{ maxHeight: 290 }}>{compat.map(v => <VersionRow key={v.version.id} v={v} />)}</div>
        ) : (
          <div className="empty-sm">No compatible versions to show</div>
        )}
      </div>

      {/* Broken / content issues */}
      <div className="card">
        <h2>❌ Content Breaks <span className="sub">{broken.length}</span></h2>
        {broken.length > 0 ? (
          <div className="scl-box" style={{ maxHeight: 290 }}>{broken.map(v => <VersionRow key={v.version.id} v={v} />)}</div>
        ) : (
          <div className="empty-sm">No content issues found</div>
        )}
      </div>

      {/* Outside load range */}
      <div className="card">
        <h2>⛔ Outside Declared Load Range <span className="sub">{outside.length}</span></h2>
        {outside.length > 0 ? (
          <div className="scl-box" style={{ maxHeight: 290 }}>{outside.map(v => <VersionRow key={v.version.id} v={v} />)}</div>
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
