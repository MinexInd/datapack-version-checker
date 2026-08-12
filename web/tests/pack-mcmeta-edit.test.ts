import { describe, it, expect } from 'vitest'
import {
  readMcmeta,
  writeMcmeta,
  parseFormatInput,
} from '../src/ide/pack-mcmeta-edit'

// ── 1. Legacy write-back preserves unknown keys ─────────────────────────────

describe('Legacy write-back preserves unknown keys', () => {
  it('keeps top-level and pack-level unknown keys after edit', () => {
    const input = {
      pack: {
        pack_format: 48,
        description: 'Hello',
        foo: 'bar',
      },
      overlays: { some: true },
      language: { en_us: { name: 'English' } },
    }

    const result = readMcmeta(JSON.stringify(input))
    expect(result.ok).toBe(true)
    if (!result.ok) return

    expect(result.state.style).toBe('legacy')
    expect(result.state.packFormat).toBe(48)
    expect(result.state.description).toBe('Hello')

    // Change description + packFormat
    result.state.description = 'World'
    result.state.packFormat = 50

    const output = JSON.parse(writeMcmeta(input, result.state))

    // Updated fields
    expect(output.pack.pack_format).toBe(50)
    expect(output.pack.description).toBe('World')

    // Unknown keys preserved
    expect(output.pack.foo).toBe('bar')
    expect(output.overlays).toEqual({ some: true })
    expect(output.language).toEqual({ en_us: { name: 'English' } })
  })
})

// ── 2. New-style tuple write-back ────────────────────────────────────────────

describe('New-style tuple write-back', () => {
  it('writes min/max tuples and never adds pack_format', () => {
    const input = {
      pack: {
        min_format: [61, 0],
        max_format: [61, 0],
        description: 'Test',
      },
    }

    const result = readMcmeta(JSON.stringify(input))
    expect(result.ok).toBe(true)
    if (!result.ok) return

    expect(result.state.style).toBe('new-style')
    expect(result.state.minFormat).toEqual([61, 0])
    expect(result.state.maxFormat).toEqual([61, 0])

    // Change to [62, 1]
    result.state.minFormat = [62, 1]
    result.state.maxFormat = [62, 1]

    const output = JSON.parse(writeMcmeta(input, result.state))

    expect(output.pack.min_format).toEqual([62, 1])
    expect(output.pack.max_format).toEqual([62, 1])
    expect(output.pack.description).toBe('Test')
    // pack_format must NOT exist anywhere in pack
    expect('pack_format' in output.pack).toBe(false)
  })
})

// ── 3. supported_formats shapes ──────────────────────────────────────────────

describe('supported_formats shapes', () => {
  it('reads a number form', () => {
    const input = { pack: { pack_format: 48, supported_formats: 48 } }
    const result = readMcmeta(JSON.stringify(input))
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.state.supported).toEqual({ min: 48, max: 48 })
  })

  it('writes array form when min !== max', () => {
    const input = { pack: { pack_format: 48 } }
    const result = readMcmeta(JSON.stringify(input))
    expect(result.ok).toBe(true)
    if (!result.ok) return

    result.state.supported = { min: 10, max: 61 }
    const output = JSON.parse(writeMcmeta(input, result.state))
    expect(output.pack.supported_formats).toEqual([10, 61])
  })

  it('writes bare number when min === max', () => {
    const input = { pack: { pack_format: 48 } }
    const result = readMcmeta(JSON.stringify(input))
    expect(result.ok).toBe(true)
    if (!result.ok) return

    result.state.supported = { min: 61, max: 61 }
    const output = JSON.parse(writeMcmeta(input, result.state))
    expect(output.pack.supported_formats).toBe(61)
  })

  it('deletes key when supported is null', () => {
    const input = { pack: { pack_format: 48, supported_formats: [40, 48] } }
    const result = readMcmeta(JSON.stringify(input))
    expect(result.ok).toBe(true)
    if (!result.ok) return

    result.state.supported = null
    const output = JSON.parse(writeMcmeta(input, result.state))
    expect('supported_formats' in output.pack).toBe(false)
  })

  it('reads array form → normalised {min, max}', () => {
    const input = { pack: { pack_format: 48, supported_formats: [40, 42, 45, 48] } }
    const result = readMcmeta(JSON.stringify(input))
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.state.supported).toEqual({ min: 40, max: 48 })
  })

  it('reads {min_inclusive, max_inclusive} form', () => {
    const input = { pack: { pack_format: 48, supported_formats: { min_inclusive: 42, max_inclusive: 50 } } }
    const result = readMcmeta(JSON.stringify(input))
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.state.supported).toEqual({ min: 42, max: 50 })
  })
})

