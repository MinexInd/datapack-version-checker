import { describe, it, expect } from 'vitest'
import { tokenizeCommand, stripQuotes } from '../src/tokenizer.js'

describe('tokenizeCommand', () => {
  it('splits a simple command by spaces', () => {
    const tokens = tokenizeCommand('say hello world')
    expect(tokens.map(t => t.value)).toEqual(['say', 'hello', 'world'])
  })

  it('handles leading slash', () => {
    const tokens = tokenizeCommand('/give @s diamond 1')
    expect(tokens.map(t => t.value)).toEqual(['/give', '@s', 'diamond', '1'])
  })

  it('keeps quoted strings as a single token', () => {
    const tokens = tokenizeCommand('say "hello world" foo')
    expect(tokens.map(t => t.value)).toEqual(['say', '"hello world"', 'foo'])
  })

  it('handles single quotes', () => {
    const tokens = tokenizeCommand("say 'hello world' foo")
    expect(tokens.map(t => t.value)).toEqual(["say", "'hello world'", "foo"])
  })

  it('treats braces as a dedicated token when leading', () => {
    const tokens = tokenizeCommand('give @s diamond{tag:1b} 1')
    expect(tokens.map(t => t.value)).toEqual(['give', '@s', 'diamond{tag:1b}', '1'])
  })

  it('splits bracket selectors as dedicated token', () => {
    const tokens = tokenizeCommand('tp @e[type=cow] ~ ~ ~')
    expect(tokens.map(t => t.value)).toEqual(['tp', '@e[type=cow]', '~', '~', '~'])
  })

  it('handles nested braces', () => {
    const tokens = tokenizeCommand('data modify entity @s HandItems[{id:"minecraft:stone"}]')
    expect(tokens.map(t => t.value)).toEqual(['data', 'modify', 'entity', '@s', 'HandItems[{id:"minecraft:stone"}]'])
  })

  it('handles empty input', () => {
    expect(tokenizeCommand('')).toEqual([])
  })

  it('handles whitespace-only input', () => {
    expect(tokenizeCommand('   \t  ')).toEqual([])
  })

  it('handles tab separators', () => {
    const tokens = tokenizeCommand('say\thello')
    expect(tokens.map(t => t.value)).toEqual(['say', 'hello'])
  })

  it('tracks correct start/end positions', () => {
    const tokens = tokenizeCommand('give @s stone 1')
    expect(tokens[0]).toMatchObject({ value: 'give', start: 0, end: 4 })
    expect(tokens[1]).toMatchObject({ value: '@s', start: 5, end: 7 })
    expect(tokens[2]).toMatchObject({ value: 'stone', start: 8, end: 13 })
    expect(tokens[3]).toMatchObject({ value: '1', start: 14, end: 15 })
  })
})

describe('stripQuotes', () => {
  it('strips double quotes', () => {
    expect(stripQuotes('"hello"')).toBe('hello')
  })

  it('strips single quotes', () => {
    expect(stripQuotes("'hello'")).toBe('hello')
  })

  it('returns as-is when no quotes', () => {
    expect(stripQuotes('hello')).toBe('hello')
  })

  it('returns as-is when only one quote', () => {
    expect(stripQuotes('"hello')).toBe('"hello')
  })
})