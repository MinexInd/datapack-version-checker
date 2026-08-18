import { useMemo } from 'react'
import type { SimplifiedMcdocType, JsonValue, JsonPath } from '../../../ide/mcdoc-edit'
import { Icon } from "../../Icon";

interface RecipeEditorProps {
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
function num(v: JsonValue | undefined, d = 0): number {
  return typeof v === 'number' ? v : d
}
function bool(v: JsonValue | undefined, d = false): boolean {
  return typeof v === 'boolean' ? v : d
}

// An ingredient/result reference: item id, tag, or plain id string.
function ItemRefEditor({ label, value, onChange }: { label: string; value: JsonValue; onChange: (v: JsonValue) => void }) {
  const obj = asObj(value)
  const mode = obj.item ? 'item' : obj.tag ? 'tag' : obj.id ? 'id' : 'item'
  const setMode = (m: 'item' | 'tag' | 'id') => {
    const ref = str(value && (value as Obj)[m as keyof Obj])
    onChange(m === 'item' ? { item: ref } : m === 'tag' ? { tag: ref } : { id: ref })
  }
  const ref = str(value && (value as Obj)[mode as keyof Obj])
  return (
    <div className="recipe-field recipe-itemref">
      <label>{label}</label>
      <div className="recipe-itemref-row">
        <select value={mode} onChange={e => setMode(e.target.value as 'item' | 'tag' | 'id')}>
          <option value="item">item</option>
          <option value="tag">tag</option>
          <option value="id">id</option>
        </select>
        <input
          type="text"
          value={ref}
          placeholder={mode === 'tag' ? 'minecraft:planks' : mode === 'id' ? 'minecraft:air' : 'minecraft:stone'}
          onChange={e => onChange(mode === 'item' ? { item: e.target.value } : mode === 'tag' ? { tag: e.target.value } : { id: e.target.value })}
        />
      </div>
    </div>
  )
}

export default function RecipeEditor({ type, value, path, onChange, onRemove }: RecipeEditorProps) {
  const obj = useMemo(() => asObj(value), [value])
  const set = (field: string, v: JsonValue) => onChange([...path, field], v)
  const recipeType = str(obj.type, 'minecraft:crafting_shaped')

  const pattern = asArr(obj.pattern).map(r => str(r))
  const keyMap = asObj(obj.key)
  const ingredients = asArr(obj.ingredients)
  const result = asObj(obj.result)
  const resultStr = str(obj.result)

  const setPatternRow = (idx: number, v: string) => {
    const next = pattern.slice()
    next[idx] = v
    set('pattern', next)
  }
  const setKeyEntry = (k: string, v: JsonValue) => {
    const next = { ...keyMap, [k]: v }
    set('key', next)
  }
  const removeKeyEntry = (k: string) => {
    const next = { ...keyMap }
    delete next[k]
    set('key', next)
  }
  const setIngredient = (idx: number, v: JsonValue) => {
    const next = ingredients.slice()
    next[idx] = v
    set('ingredients', next)
  }
  const addIngredient = () => set('ingredients', [...ingredients, { item: 'minecraft:stone' }])
  const removeIngredient = (idx: number) => set('ingredients', ingredients.filter((_, i) => i !== idx))

  return (
    <div className="recipe-editor">
      <div className="recipe-editor-header">
        <h3>Recipe</h3>
      </div>

      <div className="recipe-editor-section">
        <div className="recipe-field">
          <label>Type</label>
          <select
            value={recipeType}
            onChange={e => set('type', e.target.value)}
          >
            <option value="minecraft:crafting_shaped">Shaped Crafting</option>
            <option value="minecraft:crafting_shapeless">Shapeless Crafting</option>
            <option value="minecraft:smelting">Smelting</option>
            <option value="minecraft:blasting">Blasting</option>
            <option value="minecraft:smoking">Smoking</option>
            <option value="minecraft:campfire_cooking">Campfire Cooking</option>
            <option value="minecraft:stonecutting">Stonecutting</option>
            <option value="minecraft:smithing_transform">Smithing Transform</option>
            <option value="minecraft:smithing_trim">Smithing Trim</option>
          </select>
        </div>
      </div>

      {recipeType === 'minecraft:crafting_shaped' && (
        <div className="recipe-editor-section">
          <h4>Pattern</h4>
          <div className="recipe-pattern">
            {pattern.map((row, i) => (
              <div key={i} className="recipe-pattern-row">
                <input
                  type="text"
                  value={row}
                  placeholder="XXX"
                  onChange={e => setPatternRow(i, e.target.value)}
                />
                <button type="button" className="recipe-pattern-del" onClick={() => set('pattern', pattern.filter((_, j) => j !== i))}><Icon name="x" size={14} /></button>
              </div>
            ))}
            <button type="button" className="recipe-pattern-add" onClick={() => set('pattern', [...pattern, ''])}>+ Row</button>
          </div>
          <h4>Key</h4>
          <div className="recipe-key">
            {Object.entries(keyMap).map(([k, v]) => (
              <div key={k} className="recipe-key-row">
                <span className="recipe-key-sym">{k}</span>
                <ItemRefEditor label="" value={v} onChange={nv => setKeyEntry(k, nv)} />
                <button type="button" onClick={() => removeKeyEntry(k)}><Icon name="x" size={14} /></button>
              </div>
            ))}
            <div className="recipe-key-add">
              <input
                type="text"
                placeholder="symbol (e.g. A)"
                onKeyDown={e => {
                  if (e.key === 'Enter' && (e.target as HTMLInputElement).value) {
                    setKeyEntry((e.target as HTMLInputElement).value, { item: 'minecraft:stone' })
                    ;(e.target as HTMLInputElement).value = ''
                  }
                }}
              />
              <span className="recipe-key-hint">press Enter to add</span>
            </div>
          </div>
          <h4>Result</h4>
          <ItemRefEditor label="" value={result} onChange={v => set('result', v)} />
          <div className="recipe-field">
            <label>Count</label>
            <input
              type="number"
              min={1}
              value={num(result.count, 1)}
              onChange={e => set('result', { ...result, count: Math.max(1, parseInt(e.target.value || '1', 10)) })}
            />
          </div>
        </div>
      )}

      {recipeType === 'minecraft:crafting_shapeless' && (
        <div className="recipe-editor-section">
          <h4>Ingredients</h4>
          <div className="recipe-ingredients">
            {ingredients.map((ing, i) => (
              <div key={i} className="recipe-ingredient-row">
                <ItemRefEditor label="" value={ing} onChange={nv => setIngredient(i, nv)} />
                <button type="button" onClick={() => removeIngredient(i)}><Icon name="x" size={14} /></button>
              </div>
            ))}
            <button type="button" onClick={addIngredient}>+ Ingredient</button>
          </div>
          <h4>Result</h4>
          <ItemRefEditor label="" value={result} onChange={v => set('result', v)} />
          <div className="recipe-field">
            <label>Count</label>
            <input
              type="number"
              min={1}
              value={num(result.count, 1)}
              onChange={e => set('result', { ...result, count: Math.max(1, parseInt(e.target.value || '1', 10)) })}
            />
          </div>
        </div>
      )}

      {(recipeType === 'minecraft:smelting' || recipeType === 'minecraft:blasting' || recipeType === 'minecraft:smoking' || recipeType === 'minecraft:campfire_cooking') && (
        <div className="recipe-editor-section">
          <h4>Cooking</h4>
          <ItemRefEditor label="Ingredient" value={asObj(obj.ingredient)} onChange={v => set('ingredient', v)} />
          <div className="recipe-field">
            <label>Result (item id)</label>
            <input type="text" value={resultStr} placeholder="minecraft:iron_ingot" onChange={e => set('result', e.target.value)} />
          </div>
          <div className="recipe-field">
            <label>Experience</label>
            <input type="number" step="0.1" value={num(obj.experience, 0)} onChange={e => set('experience', parseFloat(e.target.value || '0'))} />
          </div>
          <div className="recipe-field">
            <label>Cooking time (ticks)</label>
            <input type="number" value={num(obj.cookingtime, 200)} onChange={e => set('cookingtime', parseInt(e.target.value || '200', 10))} />
          </div>
        </div>
      )}

      {recipeType === 'minecraft:stonecutting' && (
        <div className="recipe-editor-section">
          <h4>Stonecutting</h4>
          <ItemRefEditor label="Ingredient" value={asObj(obj.ingredient)} onChange={v => set('ingredient', v)} />
          <div className="recipe-field">
            <label>Result (item id)</label>
            <input type="text" value={resultStr} placeholder="minecraft:stairs" onChange={e => set('result', e.target.value)} />
          </div>
          <div className="recipe-field">
            <label>Count</label>
            <input type="number" min={1} value={num(obj.count, 1)} onChange={e => set('count', Math.max(1, parseInt(e.target.value || '1', 10)))} />
          </div>
        </div>
      )}

      {(recipeType === 'minecraft:smithing_transform' || recipeType === 'minecraft:smithing_trim') && (
        <div className="recipe-editor-section">
          <h4>Smithing</h4>
          <ItemRefEditor label="Template" value={asObj(obj.template)} onChange={v => set('template', v)} />
          <ItemRefEditor label="Base" value={asObj(obj.base)} onChange={v => set('base', v)} />
          <ItemRefEditor label="Addition" value={asObj(obj.addition)} onChange={v => set('addition', v)} />
          {recipeType === 'minecraft:smithing_transform' && (
            <>
              <div className="recipe-field">
                <label>Result (item id)</label>
                <input type="text" value={resultStr} placeholder="minecraft:netherite_chestplate" onChange={e => set('result', e.target.value)} />
              </div>
            </>
          )}
        </div>
      )}
    </div>
  )
}
