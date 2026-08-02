import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import {
  buildResourceIndex,
  buildDependencyGraph,
  findOrphans,
  findCircularDeps,
  computeMetrics,
  analyzePack,
} from '../src/analyzer.js'

let tmpDir: string

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'analyzer-test-'))
})

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true })
})

function writePack(paths: Record<string, string>) {
  for (const [rel, content] of Object.entries(paths)) {
    const full = join(tmpDir, rel)
    mkdirSync(join(full, '..'), { recursive: true })
    writeFileSync(full, content, 'utf-8')
  }
}

describe('buildResourceIndex', () => {
  it('indexes mcfunction files under data/<ns>/functions/', () => {
    writePack({
      'data/mc/functions/foo.mcfunction': '',
      'data/mc/functions/bar.mcfunction': '',
    })
    const idx = buildResourceIndex(tmpDir)
    expect(idx).toHaveLength(2)
    expect(idx.map(r => r.fullPath)).toContain('mc:foo')
    expect(idx.map(r => r.fullPath)).toContain('mc:bar')
  })

  it('indexes JSON files in various registry paths', () => {
    writePack({
      'data/mc/loot_tables/chests/simple.json': '{}',
      'data/mc/recipes/test.json': '{}',
      'data/mc/advancements/test.json': '{}',
      'data/mc/predicates/test.json': '{}',
      'data/mc/worldgen/biome/plains.json': '{}',
    })
    const idx = buildResourceIndex(tmpDir)
    expect(idx).toHaveLength(5)
    expect(idx.filter(r => r.type === 'loot_table')).toHaveLength(1)
    expect(idx.filter(r => r.type === 'recipe')).toHaveLength(1)
    expect(idx.filter(r => r.type === 'worldgen/biome')).toHaveLength(1)
  })

  it('indexes assets/models (JSON files only)', () => {
    writePack({
      'assets/mc/models/block/stone.json': '{}',
    })
    const idx = buildResourceIndex(tmpDir)
    const types = idx.map(r => r.type)
    expect(types).toContain('model')
  })

  it('indexes function tags', () => {
    writePack({
      'data/mc/tags/functions/tick.json': '{"values":["mc:foo"]}',
    })
    const idx = buildResourceIndex(tmpDir)
    const tags = idx.filter(r => r.type === 'tag/function')
    expect(tags).toHaveLength(1)
    expect(tags[0].name).toBe('tick')
  })

  it('returns empty array for pack with no data/assets', () => {
    const idx = buildResourceIndex(tmpDir)
    expect(idx).toEqual([])
  })
})

describe('buildDependencyGraph', () => {
  it('builds correct dependsOn/dependedBy maps from references', () => {
    const resources = [
      { file: 'data/mc/functions/a.mcfunction', fullPath: 'mc:a', namespace: 'mc', name: 'a', type: 'function', size: 0 },
      { file: 'data/mc/functions/b.mcfunction', fullPath: 'mc:b', namespace: 'mc', name: 'b', type: 'function', size: 0 },
      { file: 'data/mc/functions/c.mcfunction', fullPath: 'mc:c', namespace: 'mc', name: 'c', type: 'function', size: 0 },
    ]
    const refs = [
      { from: 'data/mc/functions/a.mcfunction', to: 'mc:b', type: 'function_call', file: 'data/mc/functions/a.mcfunction' },
      { from: 'data/mc/functions/b.mcfunction', to: 'mc:c', type: 'function_call', file: 'data/mc/functions/b.mcfunction' },
    ]
    const graph = buildDependencyGraph(resources, refs)
    expect(graph.dependsOn.get('data/mc/functions/a.mcfunction')).toEqual(new Set(['data/mc/functions/b.mcfunction']))
    expect(graph.dependsOn.get('data/mc/functions/b.mcfunction')).toEqual(new Set(['data/mc/functions/c.mcfunction']))
    expect(graph.dependedBy.get('data/mc/functions/b.mcfunction')).toEqual(new Set(['data/mc/functions/a.mcfunction']))
    expect(graph.dependedBy.get('data/mc/functions/c.mcfunction')).toEqual(new Set(['data/mc/functions/b.mcfunction']))
  })

  it('skips self-references', () => {
    const resources = [
      { file: 'data/mc/functions/a.mcfunction', fullPath: 'mc:a', namespace: 'mc', name: 'a', type: 'function', size: 0 },
    ]
    const refs = [
      { from: 'data/mc/functions/a.mcfunction', to: 'mc:a', type: 'function_call', file: 'data/mc/functions/a.mcfunction' },
    ]
    const graph = buildDependencyGraph(resources, refs)
    expect(graph.dependsOn.size).toBe(0)
  })

  it('handles references to non-existent resources gracefully', () => {
    const resources: any[] = []
    const refs = [
      { from: 'data/mc/functions/a.mcfunction', to: 'mc:nonexistent', type: 'function_call', file: 'data/mc/functions/a.mcfunction' },
    ]
    const graph = buildDependencyGraph(resources, refs)
    expect(graph.dependsOn.size).toBe(0)
  })
})

