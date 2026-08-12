import { useEffect, useMemo, useRef, useState } from 'react'
import type { McmetaVersion, Mode } from '../../api'
import {
  readMcmeta,
  writeMcmeta,
  parseFormatInput,
  type McmetaFormState,
} from '../../ide/pack-mcmeta-edit'

// Pause after typing before committing free-text fields to App state.
// Longer than a single keystroke burst, short enough to feel live.
const COMMIT_DEBOUNCE_MS = 300

interface McmetaEditorProps {
  content: string
  onChange: (next: string) => void
  versions: McmetaVersion[]
  mode: Mode
  onShowJson: () => void
}

/** Render the form's primary format as editable text for the custom input. */
function formatToText(state: McmetaFormState): string {
  if (state.style === 'new-style' && state.minFormat) {
    return `${state.minFormat[0]}.${state.minFormat[1]}`
  }
  if (typeof state.packFormat === 'number') return String(state.packFormat)
  return ''
}

function McmetaHeader({ mode, onShowJson }: { mode: Mode; onShowJson: () => void }) {
  const badge =
    mode === 'resourcepack' ? 'RESOURCE PACK' : mode === 'datapack' ? 'DATAPACK' : null
  return (
    <div className="mcmeta-form-head">
      <div className="mcmeta-form-title">
        <span className="mcmeta-form-name">pack.mcmeta</span>
        {badge && <span className="mcmeta-badge">{badge}</span>}
      </div>
      <button type="button" className="mcmeta-btn-ghost" onClick={onShowJson}>
        Show JSON
      </button>
    </div>
  )
}

