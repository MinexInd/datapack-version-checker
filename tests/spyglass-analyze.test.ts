import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { describe, it, expect, beforeAll } from 'vitest'
import { analyzePackWithSpyglass, clearSpyglassCache } from '../src/spyglass-analyze.js'

const VERSION = '1.21'

function makeTempPack(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'spyglass-analyze-test-'))
  fs.mkdirSync(path.join(dir, 'data', 'test', 'functions'), { recursive: true })
  fs.mkdirSync(path.join(dir, 'data', 'test', 'recipe'), { recursive: true })
  fs.writeFileSync(path.join(dir, 'pack.mcmeta'), JSON.stringify({
    pack: { pack_format: 48, description: 'test' },
  }, null, 2))
  fs.writeFileSync(path.join(dir, 'data', 'test', 'functions', 'ok.mcfunction'), 'say hello\n')
  // Leading slash is a parse error Spyglass always flags
  fs.writeFileSync(path.join(dir, 'data', 'test', 'functions', 'bad.mcfunction'), '/give @s minecraft:not_a_real_item\n')
  // Unknown item is a warning (not error), so we also check warnings
  return dir
}

describe('spyglass-analyze', () => {
  beforeAll(() => {
    clearSpyglassCache()
  }, 120_000)

  it('analyzes a pack and returns diagnostics for broken JSON', async () => {
    const dir = makeTempPack()
    let result: Awaited<ReturnType<typeof analyzePackWithSpyglass>> | null = null
    try {
      result = await analyzePackWithSpyglass(dir, VERSION)
    } catch (e) {
      const msg = (e as Error).message
      if (msg.includes('fetch') || msg.includes('network') || msg.includes('ECONNREFUSED') || msg.includes('ENOTFOUND')) {
        console.log(`[spyglass-analyze test] skipping: network unavailable for vanilla data (${VERSION})`)
        return
      }
      throw e
    }

    // The first call pays the vanilla-data download cost; cache protects later calls.
    expect(result.version).toBe(VERSION)
    expect(result.fileCount).toBeGreaterThanOrEqual(2)

    // bad.mcfunction must produce diagnostics (Spyglass flags the leading slash
    // as an error and/or the unknown item as a warning)
    const badDiags = result.diagnostics.filter(d =>
      d.file.includes('bad.mcfunction')
    )
    expect(badDiags.length).toBeGreaterThanOrEqual(1)
    expect(badDiags[0].line).toBeGreaterThan(0)
    expect(badDiags[0].column).toBeGreaterThanOrEqual(0)

    // ok.mcfunction should not produce errors
    const okErrors = result.diagnostics.filter(d =>
      d.file.includes('ok.mcfunction') && d.severity === 'error'
    )
    expect(okErrors.length).toBe(0)

    // Counts must match the diagnostics array
    expect(result.errorCount).toBe(result.diagnostics.filter(d => d.severity === 'error').length)
    expect(result.warningCount).toBe(result.diagnostics.filter(d => d.severity === 'warning').length)

    // Every diagnostic must have positive line/column
    for (const d of result.diagnostics) {
      expect(d.line).toBeGreaterThan(0)
      expect(d.column).toBeGreaterThanOrEqual(0)
      expect(d.endLine).toBeGreaterThanOrEqual(d.line)
    }
  }, 120_000)
})
