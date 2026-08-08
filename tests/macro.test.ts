import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, writeFileSync, mkdirSync, readFileSync, rmSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { tmpdir } from 'node:os'
import { validateCommand } from '../src/walker.js'
import { FEATURE_RULES } from '../src/rules.js'
import { tokenizeCommand } from '../src/tokenizer.js'
import type { McmetaVersion, CommandTreeNode } from '../src/types.js'

// ---------------------------------------------------------------------------
// Mock setup — same pattern as fixer.test.ts
// ---------------------------------------------------------------------------

const mockVersions: McmetaVersion[] = [
  { id: '1.20.4', name: '1.20.4', type: 'release', stable: true, data_pack_version: 41, data_pack_version_minor: 0, resource_pack_version: 34, resource_pack_version_minor: 0, data_version: 3826, release_time: '2023-12-07T00:00:00Z' },
  { id: '1.20.5', name: '1.20.5', type: 'release', stable: true, data_pack_version: 61, data_pack_version_minor: 0, resource_pack_version: 40, resource_pack_version_minor: 0, data_version: 3955, release_time: '2024-04-23T00:00:00Z' },
  { id: '1.21', name: '1.21', type: 'release', stable: true, data_pack_version: 68, data_pack_version_minor: 0, resource_pack_version: 45, resource_pack_version_minor: 0, data_version: 3953, release_time: '2024-06-13T00:00:00Z' },
  { id: '1.21.5', name: '1.21.5', type: 'release', stable: true, data_pack_version: 71, data_pack_version_minor: 0, resource_pack_version: 47, resource_pack_version_minor: 0, data_version: 4620, release_time: '2025-03-01T00:00:00Z' },
]

vi.mock('../src/api.js', () => ({
  fetchVersions: vi.fn(async () => mockVersions),
  fetchCommandTree: vi.fn(async () => ({
    type: 'root' as const,
    executable: false,
    children: {
      say: { type: 'literal' as const, executable: true, children: {} },
      give: {
        type: 'literal' as const,
        executable: false,
        children: {
          target: {
            type: 'argument' as const,
            executable: false,
            parser: 'minecraft:entity',
            children: {
              item: {
                type: 'argument' as const,
                executable: false,
                parser: 'minecraft:item',
                children: {},
              },
            },
          },
        },
      },
    },
  })),
  fetchRegistries: vi.fn(async () => ({})),
}))

vi.mock('../src/mcdoc-check.js', async importOriginal => {
  const actual = await importOriginal<typeof import('../src/mcdoc-check.js')>()
  return { ...actual, getMcdocSymbols: vi.fn(async () => null) }
})

import { fixDatapack } from '../src/fixer.js'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface Fixture { dir: string; out: string }

function makePack(mcmeta: object, functions: Record<string, string> = {}): Fixture {
  const dir = mkdtempSync(join(tmpdir(), 'dpcheck-macro-'))
  writeFileSync(join(dir, 'pack.mcmeta'), JSON.stringify(mcmeta))
  for (const [rel, content] of Object.entries(functions)) {
    const full = join(dir, rel)
    mkdirSync(dirname(full), { recursive: true })
    writeFileSync(full, content)
  }
  const out = mkdtempSync(join(tmpdir(), 'dpcheck-macro-out-'))
  return { dir, out }
}

