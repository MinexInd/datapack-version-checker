import { describe, it, expect } from 'vitest'
import { diffLines } from '../src/diff'
import { highlightJson } from '../src/engine/highlight'

const changed = (rows: ReturnType<typeof diffLines>['rows']) =>
  rows.filter(r => r.kind === 'added' || r.kind === 'removed')

describe('diffLines', () => {
  it('reports nothing when the files match', () => {
    const lines = ['{', '  "a": 1', '}']
    const d = diffLines(lines, lines)
    expect(d.added).toBe(0)
    expect(d.removed).toBe(0)
    expect(changed(d.rows)).toHaveLength(0)
  })

  it('an inserted line does not mark every following line as changed', () => {
    // This is the bug the positional renderer had: inserting one line made the
    // rest of the file report as modified.
    const src = ['a', 'b', 'c', 'd', 'e']
    const out = ['a', 'b', 'NEW', 'c', 'd', 'e']
    const d = diffLines(src, out)
    expect(d.added).toBe(1)
    expect(d.removed).toBe(0)
    const only = changed(d.rows)
    expect(only).toHaveLength(1)
    expect(only[0].text).toBe('NEW')
  })

  it('a removed line is reported once', () => {
    const src = ['a', 'b', 'gone', 'c']
    const out = ['a', 'b', 'c']
    const d = diffLines(src, out)
    expect(d.added).toBe(0)
    expect(d.removed).toBe(1)
    expect(changed(d.rows)[0].text).toBe('gone')
  })

  it('a replaced line is one removal plus one addition', () => {
    const d = diffLines(['a', 'old', 'c'], ['a', 'new', 'c'])
    expect(d.added).toBe(1)
    expect(d.removed).toBe(1)
    expect(changed(d.rows).map(r => r.text).sort()).toEqual(['new', 'old'])
  })

  it('keeps line numbers pointing at the right side of the diff', () => {
    const d = diffLines(['a', 'old', 'c'], ['a', 'new', 'c'])
    const removed = d.rows.find(r => r.kind === 'removed')!
    const added = d.rows.find(r => r.kind === 'added')!
    expect(removed.srcLine).toBe(2)
    expect(removed.outLine).toBeUndefined()
    expect(added.outLine).toBe(2)
    expect(added.srcLine).toBeUndefined()
  })

  it('collapses long unchanged runs into a counted gap', () => {
    const src = ['change me', ...Array.from({ length: 40 }, (_, i) => `line ${i}`)]
    const out = ['changed', ...Array.from({ length: 40 }, (_, i) => `line ${i}`)]
    const d = diffLines(src, out)
    const gap = d.rows.find(r => r.kind === 'gap')
    expect(gap).toBeDefined()
    expect(gap!.hidden).toBeGreaterThan(0)
    // The whole 40-line tail must not be rendered.
    expect(d.rows.filter(r => r.kind === 'context').length).toBeLessThan(10)
  })

  it('handles an empty original and an empty result', () => {
    expect(diffLines([], ['a', 'b']).added).toBe(2)
    expect(diffLines(['a', 'b'], []).removed).toBe(2)
  })

  it('diffs a realistic JSON field rename without touching the rest', () => {
    const src = ['{', '  "type": "minecraft:player",', '  "nbt": "{}"', '}']
    const out = ['{', '  "entity_type": "minecraft:player",', '  "nbt": "{}"', '}']
    const d = diffLines(src, out)
    expect(d.added).toBe(1)
    expect(d.removed).toBe(1)
    expect(changed(d.rows)).toHaveLength(2)
  })
})

describe('highlightJson', () => {
  it('marks keys apart from string values', () => {
    const html = highlightJson('{"name": "value"}')
    expect(html).toContain('hl-key')
    expect(html).toContain('hl-string')
  })

  it('marks numbers and literals', () => {
    const html = highlightJson('{"count": 12, "ok": true, "gone": null}')
    expect(html).toContain('hl-number')
    expect(html).toContain('hl-bool')
  })

  it('escapes markup so pack content cannot inject html', () => {
    const html = highlightJson('{"a": "<img src=x onerror=alert(1)>"}')
    expect(html).not.toContain('<img')
    expect(html).toContain('&lt;img')
  })

  it('does not treat a colon inside a value as a key separator', () => {
    const html = highlightJson('{"id": "minecraft:stone"}')
    const keys = html.match(/hl-key/g) ?? []
    expect(keys).toHaveLength(1)
  })
})
