import type { Mode, McmetaVersion } from '../api'
import VersionSelector from './VersionSelector'

interface Props {
  mode: Mode
  onModeChange: (m: Mode) => void
  all: boolean
  onAllChange: (v: boolean) => void
  strict: boolean
  onStrictChange: (v: boolean) => void
  versions: McmetaVersion[]
  versionsLoading: boolean
  selectedVersions: string[]
  onSelectedVersionsChange: (v: string[]) => void
  onRun: () => void
  loading: boolean
  hasFiles: boolean
}

export default function CheckPanel({
  mode, onModeChange,
  all, onAllChange,
  strict, onStrictChange,
  versions, versionsLoading,
  selectedVersions, onSelectedVersionsChange,
  onRun, loading, hasFiles,
}: Props) {
  return (
    <div className="card animate-in-d3">
      <h2>Options</h2>

      <div className="field">
        <label>Mode</label>
        <div className="segmented">
          {(['auto', 'datapack', 'resourcepack'] as const).map(m => (
            <button key={m} className={mode === m ? 'active' : ''} onClick={() => onModeChange(m)}>
              {m === 'auto' ? 'Auto' : m === 'datapack' ? 'Datapack' : 'Resource Pack'}
            </button>
          ))}
        </div>
      </div>

      <VersionSelector
        versions={versions}
        loading={versionsLoading}
        selected={selectedVersions}
        onSelect={onSelectedVersionsChange}
      />

      <div className="checks">
        <label className="check">
          <input type="checkbox" checked={all} onChange={e => onAllChange(e.target.checked)} />
          All versions (incl. snapshots)
        </label>
        <label className="check">
          <input type="checkbox" checked={strict} onChange={e => onStrictChange(e.target.checked)} />
          Strict command validation
        </label>
      </div>

      <div className="run-row">
        <span className="run-hint">
          {!hasFiles ? (
            <span>Upload a pack first</span>
          ) : (
            <><span className="kbd">Ctrl</span>+<span className="kbd">Enter</span> to run</>
          )}
        </span>
        <button className="btn btn-primary" onClick={onRun} disabled={loading || !hasFiles} aria-busy={loading}>
          {loading ? <><span className="spinner" /> Running…</> : '▶ Run Check'}
        </button>
      </div>
    </div>
  )
}