export default function McmetaEditor({
  content,
  onChange,
  versions,
  mode,
  onShowJson,
}: McmetaEditorProps) {
  const parsed = useMemo(() => readMcmeta(content), [content])

  const isRp = mode === 'resourcepack'
  const fmtOf = (v: McmetaVersion) => (isRp ? v.resource_pack_version : v.data_pack_version)
  const minorOf = (v: McmetaVersion) =>
    isRp ? v.resource_pack_version_minor : v.data_pack_version_minor

  // When JSON is invalid we still render the (disabled) form plus a banner,
  // so the spec's "inputs disabled (read-only)" state is honoured.
  const disabled = !parsed.ok
  const state: McmetaFormState = parsed.ok
    ? parsed.state
    : {
        style: null,
        packFormat: null,
        minFormat: null,
        maxFormat: null,
        description: '',
        supported: null,
      }

  const commit = (patch: Partial<McmetaFormState>) => {
    if (!parsed.ok) return
    const nextState: McmetaFormState = { ...parsed.state, ...patch }
    onChange(writeMcmeta(parsed.raw, nextState))
  }

  // Free-text inputs are locally controlled so a keystroke never round-trips
  // through App state (which re-renders the whole IDE before the input can
  // update — the source of the "laggy" feel). Commits are debounced and
  // flushed on blur/unmount, keeping the live write-back semantics.
  const [descText, setDescText] = useState(() =>
    parsed.ok ? parsed.state.description : '',
  )
  const [customText, setCustomText] = useState(() =>
    parsed.ok ? formatToText(parsed.state) : '',
  )
  const [descFocused, setDescFocused] = useState(false)
  const [customFocused, setCustomFocused] = useState(false)
  const commitRef = useRef(commit)
  commitRef.current = commit
  const descTextRef = useRef(descText)
  descTextRef.current = descText
  const customTextRef = useRef(customText)
  customTextRef.current = customText
  const descTimer = useRef<number | undefined>(undefined)
  const customTimer = useRef<number | undefined>(undefined)

  const commitCustomValue = (text: string) => {
    if (!parsed.ok) return
    const parsedVal = parseFormatInput(text)
    if (parsedVal === null) return
    if (Array.isArray(parsedVal)) {
      if (parsed.state.style === 'new-style') {
        commit({ minFormat: parsedVal, maxFormat: parsedVal })
      } else {
        commit({ packFormat: parsedVal[0] })
      }
    } else if (parsed.state.style === 'new-style') {
      commit({ minFormat: [parsedVal, 0], maxFormat: [parsedVal, 0] })
    } else {
      commit({ packFormat: parsedVal })
    }
  }
  const commitCustomRef = useRef(commitCustomValue)
  commitCustomRef.current = commitCustomValue

  const debounceCommit = (
    timer: { current: number | undefined },
    fn: () => void,
  ) => {
    if (timer.current !== undefined) clearTimeout(timer.current)
    timer.current = window.setTimeout(() => {
      timer.current = undefined
      fn()
    }, COMMIT_DEBOUNCE_MS)
  }

  // Re-sync local text when content changes externally (e.g. JSON toggle
  // round-trip), but never while the user is actively typing in that field.
  useEffect(() => {
    if (!parsed.ok) return
    if (!descFocused) setDescText(parsed.state.description)
    if (!customFocused) setCustomText(formatToText(parsed.state))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [content])

  // Flush pending edits when the form unmounts so the last keystrokes
  // (e.g. just before clicking "Show JSON") are not lost.
  useEffect(() => {
    return () => {
      if (descTimer.current !== undefined) {
        clearTimeout(descTimer.current)
        commitRef.current({ description: descTextRef.current })
      }
      if (customTimer.current !== undefined) {
        clearTimeout(customTimer.current)
        commitCustomRef.current(customTextRef.current)
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const matchedVersion = useMemo(() => {
    if (state.style === 'new-style') {
      if (!state.minFormat) return null
      return (
        versions.find(
          v => fmtOf(v) === state.minFormat![0] && minorOf(v) === state.minFormat![1],
        ) ?? null
      )
    }
    if (typeof state.packFormat === 'number') {
      return versions.find(v => fmtOf(v) === state.packFormat) ?? null
    }
    return null
  }, [state.style, state.minFormat, state.packFormat, versions, isRp])

  const handleVersionSelect = (id: string) => {
    if (id === '__custom__') return
    const v = versions.find(x => x.id === id)
    if (!v) return
    const major = fmtOf(v)
    const minor = minorOf(v)
    if (state.style === 'new-style') {
      commit({ minFormat: [major, minor], maxFormat: [major, minor] })
    } else {
      commit({ packFormat: major })
    }
  }

  const handleCustomChange = (text: string) => {
    setCustomText(text)
    if (parseFormatInput(text) === null) return
    debounceCommit(customTimer, () => commitCustomRef.current(text))
  }

  const handleCustomBlur = () => {
    setCustomFocused(false)
    if (customTimer.current !== undefined) {
      clearTimeout(customTimer.current)
      customTimer.current = undefined
      commitCustomRef.current(customTextRef.current)
    }
  }

  const handleDescChange = (text: string) => {
    setDescText(text)
    debounceCommit(descTimer, () => commitRef.current({ description: text }))
  }

  const handleDescBlur = () => {
    setDescFocused(false)
    if (descTimer.current !== undefined) {
      clearTimeout(descTimer.current)
      descTimer.current = undefined
      commitRef.current({ description: descTextRef.current })
    }
  }

  const rangeOn = state.supported !== null
  const handleRangeToggle = (on: boolean) => {
    if (on) {
      const base = matchedVersion ?? versions[0]
      const major = base ? fmtOf(base) : 0
      commit({ supported: { min: major, max: major } })
    } else {
      commit({ supported: null })
    }
  }

  const handleRangeBound = (bound: 'min' | 'max', id: string) => {
    const v = versions.find(x => x.id === id)
    if (!v) return
    const major = fmtOf(v)
    const cur = state.supported ?? { min: major, max: major }
    commit({ supported: { ...cur, [bound]: major } })
  }

  return (
    <div className="mcmeta-form">
      <McmetaHeader mode={mode} onShowJson={onShowJson} />
      <div className="mcmeta-form-body">
        {disabled && (
          <div className="mcmeta-error" role="alert">
            <span className="mcmeta-error-icon">!</span>
            <div className="mcmeta-error-body">
              <div className="mcmeta-error-title">This pack.mcmeta is not valid JSON</div>
              <div className="mcmeta-error-detail">{parsed.error}</div>
            </div>
            <button type="button" className="mcmeta-btn-ghost" onClick={onShowJson}>
              Open in JSON view
            </button>
          </div>
        )}

        {/* Pack version */}
        <section className="mcmeta-section">
          <div className="mcmeta-section-label">Pack version</div>
          <div className="mcmeta-row">
            <select
              className="mcmeta-select"
              disabled={disabled}
              value={matchedVersion ? matchedVersion.id : '__custom__'}
              onChange={e => handleVersionSelect(e.target.value)}
            >
              {!matchedVersion && <option value="__custom__">Custom</option>}
              {versions.map(v => (
                <option key={v.id} value={v.id}>
                  {`${v.name} (${state.style === 'new-style' ? `${fmtOf(v)}.${minorOf(v)}` : fmtOf(v)})`}
                </option>
              ))}
            </select>
          </div>
          <div className="mcmeta-row mcmeta-row-custom">
            <label className="mcmeta-inline-label">or custom</label>
            <input
              className="mcmeta-input mcmeta-input-custom"
              type="text"
              inputMode="decimal"
              spellCheck={false}
              disabled={disabled}
              placeholder={state.style === 'new-style' ? '61.0' : '61'}
              value={customText}
              onFocus={() => setCustomFocused(true)}
              onBlur={handleCustomBlur}
              onChange={e => handleCustomChange(e.target.value)}
            />
          </div>
          {state.style === 'new-style' && (
            <div className="mcmeta-hint">
              {`min_format [${state.minFormat?.[0] ?? 0}, ${state.minFormat?.[1] ?? 0}] · max_format [${state.maxFormat?.[0] ?? 0}, ${state.maxFormat?.[1] ?? 0}]`}
            </div>
          )}
        </section>

        {/* Description */}
        <section className="mcmeta-section">
          <div className="mcmeta-section-label">Description</div>
          <input
            className="mcmeta-input"
            type="text"
            spellCheck={false}
            disabled={disabled}
            value={descText}
            placeholder="A short pack description"
            onFocus={() => setDescFocused(true)}
            onBlur={handleDescBlur}
            onChange={e => handleDescChange(e.target.value)}
          />
        </section>

        {/* Supported formats — legacy style only */}
        {state.style !== 'new-style' && (
          <section className="mcmeta-section">
            <div className="mcmeta-section-label">Supported formats</div>
            <div className="mcmeta-segmented" role="group" aria-label="Supported formats mode">
              <button
                type="button"
                className={`mcmeta-seg${!rangeOn ? ' active' : ''}`}
                disabled={disabled}
                onClick={() => handleRangeToggle(false)}
              >
                Match version only
              </button>
              <button
                type="button"
                className={`mcmeta-seg${rangeOn ? ' active' : ''}`}
                disabled={disabled}
                onClick={() => handleRangeToggle(true)}
              >
                Range
              </button>
            </div>
            {rangeOn && (
              <div className="mcmeta-range">
                <select
                  className="mcmeta-select"
                  disabled={disabled}
                  aria-label="Minimum supported version"
                  value={versions.find(v => fmtOf(v) === state.supported?.min)?.id ?? ''}
                  onChange={e => handleRangeBound('min', e.target.value)}
                >
                  {versions.map(v => (
                    <option key={v.id} value={v.id}>{`${v.name} (${fmtOf(v)})`}</option>
                  ))}
                </select>
                <span className="mcmeta-range-sep">to</span>
                <select
                  className="mcmeta-select"
                  disabled={disabled}
                  aria-label="Maximum supported version"
                  value={versions.find(v => fmtOf(v) === state.supported?.max)?.id ?? ''}
                  onChange={e => handleRangeBound('max', e.target.value)}
                >
                  {versions.map(v => (
                    <option key={v.id} value={v.id}>{`${v.name} (${fmtOf(v)})`}</option>
                  ))}
                </select>
              </div>
            )}
          </section>
        )}
      </div>
    </div>
  )
}
