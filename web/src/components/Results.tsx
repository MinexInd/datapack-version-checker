import { useState } from 'react'

interface Props { result: any; mode: string }

export default function Results({ result, mode }: Props) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set())

  if (!result) return null
  const compat = result.compatible || []
  const incompat = result.incompatible || []

  const toggleVersion = (id: string) => {
    setExpanded(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }

  const outside = incompat.filter((v: any) => v.status === 'outside_load_range')
  const broken = incompat.filter((v: any) => v.status !== 'outside_load_range')

  return (
    <>
      <div className="card">
        <h2>📊 Results</h2>
        {result.load_range && (
          <p style={{ fontSize: '0.85rem', color: '#8b949e', marginBottom: 8 }}>
            Load range: {result.load_range.min_name ?? result.load_range.min} – {result.load_range.max_name ?? result.load_range.max}
          </p>
        )}
        {result.min_version && (
          <p style={{ fontSize: '0.85rem', color: '#8b949e', marginBottom: 12 }}>
            Min version from content: {result.min_version}
          </p>
        )}
        <div className="result-summary">
          <div className="stat green">
            <div className="num">{compat.length}</div>
            <div className="label">Compatible</div>
          </div>
          <div className="stat red">
            <div className="num">{broken.length}</div>
            <div className="label">Broken</div>
          </div>
          <div className="stat blue">
            <div className="num">{outside.length}</div>
            <div className="label">Outside range</div>
          </div>
        </div>
      </div>

      {compat.length > 0 && (
        <div className="card">
          <h2>✅ Compatible</h2>
          <p>{compat.map((v: any) => v.version.name).join(', ')}</p>
        </div>
      )}

      {outside.length > 0 && (
        <div className="card">
          <h2>⛔ Outside Load Range</h2>
          <p>{outside.map((v: any) => v.version.name).join(', ')}</p>
        </div>
      )}

      {broken.length > 0 && (
        <div className="card">
          <h2>❌ Content Breaks</h2>
          {broken.map((v: any) => (
            <div key={v.version.id} className="version-block">
              <div className="version-header" onClick={() => toggleVersion(v.version.id)}>
                <span>{v.version.name}</span>
                <span className="badge fail">{issueCount(v)} issues</span>
              </div>
              <div className={`version-body ${expanded.has(v.version.id) ? 'open' : ''}`}>
                {renderIssues(v)}
                {renderDeprecations(v)}
              </div>
            </div>
          ))}
        </div>
      )}

      {result.knowledge_hits?.length > 0 && (
        <div className="card">
          <h2>📋 Why This Version Range</h2>
          <div className="knowledge">
            {result.knowledge_hits.map((h: any, i: number) => (
              <div key={i} className="rule">
                <div className="feature">{h.description}</div>
                <div className="minver">Requires: &gt;= {h.minVersion}</div>
                {h.fix && <div style={{ color: '#8b949e', fontSize: '0.8rem' }}>Fix: {h.fix}</div>}
                <div className="found">Found: {h.foundAt?.join(', ') || ''}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {result.breaking_changes && Object.keys(result.breaking_changes).length > 0 && (
        <div className="card">
          <h2>📜 Known Breaking Changes</h2>
          {Object.entries(result.breaking_changes).map(([ver, changes]: [string, any]) => (
            <div key={ver} className="version-block">
              <div className="version-header" onClick={() => toggleVersion('bc-' + ver)}>
                <span>{ver}</span>
                <span style={{ color: '#8b949e', fontSize: '0.8rem' }}>{changes.length} changes</span>
              </div>
              <div className={`version-body ${expanded.has('bc-' + ver) ? 'open' : ''}`}>
                {changes.map((c: string, i: number) => (
                  <div key={i} className="breaking-change">⚠ {c}</div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </>
  )
}

function issueCount(v: any): number {
  const cmd = v.command_issues?.length || 0
  const reg = v.registry_issues?.length || 0
  const str = v.structural_issues?.length || 0
  const dep = v.deprecation_issues?.length || 0
  return cmd + reg + str + dep
}

function renderIssues(v: any): JSX.Element[] {
  const all = [
    ...(v.command_issues || []).map((i: any) => ({ ...i, type: 'cmd' })),
    ...(v.registry_issues || []).map((i: any) => ({ ...i, type: 'reg' })),
    ...(v.structural_issues || []).map((i: any) => ({ ...i, type: 'struct' })),
  ]
  return all.map((i, idx) => (
    <div key={idx} className="issue">
      <span className="loc">{i.file}{i.line ? ':' + i.line : ''}</span>
      {' — '}
      {i.issue || i.message || i.error}
    </div>
  ))
}

function renderDeprecations(v: any): JSX.Element[] {
  return (v.deprecation_issues || []).map((d: any, i: number) => (
    <div key={i} className="deprec">⚠ {d.file} — {d.message || d.issue}</div>
  ))
}
