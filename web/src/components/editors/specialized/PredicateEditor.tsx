import { useMemo, useState } from 'react'
import type { SimplifiedMcdocType, JsonValue, JsonPath } from '../../../ide/mcdoc-edit'
import { Icon } from "../../Icon";

interface PredicateEditorProps {
  type: SimplifiedMcdocType | null
  value: JsonValue
  path: JsonPath
  onChange: (path: JsonPath, value: JsonValue) => void
  onRemove: (path: JsonPath) => void
}

type Obj = Record<string, JsonValue>

function asObj(v: JsonValue | undefined): Obj {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Obj) : {}
}
function str(v: JsonValue | undefined, d = ''): string {
  return typeof v === 'string' ? v : d
}
function bool(v: JsonValue | undefined, d = false): boolean {
  return typeof v === 'boolean' ? v : d
}

const LEAF_CONDITIONS = [
  'minecraft:weather_check',
  'minecraft:time_check',
  'minecraft:random_chance',
  'minecraft:random_chance_with_looting',
  'minecraft:entity_scores',
  'minecraft:lightning_strike',
  'minecraft:reference',
  'minecraft:killed_by_player',
  'minecraft:entity_hurt_player',
  'minecraft:damage_source_properties',
  'minecraft:fishing_hook',
  'minecraft:movement',
  'minecraft:parameter_count',
  'minecraft:slime',
  'minecraft:value_in_range',
]

const PROPERTY_CONDITIONS = [
  'minecraft:entity_properties',
  'minecraft:item',
  'minecraft:block',
  'minecraft:location',
  'minecraft:fluid',
  'minecraft:match_tool',
  'minecraft:ranged_value_in_range',
]

const COMPOSITE_CONDITIONS = ['minecraft:alternative', 'minecraft:all_of', 'minecraft:inverted']

const ALL_CONDITIONS = [...COMPOSITE_CONDITIONS, ...LEAF_CONDITIONS, ...PROPERTY_CONDITIONS]

// Editor for the extra (non-condition) fields of a complex property predicate.
// Shows the remaining fields as editable JSON so the structure stays valid while
// still letting advanced users set entity/item/block properties.
function ExtraFieldsEditor({ value, onChange }: { value: Obj; onChange: (v: Obj) => void }) {
  const rest = useMemo(() => {
    const { condition, ...others } = value
    return others
  }, [value])
  const [text, setText] = useState(() => JSON.stringify(rest, null, 2))
  const [error, setError] = useState<string | null>(null)

  return (
    <div className="predicate-extra">
      <label>Condition fields (JSON)</label>
      <textarea
        className="predicate-extra-text"
        value={text}
        spellCheck={false}
        onChange={e => {
          setText(e.target.value)
          try {
            const parsed = JSON.parse(e.target.value || '{}')
            setError(null)
            onChange({ condition: value.condition, ...parsed })
          } catch (err) {
            setError((err as Error).message)
          }
        }}
      />
      {error && <div className="predicate-extra-error">Invalid JSON: {error}</div>}
    </div>
  )
}