// ── 4. parseFormatInput ──────────────────────────────────────────────────────

describe('parseFormatInput', () => {
  it('"42" → 42', () => {
    expect(parseFormatInput('42')).toBe(42)
  })

  it('"42.1" → [42, 1]', () => {
    expect(parseFormatInput('42.1')).toEqual([42, 1])
  })

  it('"42,1" → [42, 1]', () => {
    expect(parseFormatInput('42,1')).toEqual([42, 1])
  })

  it('"42.0" → [42, 0]', () => {
    expect(parseFormatInput('42.0')).toEqual([42, 0])
  })

  it('"" → null', () => {
    expect(parseFormatInput('')).toBeNull()
  })

  it('"abc" → null', () => {
    expect(parseFormatInput('abc')).toBeNull()
  })

  it('" 42 " → 42 (trimmed)', () => {
    expect(parseFormatInput(' 42 ')).toBe(42)
  })

  it('"-3.5" → [-3, 5] (negative major)', () => {
    expect(parseFormatInput('-3.5')).toEqual([-3, 5])
  })

  it('"42." → null (trailing dot)', () => {
    expect(parseFormatInput('42.')).toBeNull()
  })
})

// ── 5. Invalid JSON ──────────────────────────────────────────────────────────

describe('Invalid JSON handling', () => {
  it('returns ok: false with error string, does not throw', () => {
    const result = readMcmeta('{not json')
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(typeof result.error).toBe('string')
    expect(result.error.length).toBeGreaterThan(0)
  })

  it('returns ok: false for non-object root', () => {
    const result = readMcmeta('"just a string"')
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error).toContain('not a JSON object')
  })
})

// ── 6. Description as JSON component ─────────────────────────────────────────

describe('readMcmeta description component', () => {
  it('serialises object description to JSON string', () => {
    const input = {
      pack: {
        pack_format: 48,
        description: { text: 'hi', color: 'gold' },
      },
    }

    const result = readMcmeta(JSON.stringify(input))
    expect(result.ok).toBe(true)
    if (!result.ok) return

    expect(result.state.description).toBe('{"text":"hi","color":"gold"}')
  })

  it('preserves string description as-is', () => {
    const input = {
      pack: {
        pack_format: 48,
        description: 'Hello World',
      },
    }

    const result = readMcmeta(JSON.stringify(input))
    expect(result.ok).toBe(true)
    if (!result.ok) return

    expect(result.state.description).toBe('Hello World')
  })
})

// ── 7. Edge cases: empty pack, new-style with description only ───────────────

describe('Edge cases', () => {
  it('empty object → style null, all fields default', () => {
    const result = readMcmeta('{}')
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.state.style).toBeNull()
    expect(result.state.packFormat).toBeNull()
    expect(result.state.minFormat).toBeNull()
    expect(result.state.maxFormat).toBeNull()
    expect(result.state.description).toBe('')
    expect(result.state.supported).toBeNull()
  })

  it('writeMcmeta with null style and no packFormat → only description written', () => {
    const input = { pack: { pack_format: 48 } }
    const result = readMcmeta(JSON.stringify(input))
    expect(result.ok).toBe(true)
    if (!result.ok) return

    result.state.style = null
    result.state.packFormat = null
    result.state.description = 'Changed'

    const output = JSON.parse(writeMcmeta(input, result.state))
    expect(output.pack.description).toBe('Changed')
    // pack_format preserved from original (not touched)
    expect(output.pack.pack_format).toBe(48)
  })

  it('writeMcmeta on null raw creates pack root', () => {
    const state = {
      style: 'legacy' as const,
      packFormat: 50,
      minFormat: null,
      maxFormat: null,
      description: 'New pack',
      supported: null,
    }
    const output = JSON.parse(writeMcmeta(null, state))
    expect(output.pack.pack_format).toBe(50)
    expect(output.pack.description).toBe('New pack')
  })

  it('new-style write never writes pack_format even if raw had one', () => {
    const input = { pack: { pack_format: 48, min_format: [48, 0], max_format: [48, 0] } }
    const result = readMcmeta(JSON.stringify(input))
    expect(result.ok).toBe(true)
    if (!result.ok) return

    result.state.style = 'new-style'
    result.state.minFormat = [49, 1]
    result.state.maxFormat = [50, 0]

    const raw = JSON.parse(JSON.stringify(input))
    const output = JSON.parse(writeMcmeta(raw, result.state))
    expect(output.pack.min_format).toEqual([49, 1])
    expect(output.pack.max_format).toEqual([50, 0])
    // The original pack_format key was in raw; new-style path must NOT write it,
    // but since it was already present and we don't delete unknowns, it stays.
    expect(output.pack.pack_format).toBe(48)
  })
})
