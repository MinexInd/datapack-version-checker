import { useMemo, useState } from 'react'
import type { JsonValue } from '../../../ide/mcdoc-edit'

type Obj = Record<string, JsonValue>

function asObj(v: JsonValue | undefined): Obj {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Obj) : {}
}
function str(v: JsonValue | undefined, d = ''): string {
  return typeof v === 'string' ? v : d
}
function num(v: JsonValue | undefined, d = 0): number {
  return typeof v === 'number' ? v : d
}

interface LootFunctionEditorProps {
  value: JsonValue
  onChange: (v: JsonValue) => void
}

const COMMON_FUNCTIONS = [
  'minecraft:set_count',
  'minecraft:enchant_with_levels',
  'minecraft:enchant_randomly',
  'minecraft:set_damage',
  'minecraft:set_data',
  'minecraft:looting_enchant',
  'minecraft:set_nbt',
  'minecraft:explosion_decay',
  'minecraft:limit_count',
  'minecraft:apply_bonus',
  'minecraft:copy_name',
  'minecraft:copy_nbt',
  'minecraft:set_attributes',
  'minecraft:set_contents',
  'minecraft:set_loot_table',
  'minecraft:set_potion',
  'minecraft:smelt',
  'minecraft:fill_player_head',
  'minecraft:alternatives',
  'minecraft:sequence',
]

export default function LootFunctionEditor({ value, onChange }: LootFunctionEditorProps) {
  const obj = useMemo(() => asObj(value), [value])
  const func = str(obj.function, 'minecraft:set_count')
  const set = (k: string, v: JsonValue) => onChange({ ...obj, [k]: v })

  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})

  const renderField = (label: string, key: string, placeholder: string) => {
    const raw = typeof obj[key] === 'object' && obj[key] !== null ? JSON.stringify(obj[key], null, 2) : str(obj[key])
    const err = fieldErrors[key]
    return (
      <div className="recipe-field">
        <label>{label}</label>
        <textarea
          className={`predicate-extra-text${err ? ' invalid' : ''}`}
          value={raw}
          placeholder={placeholder}
          rows={2}
          onChange={e => {
            try {
              const parsed = JSON.parse(e.target.value)
              setFieldErrors(prev => { const n = { ...prev }; delete n[key]; return n })
              set(key, parsed)
            } catch (err: any) {
              setFieldErrors(prev => ({ ...prev, [key]: err.message }))
              set(key, e.target.value)
            }
          }}
        />
        {err && <div className="field-error">{err}</div>}
      </div>
    )
  }

  return (
    <div className="loot-function">
      <div className="recipe-field">
        <label>Function</label>
        <select value={func} onChange={e => set('function', e.target.value)}>
          {COMMON_FUNCTIONS.map(f => (
            <option key={f} value={f}>{f.replace('minecraft:', '')}</option>
          ))}
          <option value="">(custom / raw)</option>
        </select>
      </div>

      {func === 'minecraft:set_count' && renderField('Count', 'count', '1 or { "min": 1, "max": 3 }')}
      {func === 'minecraft:enchant_with_levels' && renderField('Levels', 'levels', '5 or { "min": 5, "max": 10 }')}
      {func === 'minecraft:enchant_randomly' && (
        <div className="recipe-field recipe-checkbox">
          <label>
            <input type="checkbox" checked={!!obj.treasure} onChange={e => set('treasure', e.target.checked)} />
            Treasure enchantments only
          </label>
        </div>
      )}
      {func === 'minecraft:set_damage' && renderField('Damage', 'damage', '0.5 or { "min": 0, "max": 0.5 }')}
      {func === 'minecraft:set_data' && renderField('Data', 'data', '0 or { "min": 0, "max": 3 }')}
      {func === 'minecraft:looting_enchant' && (
        <>
          {renderField('Limit', 'limit', '1')}
          {renderField('Bonus multiplier', 'bonus_multiplier', '1.0')}
        </>
      )}
      {func === 'minecraft:set_nbt' && renderField('NBT', 'tag', '{id:"minecraft:diamond",Count:1b}')}
      {func === 'minecraft:limit_count' && renderField('Limit', 'limit', '10 or { "limit": 10, "limitPerItem": 2 }')}
      {func === 'minecraft:apply_bonus' && (
        <>
          <div className="recipe-field">
            <label>Formula</label>
            <select value={str(obj.formula, 'uniform_bonus_count')} onChange={e => set('formula', e.target.value)}>
              <option value="uniform_bonus_count">uniform_bonus_count</option>
              <option value="ore_drops">ore_drops</option>
              <option value="binomial_with_bonus_count">binomial_with_bonus_count</option>
            </select>
          </div>
          {renderField('Parameters', 'parameters', '1 or [1, 2]')}
        </>
      )}
      {func === 'minecraft:set_potion' && renderField('Potion', 'potion', 'minecraft:strength')}
      {func === 'minecraft:set_contents' && renderField('Contents (JSON)', 'contents', '{ "type": "minecraft:item", "name": "minecraft:stone" }')}
      {func === 'minecraft:set_loot_table' && renderField('Loot table', 'name', 'minecraft:gameplay/hero_of_the_village/cleric')}
      {func === 'minecraft:fill_player_head' && renderField('Entity (optional)', 'entity', 'player')}
      {func === 'minecraft:copy_name' && (
        <div className="recipe-field recipe-checkbox">
          <label>
            <input type="checkbox" checked={!!obj.source} onChange={e => {
            const next = { ...obj }
            if (e.target.checked) next.source = 'block_entity'
            else delete next.source
            onChange(next)
          }} />
            Copy from block entity
          </label>
        </div>
      )}
    </div>
  )
}
