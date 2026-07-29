import { useState, useRef } from 'react'
import type { McmetaVersion, FixPreview } from '../api'
import { highlightMcfunction } from '../engine/highlight'

const TYPE_LABELS: Record<string, string> = {
  advancement_icon: 'Advancement icon format',
  biome_field_rename: 'Biome field rename',
  predicate_field_rename: 'Predicate field rename',
  registry_comment: 'Registry refs',
  mcdoc_removal: 'mcdoc removals',
  mcdoc_structural: 'mcdoc structural',
}

import type { PackFileMap } from '../api'

interface Props {
  versions: McmetaVersion[]
  fixTarget: string
  onFixTargetChange: (v: string) => void
  fixSource: string
  onFixSourceChange: (v: string) => void
  fixPreview: FixPreview | null
  onPreview: () => void
  onDownload: () => void
  loading: boolean
  hasFiles: boolean
  originalFiles?: PackFileMap | null
}

function DiffView({ file, srcContent, outContent, details }: { file: string; srcContent: string; outContent: string; details: string[] }) {
  const isJson = file.endsWith('.json')
  const srcLines = srcContent.split('\n')
  const outLines = outContent.split('\n')
  const maxLen = Math.max(srcLines.length, outLines.length)

  const changedLines = new Map<number, string>()
  for (const d of details) {
    const m = d.match(/^(.+?):(\d+):/)
    if (m) changedLines.set(parseInt(m[2]), d)
  }

  const maxLineWidth = String(maxLen).length

  if (isJson) {
    return (
      <div className="diff-view">
        <div className="diff-columns">
          <div className="diff-col">
            <div className="diff-col-header removed">Original</div>
            <pre className="diff-code" dangerouslySetInnerHTML={{ __html: srcContent.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;') }} />
          </div>
          <div className="diff-col">
            <div className="diff-col-header added">Ported</div>
            <pre className="diff-code" dangerouslySetInnerHTML={{ __html: outContent.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;') }} />
          </div>
        </div>
      </div>
    )
  }

  let diffHtml = ''
  for (let i = 0; i < maxLen; i++) {
    const lineNum = (i + 1).toString().padStart(maxLineWidth, ' ')
    const s = srcLines[i] ?? ''
    const o = outLines[i] ?? ''
    if (s !== o) {
      const d = changedLines.get(i + 1)
      const detail = d ? d.replace(/^.*?:\d+:/, '').trim() : ''
      const sHl = highlightMcfunction(s)
      const oHl = highlightMcfunction(o)
      diffHtml += `<div class="diff-line removed"><span class="diff-ln">${lineNum}</span><span class="diff-op">-</span><span class="diff-text">${sHl}</span></div>`
      diffHtml += `<div class="diff-line added"><span class="diff-ln">${lineNum}</span><span class="diff-op">+</span><span class="diff-text">${oHl}${detail ? ` <span class="diff-detail">${detail}</span>` : ''}</span></div>`
    } else {
      if (i < 3 || i >= maxLen - 2) {
        diffHtml += `<div class="diff-line context"><span class="diff-ln">${lineNum}</span><span class="diff-op"> </span><span class="diff-text">${highlightMcfunction(s)}</span></div>`
      } else if (srcLines[i - 1] !== outLines[i - 1] || srcLines[i + 1] !== outLines[i + 1]) {
        diffHtml += `<div class="diff-line context"><span class="diff-ln">${lineNum}</span><span class="diff-op"> </span><span class="diff-text">${highlightMcfunction(s)}</span></div>`
      }
    }
  }
  return <div className="diff-view" dangerouslySetInnerHTML={{ __html: diffHtml }} />
}

export default function FixPanel({
  versions,
  fixTarget, onFixTargetChange,
  fixSource, onFixSourceChange,
  fixPreview, onPreview, onDownload,
  loading, hasFiles, originalFiles,
}: Props) {
  const [expandedFiles, setExpandedFiles] = useState<Set<number>>(new Set())
  const sclRef = useRef<HTMLDivElement>(null)

  return (
    <div className="card animate-in-d3">
      <h2>Auto-Fix / Port <span className="sub">rewrites commands, fixes JSON, updates pack.mcmeta</span></h2>
      <div className="grid-2">
        <div className="field">
          <label>Target version</label>
          <select value={fixTarget} onChange={e => { onFixTargetChange(e.target.value) }}>
            <option value="">— select target —</option>
            {versions.map(v => (
              <option key={v.id} value={v.name}>{v.name}</option>
            ))}
          </select>
        </div>
        <div className="field">
          <label>Source version (optional)</label>
          <select value={fixSource} onChange={e => { onFixSourceChange(e.target.value) }}>
            <option value="">— auto-detect —</option>
            {versions.map(v => (
              <option key={v.id} value={v.name}>{v.name}</option>
            ))}
          </select>
          <div className="hint">Auto-detected from pack.mcmeta load range if blank.</div>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
        <button className="btn btn-primary" onClick={onPreview} disabled={loading || !hasFiles || !fixTarget}>
          {loading ? <><span className="spinner" /> Generating…</> : 'Preview Changes'}
        </button>
        {fixPreview && (
          <button className="btn btn-success" onClick={onDownload} disabled={loading}>
            {loading ? <><span className="spinner" /> Downloading…</> : 'Download Ported .zip'}
          </button>
        )}
      </div>

      {fixPreview && fixPreview.plan && fixPreview.plan.sourceVersion && (
        <div className="porting-plan" style={{ marginTop: 16 }}>
          <div className="plan-header">
            <span className={`plan-direction ${fixPreview.plan.direction === 'forward' ? 'fwd' : 'bwd'}`}>
              {fixPreview.plan.direction === 'forward' ? 'Upgrade' : 'Backport'}
            </span>
            <span className="plan-versions">
              {fixPreview.plan.sourceVersion} → {fixPreview.plan.targetVersion}
            </span>
            <span className="plan-file-count">{fixPreview.results.length} file{fixPreview.results.length !== 1 ? 's' : ''} changed</span>
          </div>

          <div className="stats" style={{ marginBottom: 14, marginTop: 14 }}>
            <div className="stat blue">
              <div className="num">{fixPreview.summary.filesFixed}</div>
              <div className="label">Files changed</div>
            </div>
            <div className="stat blue">
              <div className="num">{fixPreview.summary.totalPatches}</div>
              <div className="label">Total patches</div>
            </div>
            {fixPreview.plan.summary.commandRewrites > 0 && (
              <div className="stat green">
                <div className="num">{fixPreview.plan.summary.commandRewrites}</div>
                <div className="label">Cmd rewrites</div>
              </div>
            )}
            {fixPreview.plan.summary.jsonFixes > 0 && (
              <div className="stat purple">
                <div className="num">{fixPreview.plan.summary.jsonFixes}</div>
                <div className="label">JSON fixes</div>
              </div>
            )}
            {fixPreview.plan.summary.manualAttention > 0 && (
              <div className="stat red">
                <div className="num">{fixPreview.plan.summary.manualAttention}</div>
                <div className="label">Manual</div>
              </div>
            )}
          </div>

          {fixPreview.summary.errors.length > 0 && (
            <div className="error" style={{ marginBottom: 14 }}>
              <span>!</span>
              <span>{fixPreview.summary.errors.join('; ')}</span>
            </div>
          )}

          {fixPreview.results.length > 0 ? (
            <div className="scl-box" style={{ maxHeight: 500 }} ref={sclRef}>
              {fixPreview.results.map((r, i) => {
                const isExpanded = expandedFiles.has(i)
                const hasOutput = !!fixPreview.outputFiles?.[r.file]
                return (
                  <div key={i} className={`fix-file${isExpanded ? ' expanded' : ''}`}>
                    <div
                      className="fix-file-header clickable"
                      onClick={() => {
                        const next = new Set(expandedFiles)
                        if (isExpanded) next.delete(i)
                        else {
                          next.clear()
                          next.add(i)
                        }
                        setExpandedFiles(next)
                      }}
                    >
                      <span className="fix-file-icon">{isExpanded ? '▼' : '▶'}</span>
                      <span className="fix-file-path">{r.file}</span>
                      <span className="patch-count">({r.patches} patch{r.patches !== 1 ? 'es' : ''})</span>
                    </div>
                    {r.details.map((d, j) => {
                      const isCmdChange = d.includes('->')
                      const isManual = d.includes('manual') || d.includes('Manual')
                      const isError = d.includes('!') || d.includes('error') || d.includes('Error')
                      const cls = isError ? 'detail-error' : isManual ? 'detail-warn' : isCmdChange ? 'detail-ok' : ''
                      const parts = d.split(': ')
                      const detailLabel = parts.length >= 2 ? parts.slice(1).join(': ') : d
                      return (
                        <div key={j} className={`fix-detail ${cls}`}>
                          {isCmdChange && <span className="detail-arrow">→</span>}
                          {isManual && <span className="detail-icon">⚠</span>}
                          {isError && <span className="detail-icon">✗</span>}
                          <span>{detailLabel}</span>
                        </div>
                      )
                    })}
                    {isExpanded && hasOutput && (
                      <div className="fix-diff-area">
                        <DiffView
                          file={r.file}
                          srcContent={originalFiles?.[r.file] ?? ''}
                          outContent={fixPreview.outputFiles![r.file]}
                          details={r.details}
                        />
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          ) : (
            <div className="empty-sm">No changes needed — pack is already compatible with {fixTarget}</div>
          )}
        </div>
      )}
    </div>
  )
}
