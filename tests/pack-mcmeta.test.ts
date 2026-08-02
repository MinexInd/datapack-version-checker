import { describe, it, expect } from 'vitest'
import { readPackMcmeta, isPackFormatCompatible } from '../src/pack-mcmeta.js'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

function withMcmeta(data: object, fn: (dir: string) => void) {
  const dir = mkdtempSync(join(tmpdir(), 'dpcheck-test-'))
  writeFileSync(join(dir, 'pack.mcmeta'), JSON.stringify(data))
  try { fn(dir) } finally { rmSync(dir, { recursive: true, force: true }) }
}

describe('readPackMcmeta', () => {
  it('reads pack_format from mcmeta', () => {
    withMcmeta({ pack: { pack_format: 15, description: 'test' } }, dir => {
      const result = readPackMcmeta(dir)
      expect(result.pack_format).toBe(15)
      expect(result.supported_formats).toEqual({ min: 15, max: 15 })
    })
  })

  it('parses supported_formats as a number', () => {
    withMcmeta({ pack: { pack_format: 15, supported_formats: 12, description: 'test' } }, dir => {
      expect(readPackMcmeta(dir).supported_formats).toEqual({ min: 12, max: 12 })
    })
  })

  it('parses supported_formats as an array', () => {
    withMcmeta({ pack: { pack_format: 15, supported_formats: [12, 13, 14, 15], description: 'test' } }, dir => {
      expect(readPackMcmeta(dir).supported_formats).toEqual({ min: 12, max: 15 })
    })
  })

  it('parses supported_formats as a range object', () => {
    withMcmeta({
      pack: { pack_format: 15, supported_formats: { min_inclusive: 12, max_inclusive: 15 }, description: 'test' },
    }, dir => {
      expect(readPackMcmeta(dir).supported_formats).toEqual({ min: 12, max: 15 })
    })
  })

  it('handles null supported_formats', () => {
    withMcmeta({ pack: { pack_format: 15, supported_formats: null, description: 'test' } }, dir => {
      const result = readPackMcmeta(dir)
      expect(result.supported_formats).toEqual({ min: 15, max: 15 })
    })
  })

  it('handles missing supported_formats', () => {
    withMcmeta({ pack: { pack_format: 15, description: 'test' } }, dir => {
      const result = readPackMcmeta(dir)
      expect(result.supported_formats).toEqual({ min: 15, max: 15 })
    })
  })

  it('normalizes bare int min_format/max_format', () => {
    withMcmeta({ pack: { pack_format: 88, min_format: 88, max_format: 88 } }, dir => {
      const result = readPackMcmeta(dir)
      expect(result.min_format).toEqual([88, 0])
      expect(result.max_format).toEqual([88, 0])
    })
  })

  it('normalizes single-element array min_format/max_format', () => {
    withMcmeta({ pack: { pack_format: 88, min_format: [88], max_format: [88] } }, dir => {
      const result = readPackMcmeta(dir)
      expect(result.min_format).toEqual([88, 0])
      expect(result.max_format).toEqual([88, 0])
    })
  })

  it('passes through [major, minor] min_format/max_format tuples', () => {
    withMcmeta({
      pack: { pack_format: 101, min_format: [61, 0], max_format: [101, 2147483647] },
    }, dir => {
      const result = readPackMcmeta(dir)
      expect(result.min_format).toEqual([61, 0])
      expect(result.max_format).toEqual([101, 2147483647])
    })
  })

  it('legacy pack leaves min_format/max_format null', () => {
    withMcmeta({ pack: { pack_format: 15, description: 'test' } }, dir => {
      const result = readPackMcmeta(dir)
      expect(result.min_format).toBeNull()
      expect(result.max_format).toBeNull()
      expect(result.pack_format).toBe(15)
      expect(result.supported_formats).toEqual({ min: 15, max: 15 })
    })
  })

  it('new-style pack (25w31a+ tuples, no pack_format) leaves supported_formats null', () => {
    withMcmeta({ pack: { description: 'test', min_format: [61, 0], max_format: [101, 2147483647] } }, dir => {
      const result = readPackMcmeta(dir)
      expect(result.supported_formats).toBeNull()
      expect(result.min_format).toEqual([61, 0])
      expect(result.max_format).toEqual([101, 2147483647])
      expect(result.pack_format).toBeUndefined()
    })
  })

  it('pack with no pack key returns the null-safe shape, no fabricated values', () => {
    withMcmeta({ description: 'minimal' }, dir => {
      const result = readPackMcmeta(dir)
      expect(result.supported_formats).toBeNull()
      expect(result.min_format).toBeNull()
      expect(result.max_format).toBeNull()
      expect(result.pack_format).toBeUndefined()
    })
  })

  it('legacy pack still returns correct legacy values', () => {
    withMcmeta({ pack: { pack_format: 15, description: 'test' } }, dir => {
      const result = readPackMcmeta(dir)
      expect(result.pack_format).toBe(15)
      expect(result.supported_formats).toEqual({ min: 15, max: 15 })
      expect(result.min_format).toBeNull()
      expect(result.max_format).toBeNull()
    })
  })

  it('truncates integral float min_format/max_format', () => {
    withMcmeta({ pack: { pack_format: 101, min_format: 101.1, max_format: 101.1 } }, dir => {
      const result = readPackMcmeta(dir)
      expect(result.min_format).toEqual([101, 0])
      expect(result.max_format).toEqual([101, 0])
    })
  })

  it('rejects unparseable min_format/max_format', () => {
    withMcmeta({ pack: { pack_format: 88, min_format: 'banana', max_format: [88, 'x'] } }, dir => {
      const result = readPackMcmeta(dir)
      expect(result.min_format).toBeNull()
      expect(result.max_format).toBeNull()
      expect(result.pack_format).toBe(88)
    })
  })
})

describe('isPackFormatCompatible', () => {
  it('exact match when no supported range', () => {
    expect(isPackFormatCompatible(15, null, 15, 0)).toBe(true)
  })

  it('mismatch when no supported range', () => {
    expect(isPackFormatCompatible(15, null, 12, 0)).toBe(false)
  })

  it('within supported range', () => {
    expect(isPackFormatCompatible(15, { min: 12, max: 15 }, 14, 0)).toBe(true)
  })

  it('below supported range', () => {
    expect(isPackFormatCompatible(15, { min: 12, max: 15 }, 11, 0)).toBe(false)
  })

  it('above supported range', () => {
    expect(isPackFormatCompatible(15, { min: 12, max: 15 }, 16, 0)).toBe(false)
  })

  it('handles minor version correctly (same logic)', () => {
    expect(isPackFormatCompatible(15, { min: 12, max: 15 }, 14, 1)).toBe(true)
  })
})