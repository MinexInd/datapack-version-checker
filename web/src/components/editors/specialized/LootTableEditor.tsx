import { useMemo } from 'react'
import type { JsonPath, JsonValue, SimplifiedMcdocType } from '../../../ide/mcdoc-edit'
import LootFunctionEditor from './LootFunctionEditor'
import { Icon } from "../../Icon";

interface LootTableEditorProps {
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

export default function LootTableEditor({ type, value, path, onChange, onRemove }: LootTableEditorProps) {
  const obj = useMemo(() => asObj(value), [value])
  const set = (field: string, v: JsonValue) => onChange([...path, field], v)
  const pools = asArr(obj.pools)

  const setPool = (idx: number, v: JsonValue) => {
    const next = pools.slice()
    next[idx] = v
    set('pools', next)
  }
  const addPool = () =>
    set('pools', [...pools, { rolls: 1, entries: [{ type: 'minecraft:item', name: 'minecraft:stone', weight: 1 }] }])
  const removePool = (idx: number) => set('pools', pools.filter((_, i) => i !== idx))

  const setEntry = (pIdx: number, eIdx: number, v: JsonValue) => {
    const pool = asObj(pools[pIdx])
    const entries = asArr(pool.entries).slice()
    entries[eIdx] = v
    setPool(pIdx, { ...pool, entries })
  }
  const addEntry = (pIdx: number) => {
    const pool = asObj(pools[pIdx])
    const entries = asArr(pool.entries)
    setPool(pIdx, { ...pool, entries: [...entries, { type: 'minecraft:item', name: 'minecraft:stone', weight: 1 }] })
  }
  const removeEntry = (pIdx: number, eIdx: number) => {
    const pool = asObj(pools[pIdx])
    const entries = asArr(pool.entries).filter((_, i) => i !== eIdx)
    setPool(pIdx, { ...pool, entries })
  }

  const setFunctions = (pIdx: number, eIdx: number, funcs: JsonValue[]) => {
    const pool = asObj(pools[pIdx])
    const entries = asArr(pool.entries).slice()
    const entry = asObj(entries[eIdx])
    const updated = funcs.length ? { ...entry, functions: funcs } : (() => { const { functions: _f, ...rest } = entry; return rest })()
    entries[eIdx] = updated
    setPool(pIdx, { ...pool, entries })
  }
  const addFunction = (pIdx: number, eIdx: number) => {
    const pool = asObj(pools[pIdx])
    const entries = asArr(pool.entries).slice()
    const entry = asObj(entries[eIdx])
    const funcs = asArr(entry.functions)
    const updatedEntries = entries.map((en, i) => (i === eIdx ? { ...asObj(en), functions: [...funcs, { function: 'minecraft:set_count', count: 1 }] as JsonValue[] } : en))
    setPool(pIdx, { ...pool, entries: updatedEntries as JsonValue[] })
  }
  const removeFunction = (pIdx: number, eIdx: number, fIdx: number) => {
    const pool = asObj(pools[pIdx])
    const entries = asArr(pool.entries).slice()
    const entry = asObj(entries[eIdx])
    const funcs = asArr(entry.functions).filter((_, i) => i !== fIdx)
    const updated = funcs.length ? { ...entry, functions: funcs } : (() => { const { functions: _f, ...rest } = entry; return rest })()
    entries[eIdx] = updated
    setPool(pIdx, { ...pool, entries })
  }

  return (
    <div className="loot-table-editor">
      <div className="loot-table-editor-header">
        <h3>Loot Table</h3>
        <button type="button" onClick={addPool}>+ Pool</button>
      </div>

      <div className="loot-table-editor-section">
        {pools.length === 0 && <div className="loot-table-empty">No pools — add one to begin.</div>}
        {pools.map((p, pIdx) => {
          const pool = asObj(p)
          const entries = asArr(pool.entries)
          return (
            <div key={pIdx} className="loot-pool">
              <div className="loot-pool-header">
                <strong>Pool {pIdx + 1}</strong>
                <button type="button" onClick={() => removePool(pIdx)}><Icon name="x" size={14} /></button>
              </div>
              <div className="loot-pool-fields">
                <div className="recipe-field">
                  <label>Rolls</label>
                  <input
                    type="number"
                    min={0}
                    step="0.5"
                    value={num(pool.rolls, 1)}
                    onChange={e => setPool(pIdx, { ...pool, rolls: parseFloat(e.target.value || '1') })}
                  />
                </div>
                <div className="recipe-field">
                  <label>Bonus rolls</label>
                  <input
                    type="number"
                    min={0}
                    step="0.5"
                    value={num(pool.bonus_rolls, 0)}
                    onChange={e => setPool(pIdx, { ...pool, bonus_rolls: parseFloat(e.target.value || '0') })}
                  />
                </div>
              </div>
              <h4>Entries</h4>
              <div className="loot-pool-items">
                {entries.map((en, eIdx) => {
                  const entry = asObj(en)
                  const functions = asArr(entry.functions)
                  return (
                    <div key={eIdx} className="loot-entry">
                      <div className="loot-entry-row">
                        <select
                          value={str(entry.type, 'minecraft:item')}
                          onChange={e => setEntry(pIdx, eIdx, { ...entry, type: e.target.value })}
                        >
                          <option value="minecraft:item">item</option>
                          <option value="minecraft:tag">tag</option>
                          <option value="minecraft:empty">empty</option>
                          <option value="minecraft:group">group</option>
                          <option value="minecraft:loot_table">loot_table</option>
                          <option value="minecraft:dynamic">dynamic</option>
                        </select>
                        <input
                          type="text"
                          value={str(entry.name)}
                          placeholder={str(entry.type).includes('tag') || str(entry.type).includes('loot_table') ? 'minecraft:fish' : 'minecraft:diamond'}
                          onChange={e => setEntry(pIdx, eIdx, { ...entry, name: e.target.value })}
                        />
                        <span className="loot-entry-weight">
                          <label>weight</label>
                          <input
                            type="number"
                            min={1}
                            value={num(entry.weight, 1)}
                            onChange={e => setEntry(pIdx, eIdx, { ...entry, weight: Math.max(1, parseInt(e.target.value || '1', 10)) })}
                          />
                        </span>
                        <button type="button" onClick={() => removeEntry(pIdx, eIdx)}><Icon name="x" size={14} /></button>
                      </div>
                      {functions.length > 0 && (
                        <div className="loot-entry-functions">
                          {functions.map((fn, fIdx) => (
                            <div key={fIdx} className="loot-function-wrapper">
                              <LootFunctionEditor
                                value={fn}
                                onChange={v => {
                                  const funcs = functions.slice()
                                  funcs[fIdx] = v
                                  setFunctions(pIdx, eIdx, funcs)
                                }}
                              />
                              <button type="button" className="predicate-term-del" onClick={() => removeFunction(pIdx, eIdx, fIdx)}><Icon name="x" size={14} /></button>
                            </div>
                          ))}
                        </div>
                      )}
                      <button type="button" className="loot-entry-add-fn" onClick={() => addFunction(pIdx, eIdx)}>+ Function</button>
                    </div>
                  )
                })}
                <button type="button" onClick={() => addEntry(pIdx)}>+ Entry</button>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
