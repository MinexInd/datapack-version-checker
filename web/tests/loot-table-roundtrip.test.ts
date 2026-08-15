import 'fake-indexeddb/auto'
import { describe, it, expect, beforeEach } from 'vitest'
import { SpyglassService } from '../src/engine/spyglass-service'
import { clearIdbCache } from '../src/engine/idb-cache'
import { buildFormState, commitEdit } from '../src/components/editors/mcdoc-editor-logic'

const DB = 'test-loot-table-roundtrip-v1'

beforeEach(async () => { await clearIdbCache(DB) })

const PACK = {
  'pack.mcmeta': JSON.stringify({ pack: { pack_format: 48, description: 't' } }),
  'data/demo/functions/test.mcfunction': 'say hi\n',
}

// ── Modern 1.21 fixtures ────────────────────────────────────────────────────

/** (a) Item entry with functions + conditions + random_sequence */
const MODERN_ITEM_ENTRY = JSON.stringify({
  pools: [
    {
      rolls: 1,
      entries: [
        {
          type: 'minecraft:item',
          name: 'minecraft:diamond',
          functions: [
            {
              function: 'minecraft:set_count',
              count: { type: 'minecraft:uniform', min: 1, max: 3 },
            },
          ],
          conditions: [
            {
              condition: 'minecraft:random_chance',
              chance: 0.5,
            },
          ],
        },
      ],
    },
  ],
  random_sequence: 'minecraft:chests/test_chest',
})

/** (b) Alternatives nested inside an entry */
const MODERN_ALTERNATIVES = JSON.stringify({
  pools: [
    {
      rolls: 1,
      entries: [
        {
          type: 'minecraft:alternatives',
          children: [
            {
              type: 'minecraft:item',
              name: 'minecraft:diamond',
              conditions: [
                { condition: 'minecraft:random_chance', chance: 0.1 },
              ],
            },
            {
              type: 'minecraft:item',
              name: 'minecraft:iron_ingot',
            },
          ],
        },
      ],
    },
  ],
  random_sequence: 'minecraft:chests/alternatives_test',
})

/** (c) Sequence with nested entry lists */
const MODERN_SEQUENCE = JSON.stringify({
  pools: [
    {
      rolls: 1,
      entries: [
        {
          type: 'minecraft:sequence',
          children: [
            {
              type: 'minecraft:item',
              name: 'minecraft:emerald',
            },
            {
              type: 'minecraft:item',
              name: 'minecraft:gold_ingot',
            },
          ],
        },
      ],
    },
  ],
  random_sequence: 'minecraft:chests/sequence_test',
})

/** (d) Tag entry */
const MODERN_TAG_ENTRY = JSON.stringify({
  pools: [
    {
      rolls: 1,
      entries: [
        {
          type: 'minecraft:tag',
          name: 'minecraft:coals',
          expand: false,
        },
      ],
    },
  ],
  random_sequence: 'minecraft:chests/tag_test',
})

// ── Tests ───────────────────────────────────────────────────────────────────

