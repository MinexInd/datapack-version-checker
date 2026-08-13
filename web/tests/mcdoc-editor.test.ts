import { describe, it, expect, vi } from 'vitest'
import { renderToString } from 'react-dom/server'
import { createElement } from 'react'
import { buildFormState, commitEdit } from '../src/components/editors/mcdoc-editor-logic'
import {
  defaultValue,
  insertInList,
  moveListItem,
  removeAtPath,
  selectUnionOption,
  setAtPath,
  typeVisibleAt,
  type JsonPath,
  type JsonValue,
  type SimplifiedMcdocType,
} from '../src/ide/mcdoc-edit'
import McdocEditor from '../src/components/editors/McdocEditor'

// The parallel json-ranges module may or may not exist at test time; provide a
// deterministic stand-in so commitEdit can be exercised without it.
vi.mock('../src/ide/json-ranges', () => ({
  writeBack: (_content: string, _path: JsonPath, _value: JsonValue, newRoot: JsonValue) =>
    JSON.stringify(newRoot, null, 2) + '\n',
  replaceNode: () => null,
}))

// ── Fixture: a recipe-like struct with union / list / enum / optional ───────

const str = (since?: string, until?: string): SimplifiedMcdocType =>
  ({ kind: 'primitive', name: 'string', since, until })

const recipe: SimplifiedMcdocType = {
  kind: 'struct',
  fields: [
    {
      key: 'type',
      type: { kind: 'enum', values: ['minecraft:recipe', 'minecraft:smelting'] },
      required: true,
    },
    {
      key: 'cookingtime',
      type: { kind: 'primitive', name: 'int' },
      required: false,
      since: '1.21',
    },
    {
      key: 'ingredient',
      type: {
        kind: 'union',
        options: [
          { kind: 'struct', fields: [{ key: 'item', type: str(), required: true }] },
          {
            kind: 'list',
            item: { kind: 'struct', fields: [{ key: 'item', type: str(), required: true }] },
          },
        ],
      },
      required: true,
    },
    {
      key: 'result',
      type: { kind: 'struct', fields: [{ key: 'item', type: str(), required: true }] },
      required: true,
    },
    {
      key: 'tags',
      type: { kind: 'list', item: { kind: 'primitive', name: 'string' } },
      required: false,
    },
  ],
}

const sampleContent = JSON.stringify({
  type: 'minecraft:recipe',
  ingredient: { item: 'minecraft:diamond' },
  result: { item: 'minecraft:apple' },
})

// ── buildFormState ──────────────────────────────────────────────────────────

describe('buildFormState', () => {
  it('parses valid JSON into a value with no error', () => {
    const r = buildFormState(sampleContent, recipe)
    expect(r.error).toBeNull()
    expect(r.value).not.toBeNull()
    expect((r.value as Record<string, JsonValue>).type).toBe('minecraft:recipe')
  })

  it('reports a parse error for invalid JSON', () => {
    const r = buildFormState('{ this is not json', recipe)
    expect(r.value).toBeNull()
    expect(typeof r.error).toBe('string')
    expect(r.error!.length).toBeGreaterThan(0)
  })

  it('parses even when the schema type is still resolving (null)', () => {
    const r = buildFormState(sampleContent, null)
    expect(r.error).toBeNull()
    expect(r.value).not.toBeNull()
  })
})

// ── commitEdit ──────────────────────────────────────────────────────────────

describe('commitEdit', () => {
  it('wraps writeBack and serializes the new root', () => {
    const root = JSON.parse(sampleContent) as JsonValue
    const newRoot = setAtPath(root, ['cookingtime'], 200)
    const out = commitEdit(sampleContent, recipe, ['cookingtime'], 200, newRoot)
    const parsed = JSON.parse(out)
    expect(parsed.cookingtime).toBe(200)
    expect(parsed.type).toBe('minecraft:recipe')
  })
})

// ── Optional field add / remove ─────────────────────────────────────────────