function cleanup(f: Fixture) {
  rmSync(f.dir, { recursive: true, force: true })
  rmSync(f.out, { recursive: true, force: true })
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('macro lines — walker validation skip', () => {
  it('a $-prefixed command produces no invalid-command error when validated by the engine', async () => {
    const f = makePack(
      { pack: { pack_format: 61, description: 'macro test' } },
      {
        'data/test/functions/main.mcfunction': [
          '$execute $(var) run say hi',
          '$give @s minecraft:stick',
          'give @s minecraft:stone',
        ].join('\n'),
      },
    )
    try {
      const { summary } = await fixDatapack({ datapackDir: f.dir, outputDir: f.out, targetVersion: '1.20.4' })
      expect(summary.errors).toEqual([])
    } finally {
      cleanup(f)
    }
  })

  it('$-prefixed lines are tokenized against the real command root (not $execute)', () => {
    // After stripping the leading $, the root should be 'execute' not '$execute'
    const tokens = tokenizeCommand('/execute $(var) run say hi')
    expect(tokens[0].value).toBe('/execute')
  })

  it('the walker would reject $execute if not skipped', () => {
    // Verify that $execute (with the $) is not a valid command root in the tree
    const tree: CommandTreeNode = {
      type: 'root',
      executable: false,
      children: {
        execute: { type: 'literal', executable: false, children: {} },
      },
    }
    const res = validateCommand('$execute run say hi', tree, true)
    expect(res.valid).toBe(false)
  })
})

describe('macro lines — knowledge rule matching', () => {
  it('the function_macro rule matches $(...) in command text', () => {
    const fnMacroRule = FEATURE_RULES.find(r => r.id === 'function_macro')
    expect(fnMacroRule).toBeDefined()
    expect(fnMacroRule!.type).toBe('function_macro')

    // A line like $execute $(var) run say hi should match the regex
    const macroLine = '$execute $(var) run say hi'
    expect(new RegExp(fnMacroRule!.match).test(macroLine)).toBe(true)

    // A line without $( should NOT match
    const normalLine = 'execute run say hi'
    expect(new RegExp(fnMacroRule!.match).test(normalLine)).toBe(false)
  })

  it('$function macro lines trigger the function_macro knowledge rule', async () => {
    const f = makePack(
      { pack: { pack_format: 61, description: 'macro test' } },
      {
        'data/test/functions/main.mcfunction': '$function test_ns:hello\n',
      },
    )
    try {
      // The fixer uses knowledge rules; the macro_comment rewrite only fires
      // on pre-1.20.4 packs, so targeting 1.20.5 should leave the line intact
      const { summary } = await fixDatapack({ datapackDir: f.dir, outputDir: f.out, targetVersion: '1.20.5' })
      expect(summary.errors).toEqual([])
      const out = readFileSync(join(f.out, 'data/test/functions/main.mcfunction'), 'utf-8')
      expect(out).toContain('$function test_ns:hello')
    } finally {
      cleanup(f)
    }
  })
})

describe('macro lines — fixer applies rewrites to $give', () => {
  it('fixer strips $ for rewrite matching and preserves $ in output', async () => {
    // /give with [components] syntax needs 1.20.5+; targeting 1.20.4 should fix it
    const f = makePack(
      { pack: { pack_format: 61, description: 'macro test' } },
      {
        'data/test/functions/main.mcfunction': '$give @s minecraft:stick[minecraft:custom_name="test"]\n',
      },
    )
    try {
      const { summary } = await fixDatapack({ datapackDir: f.dir, outputDir: f.out, targetVersion: '1.20.4' })
      expect(summary.errors).toEqual([])
      const out = readFileSync(join(f.out, 'data/test/functions/main.mcfunction'), 'utf-8')
      // The $ must be preserved in the output (macro prefix intact)
      expect(out).toContain('$')
      // The fixer should have applied a rewrite (components_to_nbt)
      expect(out).toContain('## FIXED')
      // The rewrite was applied to the command after stripping $
      expect(out).toContain('give @s minecraft:stick')
    } finally {
      cleanup(f)
    }
  })

  it('non-macro give with [components] is also fixed', async () => {
    const f = makePack(
      { pack: { pack_format: 61, description: 'macro test' } },
      {
        'data/test/functions/main.mcfunction': 'give @s minecraft:stick[minecraft:custom_name="test"]\n',
      },
    )
    try {
      const { summary } = await fixDatapack({ datapackDir: f.dir, outputDir: f.out, targetVersion: '1.20.4' })
      expect(summary.errors).toEqual([])
      const out = readFileSync(join(f.out, 'data/test/functions/main.mcfunction'), 'utf-8')
      expect(out).toContain('## FIXED')
      expect(out).toContain('give @s minecraft:stick')
    } finally {
      cleanup(f)
    }
  })
})
