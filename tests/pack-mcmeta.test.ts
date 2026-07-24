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