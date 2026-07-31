import { useState, useMemo } from 'react'
import type { McmetaVersion } from '../api'

interface Props {
  versions: McmetaVersion[]
  loading: boolean
  selected: string[]
  onSelect: (names: string[]) => void
}

export default function VersionSelector({ versions, loading, selected, onSelect }: Props) {
  const [search, setSearch] = useState('')

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return versions
    return versions.filter(v =>
      v.name.toLowerCase().includes(q) ||
      v.id.toLowerCase().includes(q) ||
      v.type.toLowerCase().includes(q)
    )
  }, [versions, search])

  const toggle = (name: string) => {
    onSelect(
      selected.includes(name)
        ? selected.filter(v => v !== name)
        : [...selected, name]
    )
  }

  return (
    <div className="field">
      <label>
        Versions to check
        <span style={{ color: 'var(--text-faint)', fontWeight: 400, marginLeft: 6 }}>
          (empty = auto-select around your pack's load range)
        </span>
      </label>
      {loading ? (
        <div className="hint">Loading versions…</div>
      ) : (
        <>
          <input
            type="text"
            placeholder="Search versions (e.g. 1.20, 24w, snapshot)…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            style={{ marginBottom: 10 }}
          />
          <div className="scl-list">
            {filtered.map(v => {
              const isSel = selected.includes(v.name)
              return (
                <div
                  key={v.id}
                  className={`scl-row ${isSel ? 'sel' : ''}`}
                  role="checkbox"
                  aria-checked={isSel}
                  tabIndex={0}
                  onClick={() => toggle(v.name)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault()
                      toggle(v.name)
                    }
                  }}
                >
                  <span className="scl-check">{isSel ? '✓' : ''}</span>
                  <span className="scl-name">{v.name}</span>
                  <span className={`scl-tag ${v.type === 'snapshot' ? 'snap' : 'rel'}`}>{v.type}</span>
                </div>
              )
            })}
          </div>
        </>
      )}
      <div className="hint" style={{ marginTop: 6, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <span>{versions.length} versions{search ? `, ${filtered.length} match` : ''}</span>
        <span style={{ display: 'flex', gap: 6 }}>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => onSelect(filtered.filter(v => v.type === 'release').map(v => v.name))}>Releases</button>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => onSelect(filtered.filter(v => v.type === 'snapshot').map(v => v.name))}>Snapshots</button>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => onSelect(filtered.map(v => v.name))}>All</button>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => onSelect([])}>Clear</button>
        </span>
        {selected.length > 0 && (
          <span style={{ color: 'var(--accent)', fontSize: '0.76rem', fontWeight: 600 }}>{selected.length} selected</span>
        )}
      </div>
    </div>
  )
}