function ConditionEditor({ value, onChange, depth = 0 }: { value: JsonValue; onChange: (v: JsonValue) => void; depth?: number }) {
  const obj = asObj(value)
  const condition = str(obj.condition) || 'minecraft:alternative'
  const setField = (k: string, v: JsonValue) => onChange({ ...obj, [k]: v })

  return (
    <div className="predicate-condition-card" style={{ marginLeft: depth * 14 }}>
      <div className="predicate-condition-head">
        <select value={condition} onChange={e => setField('condition', e.target.value)}>
          {ALL_CONDITIONS.map(c => (
            <option key={c} value={c}>{c.replace('minecraft:', '')}</option>
          ))}
        </select>
      </div>

      {condition === 'minecraft:alternative' || condition === 'minecraft:all_of' ? (
        <TermsEditor value={obj.terms} onChange={v => setField('terms', v)} />
      ) : condition === 'minecraft:inverted' ? (
        <ConditionEditor value={obj.term ?? { condition: 'minecraft:reference' }} onChange={v => setField('term', v)} depth={depth + 1} />
      ) : condition === 'minecraft:reference' ? (
        <div className="recipe-field">
          <label>Predicate name</label>
          <input type="text" value={str(obj.name)} placeholder="namespace:predicate" onChange={e => setField('name', e.target.value)} />
        </div>
      ) : condition === 'minecraft:weather_check' ? (
        <div className="predicate-checks">
          <label><input type="checkbox" checked={bool(obj.raining)} onChange={e => setField('raining', e.target.checked)} /> Raining</label>
          <label><input type="checkbox" checked={bool(obj.thundering)} onChange={e => setField('thundering', e.target.checked)} /> Thundering</label>
        </div>
      ) : condition === 'minecraft:time_check' ? (
        <div className="recipe-field">
          <label>Value (ticks, or min/max)</label>
          <input type="text" value={typeof obj.value === 'number' ? String(obj.value) : str(obj.value)} placeholder="6000" onChange={e => {
            const raw = e.target.value.trim()
            const n = Number(raw)
            setField('value', raw.includes(',') || isNaN(n) ? raw : n)
          }} />
          <label>Period</label>
          <input type="number" value={typeof obj.period === 'number' ? obj.period : 0} onChange={e => setField('period', parseInt(e.target.value || '0', 10))} />
        </div>
      ) : condition === 'minecraft:random_chance' ? (
        <div className="recipe-field">
          <label>Chance (0–1)</label>
          <input type="number" step="0.01" min={0} max={1} value={typeof obj.chance === 'number' ? obj.chance : 0} onChange={e => setField('chance', parseFloat(e.target.value || '0'))} />
        </div>
      ) : condition === 'minecraft:random_chance_with_looting' ? (
        <div className="recipe-fields-row">
          <div className="recipe-field"><label>Chance</label><input type="number" step="0.01" value={typeof obj.chance === 'number' ? obj.chance : 0} onChange={e => setField('chance', parseFloat(e.target.value || '0'))} /></div>
          <div className="recipe-field"><label>Looting multiplier</label><input type="number" step="0.01" value={typeof obj.looting_multiplier === 'number' ? obj.looting_multiplier : 0} onChange={e => setField('looting_multiplier', parseFloat(e.target.value || '0'))} /></div>
        </div>
      ) : condition === 'minecraft:entity_scores' ? (
        <ScoresEditor value={obj.scores} onChange={v => setField('scores', v)} />
      ) : condition === 'minecraft:lightning_strike' ? (
        <div className="predicate-checks">
          <label><input type="checkbox" checked={bool(obj.lightning)} onChange={e => setField('lightning', e.target.checked)} /> Lightning</label>
        </div>
      ) : PROPERTY_CONDITIONS.includes(condition) ? (
        <ExtraFieldsEditor value={obj} onChange={v => onChange(v)} />
      ) : (
        <ExtraFieldsEditor value={obj} onChange={v => onChange(v)} />
      )}
    </div>
  )
}

function TermsEditor({ value, onChange }: { value: JsonValue; onChange: (v: JsonValue) => void }) {
  const terms = Array.isArray(value) ? (value as JsonValue[]) : []
  const setTerm = (idx: number, v: JsonValue) => onChange(terms.map((t, i) => (i === idx ? v : t)))
  const addTerm = () => onChange([...terms, { condition: 'minecraft:reference' }])
  const removeTerm = (idx: number) => onChange(terms.filter((_, i) => i !== idx))
  return (
    <div className="predicate-terms">
      {terms.map((t, i) => (
        <div key={i} className="predicate-term">
          <ConditionEditor value={t} onChange={v => setTerm(i, v)} depth={1} />
          <button type="button" className="predicate-term-del" onClick={() => removeTerm(i)}><Icon name="x" size={14} /></button>
        </div>
      ))}
      <button type="button" onClick={addTerm}>+ Condition</button>
    </div>
  )
}

function ScoresEditor({ value, onChange }: { value: JsonValue; onChange: (v: JsonValue) => void }) {
  const scores = asObj(value)
  const setScore = (k: string, v: JsonValue) => onChange({ ...scores, [k]: v })
  const removeScore = (k: string) => {
    const next = { ...scores }
    delete next[k]
    onChange(next)
  }
  return (
    <div className="predicate-scores">
      {Object.entries(scores).map(([k, v]) => (
        <div key={k} className="predicate-score-row">
          <input type="text" value={k} onChange={e => { const next = { ...scores }; delete next[k]; next[e.target.value] = v; onChange(next) }} />
          <input type="text" value={str(v)} placeholder="min..max" onChange={e => setScore(k, e.target.value)} />
          <button type="button" onClick={() => removeScore(k)}><Icon name="x" size={14} /></button>
        </div>
      ))}
      <button type="button" onClick={() => onChange({ ...scores, new_objective: '0..' })}>+ Score</button>
    </div>
  )
}

export default function PredicateEditor({ type, value, path, onChange, onRemove }: PredicateEditorProps) {
  const obj = useMemo(() => asObj(value), [value])
  return (
    <div className="predicate-editor">
      <div className="predicate-editor-header">
        <h3>Predicate</h3>
      </div>
      <div className="predicate-editor-section">
        <ConditionEditor value={obj} onChange={v => onChange(path, v)} />
      </div>
    </div>
  )
}