describe('findCircularDeps', () => {
  it('detects a simple cycle between two nodes', () => {
    const dependsOn = new Map<string, Set<string>>()
    dependsOn.set('a', new Set(['b']))
    dependsOn.set('b', new Set(['a']))
    const cycles = findCircularDeps(dependsOn)
    expect(cycles.length).toBeGreaterThanOrEqual(1)
    expect(cycles[0]).toContain('a')
    expect(cycles[0]).toContain('b')
  })

  it('detects a longer cycle', () => {
    const dependsOn = new Map<string, Set<string>>()
    dependsOn.set('a', new Set(['b']))
    dependsOn.set('b', new Set(['c']))
    dependsOn.set('c', new Set(['a']))
    const cycles = findCircularDeps(dependsOn)
    expect(cycles.length).toBeGreaterThanOrEqual(1)
  })

  it('returns empty array when no cycles exist', () => {
    const dependsOn = new Map<string, Set<string>>()
    dependsOn.set('a', new Set(['b']))
    dependsOn.set('b', new Set(['c']))
    dependsOn.set('c', new Set())
    const cycles = findCircularDeps(dependsOn)
    expect(cycles).toEqual([])
  })

  it('handles empty graph', () => {
    expect(findCircularDeps(new Map())).toEqual([])
  })
})

describe('findOrphans', () => {
  it('marks functions with no inbound deps as orphans', () => {
    const resources = [
      { file: 'data/mc/functions/orphan.mcfunction', fullPath: 'mc:orphan', namespace: 'mc', name: 'orphan', type: 'function', size: 0 },
      { file: 'data/mc/functions/used.mcfunction', fullPath: 'mc:used', namespace: 'mc', name: 'used', type: 'function', size: 0 },
    ]
    const dependedBy = new Map<string, Set<string>>()
    dependedBy.set('data/mc/functions/used.mcfunction', new Set(['some-caller']))
    const orphans = findOrphans(resources, dependedBy, tmpDir)
    const orphanNames = orphans.map(r => r.name)
    expect(orphanNames).toContain('orphan')
    expect(orphanNames).not.toContain('used')
  })

  it('skips tags, textures, models, blockstates', () => {
    const resources = [
      { file: 'data/mc/tags/functions/tick.json', fullPath: 'mc:tick', namespace: 'mc', name: 'tick', type: 'tag/function', size: 0 },
      { file: 'assets/mc/textures/block/stone.png', fullPath: 'mc:stone', namespace: 'mc', name: 'stone', type: 'texture', size: 0 },
    ]
    const orphans = findOrphans(resources, new Map(), tmpDir)
    expect(orphans).toHaveLength(0)
  })
})

