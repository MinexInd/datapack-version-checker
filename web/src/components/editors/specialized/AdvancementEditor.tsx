import { useMemo, useState } from 'react'
import type { SimplifiedMcdocType, JsonValue, JsonPath } from '../../../ide/mcdoc-edit'

interface AdvancementEditorProps {
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
function asArr(v: JsonValue | undefined): JsonValue[] {
  return Array.isArray(v) ? v : []
}
function str(v: JsonValue | undefined, d = ''): string {
  return typeof v === 'string' ? v : d
}
function bool(v: JsonValue | undefined, d = false): boolean {
  return typeof v === 'boolean' ? v : d
}

export default function AdvancementEditor({ type, value, path, onChange, onRemove }: AdvancementEditorProps) {
  const obj = useMemo(() => asObj(value), [value])
  const set = (field: string, v: JsonValue) => onChange([...path, field], v)

  const display = asObj(obj.display)
  const criteria = asObj(obj.criteria)
  const rewards = asObj(obj.rewards)

  const setDisplay = (v: JsonValue) => set('display', v)
  const setCriteria = (v: JsonValue) => set('criteria', v)
  const setRewards = (v: JsonValue) => set('rewards', v)

  const addCriterion = () => {
    const name = `criterion_${Object.keys(criteria).length + 1}`
    setCriteria({ ...criteria, [name]: { trigger: 'minecraft:tick' } })
  }
  const removeCriterion = (k: string) => {
    const next = { ...criteria }
    delete next[k]
    setCriteria(next)
  }
  const setCriterionTrigger = (k: string, trigger: string) => {
    setCriteria({ ...criteria, [k]: { ...asObj(criteria[k]), trigger } })
  }
  const setCriterionConditions = (k: string, conditions: JsonValue) => {
    setCriteria({ ...criteria, [k]: { ...asObj(criteria[k]), conditions } })
  }

  const loot = asArr(rewards.loot).map(l => str(l))
  const recipes = asArr(rewards.recipes).map(r => str(r))

  return (
    <div className="advancement-editor">
      <div className="advancement-editor-header">
        <h3>Advancement</h3>
      </div>

      <div className="advancement-editor-section">
        <div className="recipe-field">
          <label>Parent</label>
          <input
            type="text"
            value={str(obj.parent)}
            placeholder="minecraft:story/root"
            onChange={e => set('parent', e.target.value)}
          />
        </div>
      </div>

      <div className="advancement-editor-section">
        <h4>Display</h4>
        <div className="recipe-field">
          <label>Title</label>
          <input type="text" value={str(display.title)} onChange={e => setDisplay({ ...display, title: e.target.value })} />
        </div>
        <div className="recipe-field">
          <label>Description</label>
          <input type="text" value={str(display.description)} onChange={e => setDisplay({ ...display, description: e.target.value })} />
        </div>
        <div className="recipe-field">
          <label>Icon (item id)</label>
          <input
            type="text"
            value={str(asObj(display.icon).id)}
            placeholder="minecraft:diamond"
            onChange={e => setDisplay({ ...display, icon: { id: e.target.value, count: 1 } })}
          />
        </div>
        <div className="recipe-field">
          <label>Frame</label>
          <select value={str(display.frame, 'task')} onChange={e => setDisplay({ ...display, frame: e.target.value })}>
            <option value="task">task</option>
            <option value="goal">goal</option>
            <option value="challenge">challenge</option>
          </select>
        </div>
        <div className="recipe-field">
          <label>Background (texture path)</label>
          <input type="text" value={str(display.background)} placeholder="minecraft:textures/gui/advancements/..." onChange={e => setDisplay({ ...display, background: e.target.value })} />
        </div>
        <div className="recipe-field recipe-checkbox">
          <label>
            <input type="checkbox" checked={bool(display.hidden)} onChange={e => setDisplay({ ...display, hidden: e.target.checked })} />
            Hidden
          </label>
        </div>
        <div className="recipe-field">
          <label>Icon count</label>
          <input
            type="number"
            min={1}
            value={typeof asObj(display.icon).count === 'number' ? (asObj(display.icon).count as number) : 1}
            onChange={e => {
              const icon = asObj(display.icon)
              const cnt = parseInt(e.target.value || '1', 10)
              setDisplay({ ...display, icon: { ...icon, count: cnt } })
            }}
          />
        </div>
        <div className="recipe-field">
          <label>Icon tag</label>
          <input
            type="text"
            value={str(asObj(display.icon).tag)}
            placeholder="minecraft:some_tag"
            onChange={e => setDisplay({ ...display, icon: { ...asObj(display.icon), tag: e.target.value } })}
          />
        </div>
      </div>

      <div className="advancement-editor-section">
        <h4>Criteria</h4>
        <div className="advancement-criteria">
          {Object.entries(criteria).map(([k, v]) => (
            <div key={k} className="advancement-criterion">
              <span className="advancement-criterion-name">{k}</span>
              <select value={str(asObj(v).trigger, 'minecraft:tick')} onChange={e => setCriterionTrigger(k, e.target.value)}>
                <option value="minecraft:tick">tick</option>
                <option value="minecraft:impossible">impossible</option>
                <option value="minecraft:inventory_changed">inventory_changed</option>
                <option value="minecraft:location">location</option>
                <option value="minecraft:player_killed_entity">player_killed_entity</option>
                <option value="minecraft:entity_killed_player">entity_killed_player</option>
                <option value="minecraft:brewed_potion">brewed_potion</option>
                <option value="minecraft:used_tamed_animal">used_tamed_animal</option>
                <option value="minecraft:recipe_unlocked">recipe_unlocked</option>
                <option value="minecraft:consume_item">consume_item</option>
              </select>
              <button type="button" onClick={() => removeCriterion(k)}>✕</button>
              <JsonTextarea
                label={`${k} conditions (JSON)`}
                value={JSON.stringify(asObj(v).conditions ?? {}, null, 2)}
                placeholder='{ "items": [ { "items": ["minecraft:diamond"] } ] }'
                rows={3}
                onChange={raw => {
                  try { setCriterionConditions(k, JSON.parse(raw)) } catch { /* keep last valid */ }
                }}
              />
            </div>
          ))}
          <button type="button" onClick={addCriterion}>+ Criterion</button>
        </div>
      </div>

      <div className="advancement-editor-section">
        <h4>Rewards</h4>
        <div className="recipe-field">
          <label>Experience</label>
          <input
            type="number"
            min={0}
            value={typeof rewards.experience === 'number' ? rewards.experience : 0}
            onChange={e => setRewards({ ...rewards, experience: parseInt(e.target.value || '0', 10) })}
          />
        </div>
        <div className="recipe-field">
          <label>Function</label>
          <input type="text" value={str(rewards.function)} placeholder="minecraft:namespace/function" onChange={e => setRewards({ ...rewards, function: e.target.value })} />
        </div>
        <div className="recipe-field">
          <label>Loot tables (comma separated)</label>
          <input
            type="text"
            value={loot.join(', ')}
            placeholder="minecraft:gameplay/..."
            onChange={e => setRewards({ ...rewards, loot: e.target.value.split(',').map(s => s.trim()).filter(Boolean) })}
          />
        </div>
        <div className="recipe-field">
          <label>Recipes (comma separated)</label>
          <input
            type="text"
            value={recipes.join(', ')}
            onChange={e => setRewards({ ...rewards, recipes: e.target.value.split(',').map(s => s.trim()).filter(Boolean) })}
          />
        </div>
      </div>

      <div className="advancement-editor-section">
        <h4>Requirements</h4>
        <JsonTextarea
          label="Requirement groups (array of arrays of criterion names)"
          value={JSON.stringify(asArr(obj.requirements), null, 2)}
          placeholder='[ ["criterion_1", "criterion_2"] ]'
          rows={3}
          onChange={raw => {
            try { set('requirements', JSON.parse(raw)) } catch { /* keep last valid */ }
          }}
        />
      </div>
    </div>
  )
}

function JsonTextarea({ label, value, placeholder, rows, onChange }: {
  label: string
  value: string
  placeholder?: string
  rows?: number
  onChange: (v: string) => void
}) {
  const [error, setError] = useState('')
  const parse = (raw: string) => {
    try {
      const parsed = JSON.parse(raw)
      setError('')
      onChange(raw)
    } catch (e: any) {
      setError(e.message)
      onChange(raw)
    }
  }
  return (
    <div className="recipe-field">
      <label>{label}</label>
      <textarea
        className={`predicate-extra-text${error ? ' invalid' : ''}`}
        value={value}
        placeholder={placeholder}
        rows={rows || 3}
        onChange={e => parse(e.target.value)}
      />
      {error && <div className="field-error">{error}</div>}
    </div>
  )
}
