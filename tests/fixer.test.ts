import { describe, it, expect, vi } from 'vitest'
import { mkdtempSync, writeFileSync, mkdirSync, readFileSync, rmSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { tmpdir } from 'node:os'
import type { McmetaVersion } from '../src/types.js'

// Minimal known-versions fixture. Names/pack formats are chosen so the
// version gates in CMD_REWRITES resolve deterministically (1.20.4 -> 1.20.5
// is the /item <-> /replaceitem boundary) and so 26.1 is the only version
// with data_pack_version 101, which the max_format source detection targets.
const mockVersions = vi.hoisted<McmetaVersion[]>(() => [
  { id: '1.20.4', name: '1.20.4', type: 'release', stable: true, data_pack_version: 41, data_pack_version_minor: 0, resource_pack_version: 34, resource_pack_version_minor: 0, data_version: 3826, release_time: '2023-12-07T00:00:00Z' },
  { id: '1.20.5', name: '1.20.5', type: 'release', stable: true, data_pack_version: 61, data_pack_version_minor: 0, resource_pack_version: 40, resource_pack_version_minor: 0, data_version: 3955, release_time: '2024-04-23T00:00:00Z' },
  { id: '1.21.4', name: '1.21.4', type: 'release', stable: true, data_pack_version: 71, data_pack_version_minor: 0, resource_pack_version: 47, resource_pack_version_minor: 0, data_version: 4620, release_time: '2024-12-03T00:00:00Z' },
  { id: '26.1', name: '26.1', type: 'release', stable: true, data_pack_version: 101, data_pack_version_minor: 0, resource_pack_version: 70, resource_pack_version_minor: 0, data_version: 9000, release_time: '2026-01-01T00:00:00Z' },
])

// fixDatapack fetches the version list and mcdoc symbols; stub both so the
// tests exercise the fixer logic offline. Everything else stays real.
vi.mock('../src/api.js', () => ({
  fetchVersions: vi.fn(async () => mockVersions),
  fetchCommandTree: vi.fn(async () => ({})),
  fetchRegistries: vi.fn(async () => ({})),
}))

vi.mock('../src/mcdoc-check.js', async importOriginal => {
  const actual = await importOriginal<typeof import('../src/mcdoc-check.js')>()
  return { ...actual, getMcdocSymbols: vi.fn(async () => null) }
})

import { fixDatapack, fixResourcePack } from '../src/fixer.js'

interface Fixture {
  dir: string
  out: string
}

function makePack(mcmeta: object, functions: Record<string, string> = {}): Fixture {
  const dir = mkdtempSync(join(tmpdir(), 'dpcheck-fix-src-'))
  writeFileSync(join(dir, 'pack.mcmeta'), JSON.stringify(mcmeta))
  for (const [rel, content] of Object.entries(functions)) {
    const full = join(dir, rel)
    mkdirSync(dirname(full), { recursive: true })
    writeFileSync(full, content)
  }
  const out = mkdtempSync(join(tmpdir(), 'dpcheck-fix-out-'))
  return { dir, out }
}

function cleanup(f: Fixture) {
  rmSync(f.dir, { recursive: true, force: true })
  rmSync(f.out, { recursive: true, force: true })
}

describe('execute run sub-command rewrite (regression: no-leading-slash off-by-one)', () => {
  const srcLine = 'execute at @p run item replace entity @e[limit=1] armor.head with minecraft:stone 1'
  const expected = 'execute at @p run replaceitem entity @e[limit=1] armor.head minecraft:stone 1'

  it('rewrites a no-leading-slash execute run line with no swallowed characters', async () => {
    const f = makePack(
      { pack: { pack_format: 61, description: 'src' } },
      { 'data/demo/functions/test.mcfunction': srcLine + '\n' },
    )
    try {
      const { summary } = await fixDatapack({ datapackDir: f.dir, outputDir: f.out, targetVersion: '1.20.4' })
      expect(summary.errors).toEqual([])
      const out = readFileSync(join(f.out, 'data/demo/functions/test.mcfunction'), 'utf-8')
      expect(out).toBe(expected + '\n')
      // the first character of `item` must not leak into the rewritten subcommand
      expect(out).not.toContain('ireplaceitem')
    } finally {
      cleanup(f)
    }
  })

  it('rewrites the leading-slash variant identically', async () => {
    const f = makePack(
      { pack: { pack_format: 61, description: 'src' } },
      { 'data/demo/functions/test.mcfunction': '/' + srcLine + '\n' },
    )
    try {
      await fixDatapack({ datapackDir: f.dir, outputDir: f.out, targetVersion: '1.20.4' })
      const out = readFileSync(join(f.out, 'data/demo/functions/test.mcfunction'), 'utf-8')
      expect(out).toBe('/' + expected + '\n')
    } finally {
      cleanup(f)
    }
  })
})

describe('new-style pack (min_format/max_format) support in fixer (regression)', () => {
  it('resolves the source version from max_format without --from-version', async () => {
    const f = makePack({ pack: { description: '25w31a+', min_format: [61, 0], max_format: [101, 2147483647] } })
    try {
      const { plan, summary } = await fixDatapack({ datapackDir: f.dir, outputDir: f.out, targetVersion: '1.21.4' })
      expect(summary.errors).toEqual([])
      expect(plan.sourceVersion).toBe('26.1')
      // backward port 26.1 -> 1.21.4 proves the tuple was used, not a legacy fallback
      expect(plan.direction).toBe('backward')
    } finally {
      cleanup(f)
    }
  })

  it('updates min_format/max_format tuples without injecting pack_format', async () => {
    const f = makePack({ pack: { description: '25w31a+', min_format: [61, 0], max_format: [101, 2147483647] } })
    try {
      await fixDatapack({ datapackDir: f.dir, outputDir: f.out, targetVersion: '1.21.4' })
      const out = JSON.parse(readFileSync(join(f.out, 'pack.mcmeta'), 'utf-8'))
      expect(out.pack.min_format).toEqual([71, 0])
      expect(out.pack.max_format).toEqual([71, 0])
      expect('pack_format' in out.pack).toBe(false)
      expect('supported_formats' in out.pack).toBe(false)
    } finally {
      cleanup(f)
    }
  })

  it('legacy packs still get pack_format rewritten and supported_formats removed', async () => {
    const f = makePack({ pack: { pack_format: 41, supported_formats: [41, 61], description: 'legacy' } })
    try {
      await fixDatapack({ datapackDir: f.dir, outputDir: f.out, targetVersion: '1.21.4' })
      const out = JSON.parse(readFileSync(join(f.out, 'pack.mcmeta'), 'utf-8'))
      expect(out.pack.pack_format).toBe(71)
      expect('supported_formats' in out.pack).toBe(false)
      expect('min_format' in out.pack).toBe(false)
      expect('max_format' in out.pack).toBe(false)
    } finally {
      cleanup(f)
    }
  })
})

describe('resource pack fixer: new-style pack (min_format/max_format) support (regression)', () => {
  it('updates min_format/max_format tuples without injecting pack_format', async () => {
    const f = makePack({ pack: { description: '25w31a+', min_format: [40, 0], max_format: [70, 2147483647] } })
    try {
      await fixResourcePack({ packDir: f.dir, outputDir: f.out, targetVersion: '1.21.4' })
      const out = JSON.parse(readFileSync(join(f.out, 'pack.mcmeta'), 'utf-8'))
      expect(out.pack.min_format).toEqual([47, 0])
      expect(out.pack.max_format).toEqual([47, 0])
      expect('pack_format' in out.pack).toBe(false)
      expect('supported_formats' in out.pack).toBe(false)
    } finally {
      cleanup(f)
    }
  })

  it('legacy resource packs still get pack_format rewritten and supported_formats removed', async () => {
    const f = makePack({ pack: { pack_format: 34, supported_formats: [34, 40], description: 'legacy' } })
    try {
      await fixResourcePack({ packDir: f.dir, outputDir: f.out, targetVersion: '1.21.4' })
      const out = JSON.parse(readFileSync(join(f.out, 'pack.mcmeta'), 'utf-8'))
      expect(out.pack.pack_format).toBe(47)
      expect('supported_formats' in out.pack).toBe(false)
      expect('min_format' in out.pack).toBe(false)
      expect('max_format' in out.pack).toBe(false)
    } finally {
      cleanup(f)
    }
  })
})
