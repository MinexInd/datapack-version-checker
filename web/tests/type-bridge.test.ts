import { describe, it, expect } from 'vitest'
import { spyglassTypeToEngine } from '../src/engine/type-bridge'
import type { SimplifiedMcdocType } from '../src/ide/mcdoc-edit'

// Spyglass simplified types are plain objects; fixtures are cast through
// unknown to keep the test focused on the conversion, not on constructing
// the full mcdoc type machinery.
type S = any

const lit = (value: string | number | boolean) => ({
  kind: 'literal',
  value: typeof value === 'string' ? { kind: 'string', value }
    : typeof value === 'boolean' ? { kind: 'boolean', value }
    : { kind: 'int', value },
})

const strKey = (name: string) => lit(name)

describe('spyglassTypeToEngine', () => {
  it('converts a struct with literal-keyed fields, honoring optional and since/until', () => {
    const input: S = {
      kind: 'struct',
      attributes: [{ name: 'since', value: lit('1.20') }],
      fields: [
        { kind: 'pair', key: strKey('type'), type: lit('minecraft:crafting_shaped'), optional: false },
        { kind: 'pair', key: strKey('group'), type: { kind: 'string' }, optional: true },
        {
          kind: 'pair',
          key: strKey('category'),
          type: { kind: 'enum', enumKind: 'string', values: [
            { identifier: 'building', value: 'building' },
            { identifier: 'redstone', value: 'redstone' },
          ] },
          optional: false,
        },
      ],
    }
    const out = spyglassTypeToEngine(input) as SimplifiedMcdocType
    expect(out.kind).toBe('struct')
    if (out.kind !== 'struct') return
    expect(out.since).toBe('1.20')
    expect(out.fields.map(f => f.key)).toEqual(['type', 'group', 'category'])
    expect(out.fields.map(f => f.required)).toEqual([true, false, true])
    expect(out.fields[0].type).toEqual({ kind: 'literal', value: 'minecraft:crafting_shaped' })
    expect(out.fields[1].type).toEqual({ kind: 'primitive', name: 'string' })
    expect(out.fields[2].type).toEqual({ kind: 'enum', values: ['building', 'redstone'] })
  })

  it('collapses a struct with a single dynamic-key field to the engine map kind', () => {
    const input: S = {
      kind: 'struct',
      fields: [
        {
          kind: 'pair',
          key: { kind: 'string' },
          type: { kind: 'struct', fields: [
            { kind: 'pair', key: strKey('item'), type: { kind: 'string' }, optional: false },
          ] },
          optional: false,
        },
      ],
    }
    // A struct whose only field has a dynamic key IS a map (the recipe "key"
    // field is the canonical case) — collapse it so the editor renders rows.
    const out = spyglassTypeToEngine(input) as SimplifiedMcdocType
    expect(out.kind).toBe('map')
    if (out.kind !== 'map') return
    expect(out.value.kind).toBe('struct')
  })

  it('keeps a struct with a literal-keyed field and a dynamic-key field intact', () => {
    const input: S = {
      kind: 'struct',
      fields: [
        { kind: 'pair', key: strKey('type'), type: { kind: 'string' }, optional: false },
        {
          kind: 'pair',
          key: { kind: 'string' },
          type: { kind: 'struct', fields: [
            { kind: 'pair', key: strKey('item'), type: { kind: 'string' }, optional: false },
          ] },
          optional: false,
        },
      ],
    }
    const out = spyglassTypeToEngine(input) as SimplifiedMcdocType
    if (out.kind !== 'struct') throw new Error('expected struct')
    expect(out.fields.map(f => f.key)).toEqual(['type', 'key'])
    const mapField = out.fields[1]
    expect(mapField.type.kind).toBe('map')
    if (mapField.type.kind !== 'map') return
    expect(mapField.type.value.kind).toBe('struct')
  })

  it('converts a union to options, preserving every member', () => {
    const input: S = {
      kind: 'union',
      members: [
        { kind: 'literal', value: { kind: 'string', value: 'minecraft:crafting_shaped' } },
        { kind: 'literal', value: { kind: 'string', value: 'minecraft:smelting' } },
        { kind: 'struct', fields: [] },
      ],
    }
    const out = spyglassTypeToEngine(input) as SimplifiedMcdocType
    expect(out.kind).toBe('union')
    if (out.kind !== 'union') return
    expect(out.options).toHaveLength(3)
    expect(out.options[0]).toEqual({ kind: 'literal', value: 'minecraft:crafting_shaped' })
    expect(out.options[2].kind).toBe('struct')
  })

  it('converts primitives: string/int/long/boolean/any/byte_array', () => {
    const cases: [S, SimplifiedMcdocType][] = [
      [{ kind: 'string' }, { kind: 'primitive', name: 'string' }],
      [{ kind: 'int' }, { kind: 'primitive', name: 'int' }],
      [{ kind: 'float' }, { kind: 'primitive', name: 'float' }],
      [{ kind: 'long' }, { kind: 'primitive', name: 'long' }],
      [{ kind: 'boolean' }, { kind: 'primitive', name: 'boolean' }],
      [{ kind: 'any' }, { kind: 'primitive', name: 'any' }],
      [{ kind: 'byte_array' }, { kind: 'primitive', name: 'byte_array' }],
      [{ kind: 'long_array' }, { kind: 'primitive', name: 'long_array' }],
    ]
    for (const [input, expected] of cases) {
      expect(spyglassTypeToEngine(input)).toEqual(expected)
    }
  })

  it('extracts the #[id] registry hint, stripping the minecraft: namespace', () => {
    const input: S = {
      kind: 'string',
      attributes: [{ name: 'id', value: lit('minecraft:item') }],
    }
    const out = spyglassTypeToEngine(input) as SimplifiedMcdocType
    expect(out).toEqual({ kind: 'primitive', name: 'string', registry: 'item' })
  })

  it('extracts registry from a tree-valued #[id] attribute', () => {
    const input: S = {
      kind: 'string',
      attributes: [{
        name: 'id',
        value: { kind: 'tree', values: { registry: lit('minecraft:entity_type') } },
      }],
    }
    const out = spyglassTypeToEngine(input) as SimplifiedMcdocType
    expect(out).toEqual({ kind: 'primitive', name: 'string', registry: 'entity_type' })
  })

  it('converts literal values of every kind', () => {
    expect(spyglassTypeToEngine(lit('abc'))).toEqual({ kind: 'literal', value: 'abc' })
    expect(spyglassTypeToEngine(lit(42))).toEqual({ kind: 'literal', value: 42 })
    expect(spyglassTypeToEngine(lit(true))).toEqual({ kind: 'literal', value: true })
    expect(spyglassTypeToEngine({ kind: 'literal', value: { kind: 'long', value: 9007199254740993n } }))
      .toEqual({ kind: 'literal', value: 9007199254740993 })
  })

  it('converts list and tuple', () => {
    expect(spyglassTypeToEngine({ kind: 'list', item: { kind: 'string' } }))
      .toEqual({ kind: 'list', item: { kind: 'primitive', name: 'string' } })
    expect(spyglassTypeToEngine({ kind: 'tuple', items: [{ kind: 'int' }, { kind: 'string' }] }))
      .toEqual({ kind: 'tuple', items: [
        { kind: 'primitive', name: 'int' },
        { kind: 'primitive', name: 'string' },
      ] })
  })

  // Regression: the recipe "result" field is a union of two structs
  // (ItemResult until 1.20.5, ItemStackTemplate since 1.20.5). Field-level
  // unions must convert to options — a previous version passed them through
  // the NoUnion converter and produced opaque 'unknown' inputs.
  it('converts a union inside a struct field to options', () => {
    const input: S = {
      kind: 'struct',
      fields: [
        {
          kind: 'pair',
          key: strKey('result'),
          type: {
            kind: 'union',
            members: [
              { kind: 'struct', fields: [
                { kind: 'pair', key: strKey('item'), type: { kind: 'string' }, optional: false },
              ] },
              { kind: 'struct', fields: [
                { kind: 'pair', key: strKey('id'), type: { kind: 'string' }, optional: false },
              ] },
            ],
          },
          optional: false,
        },
      ],
    }
    const out = spyglassTypeToEngine(input) as SimplifiedMcdocType
    if (out.kind !== 'struct') throw new Error('expected struct')
    const field = out.fields[0]
    expect(field.type.kind).toBe('union')
    if (field.type.kind !== 'union') return
    expect(field.type.options.map(o => o.kind)).toEqual(['struct', 'struct'])
  })

  // Regression: the recipe "key" map value is Ingredient — a union of
  // struct/list. A map value that is a union must stay convertible.
  it('converts a union inside a map value to options', () => {
    const input: S = {
      kind: 'struct',
      fields: [
        {
          kind: 'pair',
          key: { kind: 'string' },
          type: {
            kind: 'union',
            members: [
              { kind: 'struct', fields: [
                { kind: 'pair', key: strKey('item'), type: { kind: 'string' }, optional: false },
              ] },
              { kind: 'list', item: { kind: 'string' } },
            ],
          },
          optional: false,
        },
      ],
    }
    const out = spyglassTypeToEngine(input) as SimplifiedMcdocType
    expect(out.kind).toBe('map')
    if (out.kind !== 'map') return
    expect(out.value.kind).toBe('union')
    if (out.value.kind !== 'union') return
    expect(out.value.options.map(o => o.kind)).toEqual(['struct', 'list'])
  })

  // Regression: a list whose item type is a union (e.g. Ingredient's list
  // member) must convert the item to options, not 'unknown'.
  it('converts a union inside a list item to options', () => {
    const input: S = {
      kind: 'list',
      item: {
        kind: 'union',
        members: [
          { kind: 'struct', fields: [
            { kind: 'pair', key: strKey('item'), type: { kind: 'string' }, optional: false },
          ] },
          { kind: 'struct', fields: [
            { kind: 'pair', key: strKey('tag'), type: { kind: 'string' }, optional: false },
          ] },
        ],
      },
    }
    const out = spyglassTypeToEngine(input) as SimplifiedMcdocType
    expect(out.kind).toBe('list')
    if (out.kind !== 'list') return
    expect(out.item.kind).toBe('union')
    if (out.item.kind !== 'union') return
    expect(out.item.options.map(o => o.kind)).toEqual(['struct', 'struct'])
  })

  it('carries until gates and field-level since/until', () => {
    const input: S = {
      kind: 'struct',
      attributes: [{ name: 'until', value: lit('1.21') }],
      fields: [
        {
          kind: 'pair',
          key: strKey('old'),
          type: { kind: 'string' },
          optional: false,
          attributes: [{ name: 'since', value: lit('1.19') }],
        },
      ],
    }
    const out = spyglassTypeToEngine(input) as SimplifiedMcdocType
    if (out.kind !== 'struct') throw new Error('expected struct')
    expect(out.until).toBe('1.21')
    expect(out.fields[0].since).toBe('1.19')
  })
})
