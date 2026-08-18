import { useState, useRef, useMemo } from 'react'
import type { McmetaVersion, FixPreview } from '../api'
import { highlightMcfunction, highlightJson } from '../engine/highlight'
import { diffLines } from '../diff'

const TYPE_LABELS: Record<string, string> = {
  advancement_icon: 'Advancement icon format',
  biome_field_rename: 'Biome field rename',
  predicate_field_rename: 'Predicate field rename',
  registry_comment: 'Registry refs',
  mcdoc_removal: 'mcdoc removals',
  mcdoc_structural: 'mcdoc structural',
}

import type { PackFileMap } from '../api'
import { Icon } from "./Icon";

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

  const changedLines = new Map<number, string>()
  for (const d of details) {
    const m = d.match(/^(.+?):(\d+):/)
    if (m) changedLines.set(parseInt(m[2]), d)
  }

  const { rows, added, removed, approximate } = useMemo(
    () => diffLines(srcLines, outLines),
    [srcContent, outContent],
  )

  const highlight = isJson ? highlightJson : highlightMcfunction
  const gutter = String(Math.max(srcLines.length, outLines.length)).length

  const html = rows.map(row => {
    if (row.kind === 'gap') {
      return `<div class="diff-line gap"><span class="diff-ln"></span><span class="diff-op"></span>` +
        `<span class="diff-text">${row.hidden} unchanged line${row.hidden === 1 ? '' : 's'}</span></div>`
    }

    const num = String(row.kind === 'added' ? row.outLine : row.srcLine).padStart(gutter, ' ')
    const op = row.kind === 'added' ? '+' : row.kind === 'removed' ? '-' : ' '
    const detailKey = row.kind === 'added' ? row.outLine : row.srcLine
    const raw = detailKey != null ? changedLines.get(detailKey) : undefined
    const detail = row.kind === 'added' && raw ? raw.replace(/^.*?:\d+:/, '').trim() : ''

    return `<div class="diff-line ${row.kind}"><span class="diff-ln">${num}</span>` +
      `<span class="diff-op">${op}</span><span class="diff-text">${highlight(row.text)}` +
      `${detail ? ` <span class="diff-detail">${detail}</span>` : ''}</span></div>`
  }).join('')

  return (
    <div className="diff-panel">
      <div className="diff-toolbar">
        <span className="diff-file">{file}</span>
        {approximate && <span className="diff-approx" title="File too large for an exact diff — lines are compared by position">approximate</span>}
        <span className="diff-stat">
          <span className="add">+{added}</span>
          <span className="sep">/</span>
          <span className="del">−{removed}</span>
        </span>
      </div>
      {rows.length > 0 ? (
        <div className="diff-view" dangerouslySetInnerHTML={{ __html: html }} />
      ) : (
        <div className="diff-empty">No line changes — the file was reformatted or rewritten identically.</div>
      )}
    </div>
  )
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
          <div className="hint">Auto-detected from the pack.mcmeta load range if left blank.</div>
        </div>
      </div>

      <div className="fix-actions">
        {!hasFiles && <span className="run-hint">Upload a pack first</span>}
        <button className="btn btn-primary" onClick={onPreview} disabled={loading || !hasFiles || !fixTarget} aria-busy={loading}>
          {loading ? <><span className="spinner" /> Generating…</> : 'Preview Changes'}
        </button>
        {fixPreview && (
          <button className="btn btn-success btn-lg" onClick={onDownload} disabled={loading} aria-busy={loading}>
            {loading ? <><span className="spinner" /> Downloading…</> : <><Icon name="arrow-down" size={14} /> Download Ported .zip</>}
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
              {fixPreview.plan.sourceVersion} <Icon name="arrow-right" size={14} /> {fixPreview.plan.targetVersion}
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
                <div className="label">Command rewrites</div>
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

          {fixPreview.results.length > 0 && (
            <div className="fix-toolbar">
              <span className="fix-toolbar-title">Changed files</span>
              <button className="btn btn-ghost btn-sm" onClick={() => setExpandedFiles(new Set(fixPreview.results.map((_, i) => i)))}>Expand all</button>
              <button className="btn btn-ghost btn-sm" onClick={() => setExpandedFiles(new Set())}>Collapse all</button>
            </div>
          )}

          {fixPreview.results.length > 0 ? (
            <div className="scl-box fix-file-list" ref={sclRef}>
              {fixPreview.results.map((r, i) => {
                const isExpanded = expandedFiles.has(i)
                const hasOutput = !!fixPreview.outputFiles?.[r.file]
                const toggleFile = () => {
                  const next = new Set(expandedFiles)
                  if (isExpanded) next.delete(i)
                  else {
                    next.clear()
                    next.add(i)
                  }
                  setExpandedFiles(next)
                }
                return (
                  <div key={i} className={`fix-file${isExpanded ? ' expanded' : ''}`}>
                    <div
                      className="fix-file-header clickable"
                      role="button"
                      tabIndex={0}
                      aria-expanded={isExpanded}
                      onClick={toggleFile}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault()
                          toggleFile()
                        }
                      }}
                    >
                      <span className="fix-file-icon">{isExpanded ? <Icon name="chevron-down" size={14} /> : <Icon name="chevron-right" size={14} />}</span>
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
                          {isCmdChange && <span className="detail-arrow"><Icon name="arrow-right" size={14} /></span>}
                          {isManual && <span className="detail-icon"><Icon name="warning" size={14} /></span>}
                          {isError && <span className="detail-icon"><Icon name="x-circle" size={14} /></span>}
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
            <div className="empty-ok">
              <span className="ok-icon"><Icon name="check" size={14} /></span>
              <p>No changes needed — the pack is already compatible with <b>{fixTarget}</b>.</p>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