describe('loot table roundtrip', () => {
  // ── Resolution ────────────────────────────────────────────────────────────

  it('getSimplifiedRootType returns a struct for modern loot_table at 1.21', async () => {
    const service = new SpyglassService(DB)
    const pack = {
      ...PACK,
      'data/demo/loot_table/chests/test.json': MODERN_ITEM_ENTRY,
    }
    await service.init(pack, '1.21')
    await service.openFile('data/demo/loot_table/chests/test.json', MODERN_ITEM_ENTRY)

    const type = await service.getSimplifiedRootType('data/demo/loot_table/chests/test.json')
    expect(type).not.toBeNull()
    expect(type!.kind).toBe('struct')
    if (type!.kind !== 'struct') return

    const keys = type!.fields.map(f => f.key)
    expect(keys).toContain('pools')
    expect(keys).toContain('random_sequence')

    await service.close()
  }, 120_000)

  // ── Byte-preserving edits ─────────────────────────────────────────────────

  it('changing random_sequence is byte-preserving', async () => {
    const service = new SpyglassService(DB)
    const pack = {
      ...PACK,
      'data/demo/loot_table/chests/test.json': MODERN_ITEM_ENTRY,
    }
    await service.init(pack, '1.21')
    await service.openFile('data/demo/loot_table/chests/test.json', MODERN_ITEM_ENTRY)

    const type = await service.getSimplifiedRootType('data/demo/loot_table/chests/test.json')
    expect(type).not.toBeNull()

    const form = buildFormState(MODERN_ITEM_ENTRY, type)
    expect(form.error).toBeNull()
    const root = form.value as Record<string, any>

    // Change random_sequence
    root.random_sequence = 'minecraft:chests/modified'
    const output = commitEdit(MODERN_ITEM_ENTRY, type, ['random_sequence'], 'minecraft:chests/modified', root)

    // Byte-preserving: replace the new value back and assert equality with original
    const reverted = output.replace('minecraft:chests/modified', 'minecraft:chests/test_chest')
    expect(reverted).toBe(MODERN_ITEM_ENTRY)
    expect(output).toContain('minecraft:chests/modified')
    expect(output).not.toContain('minecraft:chests/test_chest')

    await service.close()
  }, 120_000)

  it('changing pool rolls number is byte-preserving', async () => {
    const service = new SpyglassService(DB)
    const pack = {
      ...PACK,
      'data/demo/loot_table/chests/test.json': MODERN_ITEM_ENTRY,
    }
    await service.init(pack, '1.21')
    await service.openFile('data/demo/loot_table/chests/test.json', MODERN_ITEM_ENTRY)

    const type = await service.getSimplifiedRootType('data/demo/loot_table/chests/test.json')
    expect(type).not.toBeNull()

    const form = buildFormState(MODERN_ITEM_ENTRY, type)
    expect(form.error).toBeNull()
    const root = form.value as Record<string, any>

    // Change rolls from 1 -> 3
    root.pools[0].rolls = 3
    const output = commitEdit(MODERN_ITEM_ENTRY, type, ['pools', 0, 'rolls'], 3, root)

    // Byte-preserving: the only difference is rolls value
    const reverted = output.replace('"rolls":3', '"rolls":1')
    expect(reverted).toBe(MODERN_ITEM_ENTRY)
    expect(output).toContain('"rolls":3')
    expect(output).not.toContain('"rolls":1')

    await service.close()
  }, 120_000)

  it('changing entry name string is byte-preserving', async () => {
    const service = new SpyglassService(DB)
    const pack = {
      ...PACK,
      'data/demo/loot_table/chests/test.json': MODERN_ITEM_ENTRY,
    }
    await service.init(pack, '1.21')
    await service.openFile('data/demo/loot_table/chests/test.json', MODERN_ITEM_ENTRY)

    const type = await service.getSimplifiedRootType('data/demo/loot_table/chests/test.json')
    expect(type).not.toBeNull()

    const form = buildFormState(MODERN_ITEM_ENTRY, type)
    expect(form.error).toBeNull()
    const root = form.value as Record<string, any>

    // Change entry name from diamond -> emerald
    root.pools[0].entries[0].name = 'minecraft:emerald'
    const output = commitEdit(MODERN_ITEM_ENTRY, type, ['pools', 0, 'entries', 0, 'name'], 'minecraft:emerald', root)

    // Byte-preserving
    const reverted = output.replace('minecraft:emerald', 'minecraft:diamond')
    expect(reverted).toBe(MODERN_ITEM_ENTRY)
    expect(output).toContain('minecraft:emerald')
    expect(output).not.toContain('minecraft:diamond')

    await service.close()
  }, 120_000)

  // ── Branch switch ─────────────────────────────────────────────────────────

  it('switching entry type from item to tag carries new discriminator', async () => {
    const service = new SpyglassService(DB)
    const pack = {
      ...PACK,
      'data/demo/loot_table/chests/test.json': MODERN_ITEM_ENTRY,
    }
    await service.init(pack, '1.21')
    await service.openFile('data/demo/loot_table/chests/test.json', MODERN_ITEM_ENTRY)

    const type = await service.getSimplifiedRootType('data/demo/loot_table/chests/test.json')
    expect(type).not.toBeNull()

    const form = buildFormState(MODERN_ITEM_ENTRY, type)
    expect(form.error).toBeNull()
    const root = form.value as Record<string, any>

    // Switch entry type from minecraft:item -> minecraft:tag
    root.pools[0].entries[0].type = 'minecraft:tag'
    const output = commitEdit(MODERN_ITEM_ENTRY, type, ['pools', 0, 'entries', 0, 'type'], 'minecraft:tag', root)

    // The output must carry the new type discriminator
    expect(output).toContain('"minecraft:tag"')
    expect(output).not.toContain('"minecraft:item"')

    // Rest of the document is preserved
    expect(output).toContain('"rolls":1')
    expect(output).toContain('minecraft:chests/test_chest')

    await service.close()
  }, 120_000)

  it('switching loot table type enum carries new value', async () => {
    const service = new SpyglassService(DB)
    const pack = {
      ...PACK,
      'data/demo/loot_table/chests/test.json': MODERN_ITEM_ENTRY,
    }
    await service.init(pack, '1.21')
    await service.openFile('data/demo/loot_table/chests/test.json', MODERN_ITEM_ENTRY)

    const type = await service.getSimplifiedRootType('data/demo/loot_table/chests/test.json')
    expect(type).not.toBeNull()

    const form = buildFormState(MODERN_ITEM_ENTRY, type)
    expect(form.error).toBeNull()
    const root = form.value as Record<string, any>

    // Add the optional type field (not present in original) — falls back to
    // full re-serialization since the path doesn't exist in the source
    root.type = 'minecraft:chest'
    const output = commitEdit(MODERN_ITEM_ENTRY, type, ['type'], 'minecraft:chest', root)

    // Re-serialization produces 2-space indented output with trailing newline
    const parsed = JSON.parse(output)
    expect(parsed.type).toBe('minecraft:chest')
    expect(parsed.pools).toBeDefined()
    expect(parsed.random_sequence).toBe('minecraft:chests/test_chest')
    expect(output.endsWith('\n')).toBe(true)

    await service.close()
  }, 120_000)

  // ── Resolution across fixture variants ────────────────────────────────────

  it('getSimplifiedRootType returns struct for alternatives fixture', async () => {
    const service = new SpyglassService(DB)
    const pack = {
      ...PACK,
      'data/demo/loot_table/chests/alt.json': MODERN_ALTERNATIVES,
    }
    await service.init(pack, '1.21')
    await service.openFile('data/demo/loot_table/chests/alt.json', MODERN_ALTERNATIVES)

    const type = await service.getSimplifiedRootType('data/demo/loot_table/chests/alt.json')
    expect(type).not.toBeNull()
    expect(type!.kind).toBe('struct')

    await service.close()
  }, 120_000)

  it('getSimplifiedRootType returns struct for sequence fixture', async () => {
    const service = new SpyglassService(DB)
    const pack = {
      ...PACK,
      'data/demo/loot_table/chests/seq.json': MODERN_SEQUENCE,
    }
    await service.init(pack, '1.21')
    await service.openFile('data/demo/loot_table/chests/seq.json', MODERN_SEQUENCE)

    const type = await service.getSimplifiedRootType('data/demo/loot_table/chests/seq.json')
    expect(type).not.toBeNull()
    expect(type!.kind).toBe('struct')

    await service.close()
  }, 120_000)

  it('getSimplifiedRootType returns struct for tag entry fixture', async () => {
    const service = new SpyglassService(DB)
    const pack = {
      ...PACK,
      'data/demo/loot_table/chests/tag.json': MODERN_TAG_ENTRY,
    }
    await service.init(pack, '1.21')
    await service.openFile('data/demo/loot_table/chests/tag.json', MODERN_TAG_ENTRY)

    const type = await service.getSimplifiedRootType('data/demo/loot_table/chests/tag.json')
    expect(type).not.toBeNull()
    expect(type!.kind).toBe('struct')

    await service.close()
  }, 120_000)

  // ── Legacy fallback ───────────────────────────────────────────────────────

  it('legacy loot_tables/ path returns null (Monaco fallback — Spyglass only registers loot_table/)', async () => {
    // Spyglass's mcdoc schema only registers the modern "loot_table" (singular)
    // folder name. The legacy "loot_tables" (plural) path is not recognized,
    // so getSimplifiedRootType returns null. The IdePage gate still accepts
    // loot_tables paths so the file opens in Monaco as a raw JSON editor
    // rather than the visual mcdoc form.
    const service = new SpyglassService(DB)
    const LEGACY = JSON.stringify({
      pools: [
        {
          rolls: 1,
          entries: [
            {
              type: 'minecraft:item',
              name: 'minecraft:diamond',
              functions: [
                {
                  function: 'minecraft:set_count',
                  count: 2,
                },
              ],
            },
          ],
        },
      ],
    })
    const pack = {
      ...PACK,
      'data/demo/loot_tables/chests/legacy.json': LEGACY,
    }
    await service.init(pack, '1.21')
    await service.openFile('data/demo/loot_tables/chests/legacy.json', LEGACY)

    const type = await service.getSimplifiedRootType('data/demo/loot_tables/chests/legacy.json')
    expect(type).toBeNull()

    await service.close()
  }, 120_000)
})
