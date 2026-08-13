import { describe, it, expect } from 'vitest'
import {
  compareVersions,
  typeVisibleAt,
  isJsonPointerSafe,
  getAtPath,
  setAtPath,
  removeAtPath,
  insertInList,
  moveListItem,
  defaultValue,
  defaultForField,
  selectUnionOption,
  typeAtPath,
    serializeJson,
  serializeNode,
  type SimplifiedMcdocType,
  type SimplifiedMcdocField,
  type JsonValue,
} from '../src/ide/mcdoc-edit'



const str = (since?: string, until?: string): SimplifiedMcdocType =>
  ({ kind: 'primitive', name: 'string', since, until })

const recipe: SimplifiedMcdocType = {
  kind: 'struct',
  fields: [
    { key: 'type', type: { kind: 'enum', values: ['minecraft:recipe', 'minecraft:smelting'] }, required: true },
    { key: 'cookingtime', type: { kind: 'primitive', name: 'int' }, required: false },
    { key: 'ingredient', type: { kind: 'union', options: [
      { kind: 'struct', fields: [{ key: 'item', type: str(), required: true }] },
      { kind: 'list', item: { kind: 'struct', fields: [{ key: 'item', type: str(), required: true }] } },
    ] }, required: true },
    { key: 'result', type: { kind: 'struct', fields: [{ key: 'item', type: str(), required: true }] }, required: true },
  ],
}

describe('version gating', () => {
  it('compares version tuples', () => {
    expect(compareVersions('1.20', '1.20')).toBe(0)
    expect(compareVersions('1.20', '1.21')).toBe(-1)
    expect(compareVersions('1.21', '1.20.5')).toBe(1)
    expect(compareVersions('1.20.3', '1.20.2')).toBe(1)
  })
  it('gates on since/until', () => {
    expect(typeVisibleAt({ since: '1.20' }, '1.21')).toBe(true)
    expect(typeVisibleAt({ since: '1.20' }, '1.19')).toBe(false)
    expect(typeVisibleAt({ until: '1.19' }, '1.20')).toBe(false)
    expect(typeVisibleAt({}, '1.20')).toBe(true)
  })
})

describe('path safety + reads', () => {
  it('rejects unsafe paths', () => {
    expect(isJsonPointerSafe([''])).toBe(false)
    expect(isJsonPointerSafe([-1])).toBe(false)
    expect(isJsonPointerSafe(['a', 0])).toBe(true)
  })
  it('getAtPath reads nested values', () => {
    const v: JsonValue = { a: { b: [{ c: 1 }] } }
    expect(getAtPath(v, ['a', 'b', 0, 'c'])).toBe(1)
    expect(getAtPath(v, ['a', 'missing'])).toBeUndefined()
  })
})

describe('immutable path writes', () => {
  it('setAtPath does not mutate the input', () => {
    const src: JsonValue = { a: 1 }
    const out = setAtPath(src, ['a'], 2)
    expect(src).toEqual({ a: 1 })
    expect(out).toEqual({ a: 2 })
  })
  it('setAtPath creates missing containers', () => {
    const out = setAtPath({}, ['a', 'b', 0, 'c'], 5)
    expect(out).toEqual({ a: { b: [{ c: 5 }] } })
  })
  it('removeAtPath deletes object keys and splices arrays', () => {
    expect(removeAtPath({ a: 1, b: 2 }, ['a'])).toEqual({ b: 2 })
    expect(removeAtPath({ a: [1, 2, 3] }, ['a', 1])).toEqual({ a: [1, 3] })
    expect(removeAtPath({ a: 1 }, ['zzz'])).toEqual({ a: 1 })
  })
  it('insertInList and moveListItem', () => {
    expect(insertInList({ a: [1, 3] }, ['a'], 1, 2)).toEqual({ a: [1, 2, 3] })
    expect(moveListItem({ a: [1, 2, 3] }, ['a'], 0, 2)).toEqual({ a: [2, 3, 1] })
  })
})

