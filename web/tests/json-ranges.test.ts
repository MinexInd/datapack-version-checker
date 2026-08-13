import { describe, it, expect } from 'vitest'
import {
  parseWithRanges,
  findNodeRange,
  replaceNode,
  writeBack,
} from '../src/ide/json-ranges'

// ─── parseWithRanges ─────────────────────────────────────────────────────────

describe('parseWithRanges', () => {
  it('returns null for invalid JSON', () => {
    expect(parseWithRanges('')).toBeNull()
    expect(parseWithRanges('{')).toBeNull()
    expect(parseWithRanges('{"a":}')).toBeNull()
    expect(parseWithRanges('undefined')).toBeNull()
    expect(parseWithRanges('{"a": "b",}')).toBeNull()
  })

  it('never throws on any input', () => {
    const pathological = [
      '""',
      '"\\"\\"\\"\\"',
      '{"a": {"b": {"c": [1, 2, 3]}}}',
      '[1, "two", true, null, {"k": "v"}]',
      '1e3',
      '-0.5',
      '+100', // leading + is not valid JSON but parser should return null
    ]
    for (const input of pathological) {
      // Should not throw — just return null or a valid node
      const result = parseWithRanges(input)
      if (result !== null) {
        expect(result.start).toBe(0)
        expect(result.end).toBe(input.length)
      }
    }
  })

  it('parses objects with correct ranges', () => {
    const src = '{"a": 1, "b": 2}'
    const root = parseWithRanges(src)!
    expect(root.value).toEqual({ a: 1, b: 2 })
    expect(root.start).toBe(0)
    expect(root.end).toBe(src.length)
  })

  it('parses arrays with correct ranges', () => {
    const src = '[1, 2, 3]'
    const root = parseWithRanges(src)!
    expect(root.value).toEqual([1, 2, 3])
    expect(root.start).toBe(0)
    expect(root.end).toBe(src.length)
  })

  it('parses strings with escapes', () => {
    const src = '"hello \\"world\\""'
    const root = parseWithRanges(src)!
    expect(root.value).toBe('hello "world"')
  })

  it('parses nested structures', () => {
    const src = '{"arr": [1, {"k": "v"}, null], "num": -0.5, "bool": true}'
    const root = parseWithRanges(src)!
    expect(root.value).toEqual({
      arr: [1, { k: 'v' }, null],
      num: -0.5,
      bool: true,
    })
  })

  it('preserves number formats in parsed values', () => {
    expect((parseWithRanges('1e3')!).value).toBe(1000)
    expect((parseWithRanges('-0.5')!).value).toBe(-0.5)
    expect((parseWithRanges('0.0')!).value).toBe(0)
    expect((parseWithRanges('1.23e+4')!).value).toBe(12300)
    expect((parseWithRanges('-1.23E-4')!).value).toBe(-0.000123)
  })
})

// ─── findNodeRange ───────────────────────────────────────────────────────────

describe('findNodeRange', () => {
  const pretty = `{
  "name": "test",
  "values": [
    1,
    2,
    3
  ],
  "nested": {
    "deep": true
  }
}`

  it('returns null for invalid JSON', () => {
    expect(findNodeRange('not json', ['a'])).toBeNull()
  })

  it('returns null for non-existent object key', () => {
    expect(findNodeRange('{"a": 1}', ['b'])).toBeNull()
  })

  it('returns null for out-of-bounds array index', () => {
    expect(findNodeRange('[1, 2]', [5])).toBeNull()
  })

  it('finds object key value range', () => {
    const range = findNodeRange(pretty, ['name'])!
    expect(range).not.toBeNull()
    expect(pretty.slice(range.start, range.end)).toBe('"test"')
  })

  it('finds array item range', () => {
    const range = findNodeRange(pretty, ['values', '1'])!
    expect(range).not.toBeNull()
    expect(pretty.slice(range.start, range.end)).toBe('2')
  })

  it('finds nested object value range', () => {
    const range = findNodeRange(pretty, ['nested', 'deep'])!
    expect(range).not.toBeNull()
    expect(pretty.slice(range.start, range.end)).toBe('true')
  })

  it('empty path returns root range', () => {
    const range = findNodeRange(pretty, [])!
    expect(range).not.toBeNull()
    expect(range.start).toBe(0)
    expect(range.end).toBe(pretty.length)
  })
})

// ─── replaceNode ─────────────────────────────────────────────────────────────

