import { useMemo } from 'react'
import type { SimplifiedMcdocType, JsonValue, JsonPath } from '../../../ide/mcdoc-edit'

interface TagEditorProps {
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

export default function TagEditor({ type, value, path, onChange, onRemove }: TagEditorProps) {
  const obj = useMemo(() => asObj(value), [value])
  const set = (field: string, v: JsonValue) => onChange([...path, field], v)

  const replace = typeof obj.replace === 'boolean' ? obj.replace : false
  const values = asArr(obj.values)

  const setValue = (idx: number, v: string) => {
    const next = values.slice()
    next[idx] = v
    set('values', next)
  }
  const addValue = () => set('values', [...values, 'minecraft:stone'])
  const removeValue = (idx: number) => set('values', values.filter((_, i) => i !== idx))

  return (
    <div className="tag-editor">
      <div className="tag-editor-header">
        <h3>Tag</h3>
      </div>

      <div className="tag-editor-section">
        <div className="recipe-field recipe-checkbox">
          <label>
            <input
              type="checkbox"
              checked={replace}
              onChange={e => set('replace', e.target.checked)}
            />
            Replace existing tag contents
          </label>
        </div>
      </div>

      <div className="tag-editor-section">
        <h4>Values ({values.length})</h4>
        <div className="tag-values">
          {values.map((val, idx) => (
            <div key={idx} className="tag-value">
              <input
                type="text"
                value={str(val)}
                placeholder="minecraft:stone"
                onChange={e => setValue(idx, e.target.value)}
              />
              <button type="button" onClick={() => removeValue(idx)}>✕</button>
            </div>
          ))}
          <button type="button" onClick={addValue}>+ Value</button>
        </div>
      </div>
    </div>
  )
}
