import { describe, it, expect } from 'vitest'
import {
  normalizeCheckResponse,
  normalizeTechnicalChanges,
  normalizeMetadata,
  countBySeverity,
  toUnifiedResult,
  mergeResults,
  type UnifiedDiagnostic,
} from '../src/diagnostics.js'

describe('unified diagnostics model', () => {
  it('normalizeCheckResponse maps severity/message/file/line/column', () => {
    const resp = {
      problems: [
        {
          severity: 'error' as const,
          message: 'unknown command',
          file: 'data/test/functions/main.mcfunction',
          line: 3,
          column: 5,
          source: 'command',
          code: 'cmd.unknown',
        },
      ],
    }
    const out = normalizeCheckResponse(resp, '1.21')
    expect(out).toHaveLength(1)
    expect(out[0]).toMatchObject({
      source: 'command',
      code: 'cmd.unknown',
      file: 'data/test/functions/main.mcfunction',
      line: 3,
      column: 5,
      message: 'unknown command',
      version: '1.21',
      severity: 'error',
    })
  })

  it('normalizeCheckResponse normalizes windows separators to forward slash', () => {
    const resp = {
      problems: [{ severity: 'warning' as const, issue: 'x', path: 'data\\a\\b.json', line: 1, column: 1, source: 'registry' }],
    }
    const out = normalizeCheckResponse(resp, '1.21')
    expect(out[0].file).toBe('data/a/b.json')
  })

  it('normalizeTechnicalChanges sets source=technical-change with fallback version', () => {
    const out = normalizeTechnicalChanges({ '1.21': ['removed feature X'] }, '1.21')
    expect(out).toHaveLength(1)
    expect(out[0].source).toBe('technical-change')
    expect(out[0].message).toBe('removed feature X')
    expect(out[0].severity).toBe('warning')
  })

  it('normalizeTechnicalChanges handles ChangeEntry[] form', () => {
    const out = normalizeTechnicalChanges(
      [{ content: 'changed Y', releaseFolder: '1.21', snapId: 's1', tags: ['add'] }],
      '1.21',
    )
    expect(out[0].message).toBe('changed Y')
    expect(out[0].data).toMatchObject({ releaseFolder: '1.21', snapId: 's1' })
  })

  it('normalizeMetadata tags source=metadata', () => {
    const out = normalizeMetadata(
      [{ severity: 'error', message: 'missing pack.mcmeta' }],
      '1.21',
    )
    expect(out[0].source).toBe('metadata')
    expect(out[0].file).toBe('')
    expect(out[0].severity).toBe('error')
  })

  it('countBySeverity tallies error/warning/info/hint', () => {
    const diags: UnifiedDiagnostic[] = [
      { source: 'command', file: '', line: 1, column: 1, message: 'e', severity: 'error' },
      { source: 'command', file: '', line: 1, column: 1, message: 'w', severity: 'warning' },
      { source: 'command', file: '', line: 1, column: 1, message: 'i', severity: 'info' },
      { source: 'command', file: '', line: 1, column: 1, message: 'h', severity: 'hint' },
    ]
    expect(countBySeverity(diags)).toEqual({ error: 1, warning: 1, info: 1, hint: 1 })
  })

  it('mergeResults combines diagnostics and recounts', () => {
    const a = toUnifiedResult('1.21', [
      { source: 'command', file: '', line: 1, column: 1, message: 'e', severity: 'error' },
    ])
    const b = toUnifiedResult('1.21', [
      { source: 'registry', file: '', line: 1, column: 1, message: 'w', severity: 'warning' },
      { source: 'registry', file: '', line: 1, column: 1, message: 'w2', severity: 'warning' },
    ])
    const merged = mergeResults(a, b)
    expect(merged.diagnostics).toHaveLength(3)
    expect(merged.errorCount).toBe(1)
    expect(merged.warningCount).toBe(2)
  })
})