describe('findOrphans — tick/load entry-point exemption (regression)', () => {
  // The old condition `r.type.startsWith('tag/') && r.file.includes('tick') ||
  // r.file.includes('load')` exempted every orphan whenever ANY resource path
  // contained "load" (e.g. a function named load.mcfunction itself). Both
  // conditions must hold: a tag resource AND a tick/load file name.

  it('does not exempt an orphan function just because its own path contains "load"', () => {
    const resources = [
      { file: 'data/mc/functions/load.mcfunction', fullPath: 'mc:load', namespace: 'mc', name: 'load', type: 'function', size: 0 },
    ]
    const orphans = findOrphans(resources, new Map(), tmpDir)
    expect(orphans.map(r => r.name)).toContain('load')
  })

  it('does not exempt an orphan function just because its own path contains "tick"', () => {
    const resources = [
      { file: 'data/mc/functions/tick.mcfunction', fullPath: 'mc:tick', namespace: 'mc', name: 'tick', type: 'function', size: 0 },
    ]
    const orphans = findOrphans(resources, new Map(), tmpDir)
    expect(orphans.map(r => r.name)).toContain('tick')
  })

  it('does not exempt orphans for non-tag resources whose path contains "load"', () => {
    const resources = [
      { file: 'data/mc/functions/helper.mcfunction', fullPath: 'mc:helper', namespace: 'mc', name: 'helper', type: 'function', size: 0 },
      { file: 'data/mc/loot_tables/load_chest.json', fullPath: 'mc:load_chest', namespace: 'mc', name: 'load_chest', type: 'loot_table', size: 0 },
    ]
    const orphans = findOrphans(resources, new Map(), tmpDir)
    expect(orphans.map(r => r.name)).toContain('helper')
  })

  it('exempts orphans when a tick function tag exists in the pack', () => {
    const resources = [
      { file: 'data/mc/functions/on_tick.mcfunction', fullPath: 'mc:on_tick', namespace: 'mc', name: 'on_tick', type: 'function', size: 0 },
      { file: 'data/mc/tags/functions/tick.json', fullPath: 'mc:tick', namespace: 'mc', name: 'tick', type: 'tag/function', size: 0 },
    ]
    const orphans = findOrphans(resources, new Map(), tmpDir)
    expect(orphans.map(r => r.name)).not.toContain('on_tick')
  })

  it('exempts orphans when a load function tag exists in the pack', () => {
    const resources = [
      { file: 'data/mc/functions/init.mcfunction', fullPath: 'mc:init', namespace: 'mc', name: 'init', type: 'function', size: 0 },
      { file: 'data/mc/tags/functions/load.json', fullPath: 'mc:load', namespace: 'mc', name: 'load', type: 'tag/function', size: 0 },
    ]
    const orphans = findOrphans(resources, new Map(), tmpDir)
    expect(orphans.map(r => r.name)).not.toContain('init')
  })

  it('exempts orphans when any tag file path contains tick or load (documented behavior)', () => {
    const resources = [
      { file: 'data/mc/functions/uncalled.mcfunction', fullPath: 'mc:uncalled', namespace: 'mc', name: 'uncalled', type: 'function', size: 0 },
      { file: 'data/mc/tags/blocks/tick_blocks.json', fullPath: 'mc:tick_blocks', namespace: 'mc', name: 'tick_blocks', type: 'tag/block', size: 0 },
    ]
    const orphans = findOrphans(resources, new Map(), tmpDir)
    expect(orphans.map(r => r.name)).not.toContain('uncalled')
  })
})

describe('computeMetrics', () => {
  it('counts functions, commands, and namespaces', () => {
    writePack({
      'data/mc/functions/a.mcfunction': 'say hello\nsay world\n',
      'data/mc/functions/b.mcfunction': 'say test\n',
      'data/mc/loot_tables/test.json': '{}',
    })
    const resources = buildResourceIndex(tmpDir)
    const metrics = computeMetrics(tmpDir, resources)
    expect(metrics.totalFunctions).toBe(2)
    expect(metrics.totalJsonFiles).toBe(1)
    expect(metrics.totalResources).toBe(3)
    expect(metrics.totalCommands).toBe(3)
    expect(metrics.avgCommandsPerFunction).toBe(2)
    expect(metrics.namespaceCounts['mc']).toBe(3)
  })

  it('measures execute depth', () => {
    writePack({
      'data/mc/functions/deep.mcfunction': 'execute as @a at @s run say hi\n',
    })
    const resources = buildResourceIndex(tmpDir)
    const metrics = computeMetrics(tmpDir, resources)
    expect(metrics.maxExecuteDepth).toBe(1)
  })

  it('finds the largest function by line count', () => {
    writePack({
      'data/mc/functions/small.mcfunction': 'say a\n',
      'data/mc/functions/big.mcfunction': Array(100).fill('say x').join('\n'),
    })
    const resources = buildResourceIndex(tmpDir)
    const metrics = computeMetrics(tmpDir, resources)
    expect(metrics.largestFunction?.file).toBe('data/mc/functions/big.mcfunction')
    expect(metrics.largestFunction?.lines).toBe(100)
  })

  it('returns zeros for empty pack', () => {
    const metrics = computeMetrics(tmpDir, [])
    expect(metrics.totalFunctions).toBe(0)
    expect(metrics.totalCommands).toBe(0)
    expect(metrics.avgCommandsPerFunction).toBe(0)
    expect(metrics.largestFunction).toBeNull()
  })
})