describe('optional field add / remove', () => {
  it('adds a missing optional field via setAtPath + commitEdit', () => {
    const root = JSON.parse(sampleContent) as JsonValue
    const newRoot = setAtPath(root, ['cookingtime'], 200)
    const out = commitEdit(sampleContent, recipe, ['cookingtime'], 200, newRoot)
    expect(JSON.parse(out).cookingtime).toBe(200)
  })

  it('removes an optional field via removeAtPath + commitEdit', () => {
    const withField = setAtPath(JSON.parse(sampleContent) as JsonValue, ['cookingtime'], 200)
    const newRoot = removeAtPath(withField, ['cookingtime'])
    const out = commitEdit(sampleContent, recipe, ['cookingtime'], null as unknown as JsonValue, newRoot)
    expect('cookingtime' in JSON.parse(out)).toBe(false)
  })
})

// ── List insert / remove / move ────────────────────────────────────────────

describe('list insert / remove / move', () => {
  const withList = setAtPath(
    JSON.parse(sampleContent) as JsonValue,
    ['tags'],
    ['a', 'b', 'c'],
  ) as Record<string, JsonValue>

  it('inserts into a list', () => {
    const newRoot = insertInList(withList, ['tags'], 1, 'x')
    const out = commitEdit(sampleContent, recipe, ['tags', 1], 'x', newRoot)
    expect(JSON.parse(out).tags).toEqual(['a', 'x', 'b', 'c'])
  })

  it('removes from a list', () => {
    const newRoot = removeAtPath(withList, ['tags', 0])
    const out = commitEdit(sampleContent, recipe, ['tags', 0], null as unknown as JsonValue, newRoot)
    expect(JSON.parse(out).tags).toEqual(['b', 'c'])
  })

  it('moves a list item', () => {
    const newRoot = moveListItem(withList, ['tags'], 0, 2)
    const out = commitEdit(sampleContent, recipe, ['tags'], null as unknown as JsonValue, newRoot)
    expect(JSON.parse(out).tags).toEqual(['b', 'c', 'a'])
  })
})

// ── Union switching ─────────────────────────────────────────────────────────

describe('union switching', () => {
  it('detects a struct member for an object value', () => {
    const value = { item: 'minecraft:diamond' }
    expect(selectUnionOption(recipe.fields[2].type, value)).toBe(0)
  })

  it('detects a list member for an array value', () => {
    const value = [{ item: 'minecraft:diamond' }]
    expect(selectUnionOption(recipe.fields[2].type, value)).toBe(1)
  })

  it('switches a union to the list option via defaultValue', () => {
    const root = JSON.parse(sampleContent) as JsonValue
    const unionType = recipe.fields[2].type
    const switched = defaultValue((unionType as { kind: 'union' }).options[1])
    const newRoot = setAtPath(root, ['ingredient'], switched)
    const out = commitEdit(sampleContent, recipe, ['ingredient'], switched, newRoot)
    expect(Array.isArray(JSON.parse(out).ingredient)).toBe(true)
  })
})

// ── since / until presence + gating ─────────────────────────────────────────

describe('since / until presence and gating', () => {
  it('exposes since on the optional cookingtime field', () => {
    const cooking = recipe.fields.find(f => f.key === 'cookingtime')!
    expect(cooking.since).toBe('1.21')
  })

  it('hides a since-gated field before its version', () => {
    const cooking = recipe.fields.find(f => f.key === 'cookingtime')!
    expect(typeVisibleAt(cooking, '1.20')).toBe(false)
    expect(typeVisibleAt(cooking, '1.21')).toBe(true)
  })
})

// ── Render smoke test (no testing-library; react-dom/server only) ───────────

describe('McdocEditor render', () => {
  it('renders the schema form with field labels', () => {
    const html = renderToString(
      createElement(McdocEditor, {
        content: sampleContent,
        type: recipe,
        version: '1.21',
        onChange: () => {},
        onShowJson: () => {},
      }),
    )
    expect(html).toContain('mcdoc')
    expect(html).toContain('ingredient')
    expect(html).toContain('result')
  })

  it('renders the resolving placeholder when type is null', () => {
    const html = renderToString(
      createElement(McdocEditor, {
        content: sampleContent,
        type: null,
        version: '1.21',
        onChange: () => {},
        onShowJson: () => {},
      }),
    )
    expect(html).toContain('Resolving type')
  })

  it('renders a JSON error state for invalid content', () => {
    const html = renderToString(
      createElement(McdocEditor, {
        content: '{ not json',
        type: recipe,
        version: '1.21',
        onChange: () => {},
        onShowJson: () => {},
      }),
    )
    expect(html).toContain('not valid JSON')
  })
})