describe('replaceNode', () => {
  it('byte-identity: only the replaced node changes', () => {
    const src = `{
  "name": "original",
  "count": 42,
  "tags": [
    "a",
    "b"
  ]
}`
    const result = replaceNode(src, ['name'], 'replaced')!
    expect(result).not.toBeNull()

    // The replaced field has new value
    const root = parseWithRanges(result)!
    expect((root.value as any).name).toBe('replaced')

    // Count untouched
    expect((root.value as any).count).toBe(42)

    // Tags untouched
    expect((root.value as any).tags).toEqual(['a', 'b'])

    // Verify the count portion is byte-identical in the result
    expect(result).toContain('"count": 42')
    expect(result).toContain('"tags":')
  })

  it('preserves surrounding whitespace and formatting', () => {
    const src = `{
  "a":   1,
  "b":     2
}`
    const result = replaceNode(src, ['a'], 99)!
    // "b" line must be byte-identical
    expect(result).toContain('"b":     2')
    // value range splices compact node into original position (3 spaces before value preserved)
    expect(result).toContain('"a":   99')
  })

  it('replaces array element', () => {
    const src = '[1, 2, 3]'
    const result = replaceNode(src, ['1'], 'replaced')!
    // spaces after commas in original are preserved
    expect(result).toBe('[1, "replaced", 3]')
  })

  it('handles nested path replacement', () => {
    const src = '{"outer": {"inner": "old"}}'
    const result = replaceNode(src, ['outer', 'inner'], 'new')!
    expect(result).toBe('{"outer": {"inner": "new"}}')
  })

  it('returns null for empty path', () => {
    expect(replaceNode('{"a": 1}', [], 1)).toBeNull()
  })

  it('returns null for missing path', () => {
    expect(replaceNode('{"a": 1}', ['b'], 1)).toBeNull()
  })

  it('returns null for invalid JSON', () => {
    expect(replaceNode('not json', ['a'], 1)).toBeNull()
  })

  it('string with escapes round-trips correctly', () => {
    const src = '{"msg": "hello"}'
    const result = replaceNode(src, ['msg'], 'line1\nline2\ttab"quot')!
    const root = parseWithRanges(result)!
    expect((root.value as any).msg).toBe('line1\nline2\ttab"quot')
  })

  it('preserves key order after replacement', () => {
    const src = '{"z": 1, "a": 2, "m": 3}'
    const result = replaceNode(src, ['a'], 99)!
    // Keys should remain in original order
    const root = parseWithRanges(result)!
    const keys = Object.keys(root.value as any)
    expect(keys).toEqual(['z', 'a', 'm'])
    expect((root.value as any).a).toBe(99)
  })

  it('trailing newline preserved', () => {
    const src = '{\n  "a": 1\n}\n'
    const result = replaceNode(src, ['a'], 2)!
    expect(result.endsWith('\n')).toBe(true)
  })

  it('number formats untouched when editing different field', () => {
    const src = '{"num": 1e3, "flag": false}'
    const result = replaceNode(src, ['flag'], true)!
    // 1e3 raw text must remain
    expect(result).toContain('1e3')
    expect(result).toContain('"flag": true')
  })

  it('handles -0.5 number format', () => {
    const src = '{"val": -0.5, "other": "x"}'
    const result = replaceNode(src, ['other'], 'y')!
    expect(result).toContain('-0.5')
  })

  it('handles true/false/null literals', () => {
    const src = '{"a": true, "b": false, "c": null}'
    expect(replaceNode(src, ['a'], false)!).toContain('"a": false')
    expect(replaceNode(src, ['b'], true)!).toContain('"b": true')
    expect(replaceNode(src, ['c'], 'str')!).toContain('"c": "str"')
  })

  it('replacement with complex nested value', () => {
    const src = '{"data": "old"}'
    const newVal = { nested: [1, 2, 3], flag: true }
    const result = replaceNode(src, ['data'], newVal)!
    const root = parseWithRanges(result)!
    expect((root.value as any).data).toEqual(newVal)
  })
})

// ─── writeBack ───────────────────────────────────────────────────────────────

describe('writeBack', () => {
  it('uses byte-stable replaceNode when path resolves', () => {
    const src = '{"a": 1, "b": 2}'
    const result = writeBack(src, ['a'], 99, { a: 99, b: 2 })
    expect(result).toContain('"a": 99')
    expect(result).toContain('"b": 2')
    // Not the full re-serialization (which would be different formatting)
    expect(result).toBe('{"a": 99, "b": 2}')
  })

  it('falls back to serializeJson when path is empty', () => {
    const src = '{"a": 1}'
    const newRoot = { a: 1, b: 2 }
    const result = writeBack(src, [], 1, newRoot)
    // Should be serializeJson(newRoot) — 2-space indent + trailing newline
    expect(result).toBe(JSON.stringify(newRoot, null, 2) + '\n')
  })

  it('falls back to serializeJson when JSON is invalid', () => {
    const src = 'not json'
    const newRoot = { fixed: true }
    const result = writeBack(src, ['fixed'], true, newRoot)
    expect(result).toBe(JSON.stringify(newRoot, null, 2) + '\n')
  })

  it('falls back to serializeJson when path is missing', () => {
    const src = '{"a": 1}'
    const newRoot = { a: 1, c: 3 }
    const result = writeBack(src, ['z'], 99, newRoot)
    expect(result).toBe(JSON.stringify(newRoot, null, 2) + '\n')
  })

  it('byte-identical fallback preserves nothing of original', () => {
    // When falling back, the entire document is re-serialized from newRoot
    const src = '   {  "a" : 1  }  '
    const newRoot = { a: 2 }
    const result = writeBack(src, [], 2, newRoot)
    expect(result).toBe(JSON.stringify(newRoot, null, 2) + '\n')
  })
})