describe('analyzePack — full pipeline', () => {
  it('produces analysis with resources, metrics, and orphans for a simple pack', async () => {
    writePack({
      'data/mc/functions/a.mcfunction': 'say hello\nfunction mc:b\n',
      'data/mc/functions/b.mcfunction': 'say world\n',
      'pack.mcmeta': '{"pack":{"pack_format":15}}',
    })
    const result = await analyzePack(tmpDir)
    expect(result.resources).toHaveLength(2)
    expect(result.metrics.totalFunctions).toBe(2)
    expect(result.references.length).toBeGreaterThanOrEqual(1)
    expect(result.orphans).toHaveLength(1) // b is not called by anything
    expect(result.brokenRefs).toHaveLength(0)
    expect(result.circularDeps).toEqual([])
  })

  it('detects broken references', async () => {
    writePack({
      'data/mc/functions/a.mcfunction': 'function mc:nonexistent\n',
    })
    const result = await analyzePack(tmpDir)
    expect(result.brokenRefs.length).toBeGreaterThanOrEqual(1)
    expect(result.brokenRefs[0].to).toBe('mc:nonexistent')
  })

  it('does not report valid cross-file references as broken', async () => {
    writePack({
      'data/mc/functions/a.mcfunction': 'function mc:b\n',
      'data/mc/functions/b.mcfunction': 'say hi\n',
    })
    const result = await analyzePack(tmpDir)
    expect(result.brokenRefs).toHaveLength(0)
  })

  it('resolves prefix references (ns:path matching a shorter resource name)', async () => {
    // ref 'minecraft:story/root' resolves to the resource named 'story' via
    // the name.startsWith(r.name + '/') rule; previously this ref would have
    // been reported broken (fullPath equality only).
    writePack({
      'data/mc/functions/a.mcfunction': 'function minecraft:story/root\n',
      'data/minecraft/functions/story.mcfunction': 'say hi\n',
    })
    const result = await analyzePack(tmpDir)
    expect(result.brokenRefs).toHaveLength(0)
  })

  it('resolves path-style references (ns:path matching a nested resource name)', async () => {
    writePack({
      'data/mc/functions/a.mcfunction': 'function minecraft:chests/simple\n',
      'data/minecraft/loot_tables/chests/simple.json': '{"pools":[]}',
    })
    const result = await analyzePack(tmpDir)
    expect(result.brokenRefs).toHaveLength(0)
  })

  it('detects circular dependencies across functions', async () => {
    writePack({
      'data/mc/functions/a.mcfunction': 'function mc:b\n',
      'data/mc/functions/b.mcfunction': 'function mc:a\n',
    })
    const result = await analyzePack(tmpDir)
    expect(result.circularDeps.length).toBeGreaterThanOrEqual(1)
  })

  it('handles empty pack gracefully', async () => {
    const result = await analyzePack(tmpDir)
    expect(result.resources).toEqual([])
    expect(result.references).toEqual([])
    expect(result.orphans).toEqual([])
    expect(result.brokenRefs).toEqual([])
    expect(result.circularDeps).toEqual([])
    expect(result.metrics.totalFunctions).toBe(0)
  })
})
