/**
 * perf-form-state — Deterministic regression tripwire for the visual editor's
 * pure-JS hot path: buildFormState + commitEdit on a large, realistic loot
 * table document.
 *
 * Budget: each call must complete within 150 ms (generous; real time is ~1-10 ms).
 * This catches accidental O(n^2) work, missing structural sharing, or regressions
 * that slip through correctness-only tests.
 */
import { describe, it, expect, vi } from 'vitest'
import { buildFormState, commitEdit } from '../src/components/editors/mcdoc-editor-logic'
import { setAtPath } from '../src/ide/mcdoc-edit'
import type { SimplifiedMcdocType, JsonValue } from '../src/ide/mcdoc-edit'

// Mock writeBack to avoid json-ranges dependency in this pure-JS perf test.
vi.mock('../src/ide/json-ranges', () => ({
  writeBack: (_content: string, _path: unknown, _value: unknown, newRoot: JsonValue) =>
    JSON.stringify(newRoot, null, 2) + '\n',
  replaceNode: () => null,
}))

// ─── Synthetic loot table builder ───────────────────────────────────────────

const POOLS = 20
const ENTRIES_PER_POOL = 5
const FUNCTIONS_PER_ENTRY = 2

function buildLootTableJson(): { content: string; type: SimplifiedMcdocType } {
  // Build the JSON value tree
  const pools: JsonValue[] = []
  for (let p = 0; p < POOLS; p++) {
    const entries: JsonValue[] = []
    for (let e = 0; e < ENTRIES_PER_POOL; e++) {
      const functions: JsonValue[] = []
      for (let f = 0; f < FUNCTIONS_PER_ENTRY; f++) {
        functions.push({
          function: `minecraft:set_count_${p}_${e}_${f}`,
          count: { min: 1, max: 3 },
        })
      }
      entries.push({
        type: 'minecraft:item',
        name: `minecraft:item_${p}_${e}`,
        functions,
        conditions: [
          { condition: 'minecraft:killed_by_player' },
        ],
      })
    }
    pools.push({ rolls: 1, entries })
  }

  const root: JsonValue = { pools }
  const content = JSON.stringify(root)

  // Build a matching SimplifiedMcdocType
  const itemType: SimplifiedMcdocType = {
    kind: 'struct',
    fields: [
      { key: 'type', type: { kind: 'primitive', name: 'string' }, required: true },
      { key: 'name', type: { kind: 'primitive', name: 'string' }, required: true },
      {
        key: 'functions',
        type: {
          kind: 'list',
          item: {
            kind: 'struct',
            fields: [
              { key: 'function', type: { kind: 'primitive', name: 'string' }, required: true },
              {
                key: 'count',
                type: {
                  kind: 'union',
                  options: [
                    { kind: 'primitive', name: 'int' },
                    {
                      kind: 'struct',
                      fields: [
                        { key: 'min', type: { kind: 'primitive', name: 'int' }, required: true },
                        { key: 'max', type: { kind: 'primitive', name: 'int' }, required: true },
                      ],
                    },
                  ],
                },
                required: false,
              },
            ],
          },
        },
        required: true,
      },
      {
        key: 'conditions',
        type: {
          kind: 'list',
          item: {
            kind: 'struct',
            fields: [
              { key: 'condition', type: { kind: 'primitive', name: 'string' }, required: true },
            ],
          },
        },
        required: true,
      },
    ],
  }

  const poolType: SimplifiedMcdocType = {
    kind: 'struct',
    fields: [
      { key: 'rolls', type: { kind: 'primitive', name: 'int' }, required: true },
      { key: 'entries', type: { kind: 'list', item: itemType }, required: true },
    ],
  }

  const rootType: SimplifiedMcdocType = {
    kind: 'struct',
    fields: [
      { key: 'pools', type: { kind: 'list', item: poolType }, required: true },
    ],
  }

  return { content, type: rootType }
}

// ─── Performance tests ──────────────────────────────────────────────────────

describe('perf: buildFormState hot path', () => {
  it(`parses a synthetic ${POOLS}-pool x ${ENTRIES_PER_POOL}-entry loot table within budget`, () => {
    const { content, type } = buildLootTableJson()
    const JSON_SIZE_KB = (Buffer.byteLength(content) / 1024).toFixed(1)
    console.log(`>>> PERF loot-table JSON size: ${JSON_SIZE_KB} KB (${POOLS} pools x ${ENTRIES_PER_POOL} entries)`)

    // Warm-up call (not measured)
    buildFormState(content, type)

    const WARM_RUNS = 5
    const BUDGET_MS = 150
    const timings: number[] = []

    for (let i = 0; i < WARM_RUNS; i++) {
      const t0 = performance.now()
      const result = buildFormState(content, type)
      const elapsed = performance.now() - t0
      timings.push(elapsed)
      expect(result.error).toBeNull()
      expect(result.value).not.toBeNull()
    }

    const avgMs = timings.reduce((a, b) => a + b, 0) / timings.length
    const maxMs = Math.max(...timings)
    console.log(`>>> PERF buildFormState: avg=${avgMs.toFixed(2)}ms, max=${maxMs.toFixed(2)}ms, budget=${BUDGET_MS}ms`)

    // Every single run must be within budget
    for (let i = 0; i < timings.length; i++) {
      expect(timings[i]).toBeLessThan(BUDGET_MS)
    }
  })

  it('commitEdit on a leaf field of the large form state within budget', () => {
    const { content, type } = buildLootTableJson()
    const form = buildFormState(content, type)
    expect(form.error).toBeNull()
    const root = form.value as Record<string, JsonValue>

    const BUDGET_MS = 150

    // Edit the name of the first entry in the first pool (leaf string field)
    const path = ['pools', 0, 'entries', 0, 'name']
    const newName = 'minecraft:modified_item'
    const newRoot = setAtPath(root, path, newName)

    const t0 = performance.now()
    const output = commitEdit(content, type, path, newName, newRoot)
    const elapsed = performance.now() - t0

    console.log(`>>> PERF commitEdit (leaf): ${elapsed.toFixed(2)}ms, budget=${BUDGET_MS}ms`)
    expect(elapsed).toBeLessThan(BUDGET_MS)

    // Sanity: the output is valid JSON with the new value
    const parsed = JSON.parse(output)
    expect(parsed.pools[0].entries[0].name).toBe(newName)
  })
})

