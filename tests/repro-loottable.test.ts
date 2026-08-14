import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { describe, it, expect } from 'vitest'
import { resolveDynamicTypes, spyglassTypeToEngine } from '../web/src/engine/type-bridge.js'
import type * as mcdoc from '@spyglassmc/mcdoc'

/**
 * Synthetic loot_table-shaped schema used to reproduce the editor freeze.
 *
 * Real loot tables are the largest mcdoc schema in the game: a struct with a
 * `pools: list<LootPool>`, each `LootPool` has `entries: list<LootPoolEntry>`,
 * `LootPoolEntry` is a union of ~20 variants, each variant a struct with
 * `functions: list<LootFunction>` / `conditions: list<Condition>` (unions of
 * ~40 variants each), and those reference pools/entries again (recursion).
 *
 * `resolveDynamicTypes` / `spyglassTypeToEngine` had NO node budget, so a tree
 * of this shape either hangs (infinite resolve) or produces a 10k+ node object
 * that `McdocEditor` then tries to render synchronously → the "stuck resolving
 * / freeze" the user reports. This test measures the explosion directly.
 */

// Build a fake CheckerContext + SimplifyContext the bridge expects.
const fakeCtx = {
  node: { entryNode: { parent: undefined, runtimeKey: undefined }, node: { originalNode: undefined as never, inferredType: undefined as never } },
  ctx: {
    symbols: { query: () => ({ symbol: undefined, getData: () => undefined }) },
    doc: { uri: 'file:///test' },
  },
} as unknown as Parameters<typeof resolveDynamicTypes>[1]

function makeStruct(fields: Record<string, any>): any {
  return {
    kind: 'struct',
    fields: Object.entries(fields).map(([key, type]) => ({
      kind: 'pair', key: { kind: 'literal', value: { value: key } }, type, optional: false,
    })),
    attributes: [],
  }
}

function makeRef(path: string): any {
  return { kind: 'reference', path }
}

const variants: string[] = []
for (let i = 0; i < 25; i++) variants.push(`loot_entry_${i}`)
const funcVariants: string[] = []
for (let i = 0; i < 40; i++) funcVariants.push(`loot_func_${i}`)

// LootPool -> LootPoolEntry (union) -> structs that reference LootPool again (cycle)
const lootPoolEntry = {
  kind: 'union',
  members: variants.map(v => makeStruct({
    type: { kind: 'literal', value: { value: v } },
    // each entry carries functions + conditions that recurse into pools
    functions: { kind: 'list', item: makeRef('minecraft:loot/LootFunction') },
    conditions: { kind: 'list', item: makeRef('minecraft:loot/Condition') },
    // and can nest a sub-pool (real loot tables do this)
    children: { kind: 'list', item: makeRef('minecraft:loot/LootPool') },
  })),
  attributes: [],
}

const lootPool = makeStruct({
  rolls: { kind: 'int' },
  entries: { kind: 'list', item: lootPoolEntry },
  functions: { kind: 'list', item: makeRef('minecraft:loot/LootFunction') },
})

const lootTableRoot = makeStruct({
  pools: { kind: 'list', item: lootPool },
  functions: { kind: 'list', item: makeRef('minecraft:loot/LootFunction') },
})

// Register the referenced symbols so the bridge can resolve them (mimicking the
// real symbol table depth). We don't actually query, so makeRef falls back to
// recursion via simplify — but the bridge's cycle guard is what we're testing.
function countNodes(v: unknown, seen = new WeakSet<object>()): number {
  if (v === null || typeof v !== 'object') return 1
  if (seen.has(v as object)) return 0
  seen.add(v as object)
  if (Array.isArray(v)) return 1 + v.reduce((s, x) => s + countNodes(x, seen), 0)
  let n = 1
  for (const key of Object.keys(v as object)) n += countNodes((v as any)[key], seen)
  return n
}

describe('repro-loottable-freeze', () => {
  it('bounds loot_table-style schema expansion (freeze regression guard)', () => {
    const t0 = Date.now()
    // The fake ctx symbols.query returns undefined, so resolveDynamicTypes hits
    // its reference fallback. A loot-table-shaped schema (deep pools → entries →
    // functions/conditions unions with many variants, recursing via nested pools)
    // previously expanded to a 10k+ node tree that McdocEditor rendered
    // synchronously — freezing the tab. The node budget must cap it.
    const resolved = resolveDynamicTypes(lootTableRoot as any, fakeCtx, 0)
    const out = spyglassTypeToEngine(resolved as any)
    const ms = Date.now() - t0
    const nodes = countNodes(out)
    // Hard guard: resolution must stay bounded and fast enough to never freeze.
    expect(nodes).toBeLessThanOrEqual(8000)
    expect(ms).toBeLessThan(1000)
    fs.writeFileSync(path.join(os.tmpdir(), 'repro-loot-result.txt'),
      `resolved in ${ms}ms, ${nodes} nodes\n`)
  })
})
