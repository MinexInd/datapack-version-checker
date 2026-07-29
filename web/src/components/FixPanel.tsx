import type { McmetaVersion, FixPreview } from '../api'

const TYPE_LABELS: Record<string, string> = {
  advancement_icon: 'Advancement icon format',
  biome_field_rename: 'Biome field rename',
  predicate_field_rename: 'Predicate field rename',
  registry_comment: 'Registry refs',
  mcdoc_removal: 'mcdoc removals',
  mcdoc_structural: 'mcdoc structural',
}

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
}

export default function FixPanel({
  versions,
  fixTarget, onFixTargetChange,
  fixSource, onFixSourceChange,
  fixPreview, onPreview, onDownload,
  loading, hasFiles,
}: Props) {
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
            <div className="scl-box" style={{ maxHeight: 350 }}>
              {fixPreview.results.map((r, i) => (
                <div key={i} className="fix-file">
                  <div className="fix-file-header">
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.file}</span>
                    <span className="patch-count">({r.patches} patch{r.patches !== 1 ? 'es' : ''})</span>
                  </div>
                  {r.details.map((d, j) => (
                    <div key={j} className="fix-detail">
                      {d}
                    </div>
                  ))}
                </div>
              ))}
            </div>
          ) : (
            <div className="empty-sm">No changes needed — pack is already compatible with {fixTarget}</div>
          )}
        </div>
      )}
    </div>
  )
}