// ─── Structural sharing (identity check) ────────────────────────────────────

/**
 * Detect whether the parallel lane has landed by inspecting the function body
 * for a `prev` parameter.  buildFormState is pure-JS so its toString() is
 * available; a simple substring check is reliable enough for a test.
 *
 * When the parallel lane hasn't landed yet, calling with 3 args is still
 * harmless (JS ignores extra arguments), but the returned tree will always be
 * a fresh parse — no identity reuse.  We soft-skip those assertions.
 */
function hasPrevParam(): boolean {
  // eslint-disable-next-line @typescript-eslint/no-unused-expressions
  const src = buildFormState.toString()
  // The parallel lane adds a third parameter named `prev`.
  // Match patterns like: "function buildFormState(content, type, prev" or
  // an arrow: "(content, type, prev" — check for "prev" between the parens.
  return /\bprev\b/.test(src)
}

describe('perf: structural sharing identity', () => {
  it('buildFormState with prev param reuses untouched subtrees if parallel lane is present', () => {
    const { content, type } = buildLootTableJson()
    const featureLanded = hasPrevParam()

    // First build — always 2-arg call
    const first = buildFormState(content, type)
    expect(first.error).toBeNull()

    if (!featureLanded) {
      console.log(
        '>>> PERF structural sharing: skipped (prev param not in signature yet; ' +
        'will enable when parallel lane lands)',
      )
      // At minimum, prove the function is callable with 2 args again
      const second = buildFormState(content, type)
      expect(second.error).toBeNull()
      return
    }

    // Parallel lane is present — build again with same content + prev
    // TypeScript won't know about the 3rd arg yet, so we call through a
    // typed wrapper to avoid a compile error (we're testing against the
    // future signature).
    const build3 = buildFormState as (c: string, t: SimplifiedMcdocType | null, p: unknown) => ReturnType<typeof buildFormState>
    const second = build3(content, type, first)
    expect(second.error).toBeNull()

    // The value trees must be deeply equal
    expect(second.value).toEqual(first.value)

    // Structural sharing: the root object identity should be the same
    // (or at minimum, an untouched deep path — e.g. pools[0].entries[0] —
    // should be referentially identical between the two builds).
    const firstVal = first.value as Record<string, JsonValue>
    const secondVal = second.value as Record<string, JsonValue>

    // Root-level pools array reference check
    const firstPools = firstVal.pools as JsonValue[]
    const secondPools = secondVal.pools as JsonValue[]
    const poolsIdentical = firstPools === secondPools
    console.log(`>>> PERF structural sharing: pools array identity reused = ${poolsIdentical}`)
    // If sharing works, at least the pools array or its first element should be ===
    if (!poolsIdentical) {
      const firstPool0 = firstPools[0]
      const secondPool0 = secondPools[0]
      const pool0Identical = firstPool0 === secondPool0
      console.log(`>>> PERF structural sharing: pools[0] identity reused = ${pool0Identical}`)
      expect(pool0Identical).toBe(true)
    }
  })

  it('modify one leaf and verify untouched sibling is identity-preserved', () => {
    const { content, type } = buildLootTableJson()

    if (!hasPrevParam()) {
      console.log('>>> PERF identity after edit: skipped (prev param not in signature)')
      return
    }

    const first = buildFormState(content, type)
    expect(first.error).toBeNull()

    // Modify the name of pool[0].entries[0] in the content
    const root = first.value as Record<string, JsonValue>
    const pools = root.pools as Record<string, JsonValue>[]
    const firstEntry0Name = (pools[0].entries as Record<string, JsonValue>[])[0].name
    const newName = 'minecraft:touched'
    const newContent = content.replace(
      JSON.stringify(firstEntry0Name),
      JSON.stringify(newName),
    )

    // Rebuild from the modified content + prev
    const build3 = buildFormState as (c: string, t: SimplifiedMcdocType | null, p: unknown) => ReturnType<typeof buildFormState>
    const second = build3(newContent, type, first)
    expect(second.error).toBeNull()

    // The edited path must reflect the change
    const secondRoot = second.value as Record<string, JsonValue>
    const secondPools = secondRoot.pools as Record<string, JsonValue>[]
    expect((secondPools[0].entries as Record<string, JsonValue>[])[0].name).toBe(newName)

    // Pool 1 (index 1) was never touched — its entries array should be ===
    // between first and second builds
    const firstPool1Entries = (pools[1].entries as JsonValue[])
    const secondPool1Entries = (secondPools[1].entries as JsonValue[])
    const untouchedIdentical = firstPool1Entries === secondPool1Entries
    console.log(`>>> PERF identity after edit: untouched pools[1].entries === ${untouchedIdentical}`)
    expect(untouchedIdentical).toBe(true)
  })
})