describe('schema defaults', () => {
  it('struct defaults include only required fields', () => {
    const v = defaultValue(recipe)
    expect(v).toEqual({
      type: 'minecraft:recipe',
      ingredient: { item: '' },
      result: { item: '' },
    })
  })
  it('union default picks first non-literal option', () => {
    const u: SimplifiedMcdocType = { kind: 'union', options: [
      { kind: 'literal', value: null },
      { kind: 'list', item: str() },
    ] }
    expect(defaultValue(u)).toEqual([])
  })
  it('enum/list/tuple/primitive/literal/map defaults', () => {
    expect(defaultValue({ kind: 'enum', values: ['a', 'b'] })).toBe('a')
    expect(defaultValue({ kind: 'list', item: str() })).toEqual([])
    expect(defaultValue({ kind: 'tuple', items: [str(), { kind: 'primitive', name: 'int' }] })).toEqual(['', 0])
    expect(defaultValue({ kind: 'primitive', name: 'int' })).toBe(0)
    expect(defaultValue({ kind: 'primitive', name: 'bool' })).toBe(false)
    expect(defaultValue({ kind: 'literal', value: 'x' })).toBe('x')
    expect(defaultValue({ kind: 'map', value: str() })).toEqual({})
  })
  it('optional fields default to undefined', () => {
    const field: SimplifiedMcdocField = { key: 'cookingtime', type: { kind: 'primitive', name: 'int' }, required: false }
    expect(defaultForField(field)).toBeUndefined()
    expect(defaultForField({ ...field, required: true })).toBe(0)
  })
})

describe('union membership', () => {
  it('prefers the matching branch based on value shape', () => {
    const u = recipe.fields.find(f => f.key === 'ingredient')!.type
    expect(selectUnionOption(u, { item: 'a' })).toBe(0)
    expect(selectUnionOption(u, [{ item: 'a' }])).toBe(1)
  })
  it('resolves null to a null literal when present', () => {
    const u: SimplifiedMcdocType = { kind: 'union', options: [
      { kind: 'struct', fields: [] },
      { kind: 'literal', value: null },
    ] }
    expect(selectUnionOption(u, null)).toBe(1)
    expect(selectUnionOption(u, {})).toBe(0)
  })
  it('prefers the struct branch whose fields overlap the value keys', () => {
    // Recipe "result": ItemResult {item, count} vs ItemStackTemplate
    // {id, components, count}. A value with "id" must pick ItemStackTemplate
    // even though both branches are structs (regression: index tie-break
    // always picked ItemResult, so preset loads showed the wrong fields).
    const u: SimplifiedMcdocType = { kind: 'union', options: [
      { kind: 'struct', fields: [
        { key: 'item', type: { kind: 'primitive', name: 'string' }, required: true },
        { key: 'count', type: { kind: 'primitive', name: 'int' }, required: false },
      ] },
      { kind: 'struct', fields: [
        { key: 'id', type: { kind: 'primitive', name: 'string' }, required: true },
        { key: 'components', type: { kind: 'map', value: { kind: 'primitive', name: 'any' } }, required: false },
        { key: 'count', type: { kind: 'primitive', name: 'int' }, required: false },
      ] },
    ] }
    expect(selectUnionOption(u, { id: 'minecraft:bread' })).toBe(1)
    expect(selectUnionOption(u, { item: 'minecraft:iron_ingot' })).toBe(0)
    expect(selectUnionOption(u, { id: 'x', count: 2 })).toBe(1)
    expect(selectUnionOption(u, { item: 'x', count: 2 })).toBe(0)
  })
})

describe('type walking + serialization', () => {
  it('typeAtPath descends struct/list/tuple', () => {
    const t = typeAtPath(recipe, ['ingredient', 0, 'item'])
    expect(t.kind).toBe('primitive')
    const t2 = typeAtPath(recipe, ['result', 'item'])
    expect(t2).toEqual({ kind: 'primitive', name: 'string' })
  })
  it('serializeJson adds a trailing newline, serializeNode does not', () => {
    expect(serializeJson({ a: 1 })).toBe('{\n  "a": 1\n}\n')
    expect(serializeNode({ a: 1 })).toBe('{"a":1}')
  })
})
