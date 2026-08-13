import 'fake-indexeddb/auto'
import { describe, it, expect, beforeEach } from 'vitest'
import { SpyglassService } from '../src/engine/spyglass-service'
import { clearIdbCache } from '../src/engine/idb-cache'
import { buildFormState, commitEdit } from '../src/components/editors/mcdoc-editor-logic'

const DB = 'test-editor-roundtrip-v2'

beforeEach(async () => { await clearIdbCache(DB) })

const PACK = {
  'pack.mcmeta': JSON.stringify({ pack: { pack_format: 48, description: 't' } }),
  'data/demo/functions/test.mcfunction': 'say hi\n',
}

const RECIPE_CONTENT = JSON.stringify({
  type: 'minecraft:crafting_shaped',
  pattern: ['###'],
  key: { '#': { item: 'minecraft:iron_ingot' } },
  result: { item: 'minecraft:iron_block', count: 1 },
})

describe('editor roundtrip (visual editor write-back pipeline)', () => {
  it('existing-node edit is byte-preserving', async () => {
    const service = new SpyglassService(DB)
    const pack = {
      ...PACK,
      'data/demo/recipe/test.json': RECIPE_CONTENT,
    }
    await service.init(pack, '1.21')
    await service.openFile('data/demo/recipe/test.json', RECIPE_CONTENT)

    const type = await service.getSimplifiedRootType('data/demo/recipe/test.json')
    expect(type).not.toBeNull()

    const form = buildFormState(RECIPE_CONTENT, type)
    expect(form.error).toBeNull()
    const root = form.value as Record<string, any>

    // Change result.count from 1 -> 2
    root.result.count = 2
    const output = commitEdit(RECIPE_CONTENT, type, ['result', 'count'], 2, root)

    // Byte-preserving: the only difference is the one changed value.
    // Replace "count":2 back to "count":1 in the output; it must equal the original.
    const reverted = output.replace('"count":2', '"count":1')
    expect(reverted).toBe(RECIPE_CONTENT)
    // And the output itself must contain the new value.
    expect(output).toContain('"count":2')
    expect(output).not.toContain('"count":1')

    await service.close()
  }, 120_000)

  it('adding a missing optional field falls back to full re-serialization', async () => {
    const service = new SpyglassService(DB)
    const pack = {
      ...PACK,
      'data/demo/recipe/test.json': RECIPE_CONTENT,
    }
    await service.init(pack, '1.21')
    await service.openFile('data/demo/recipe/test.json', RECIPE_CONTENT)

    const type = await service.getSimplifiedRootType('data/demo/recipe/test.json')
    expect(type).not.toBeNull()

    const form = buildFormState(RECIPE_CONTENT, type)
    expect(form.error).toBeNull()
    const root = form.value as Record<string, any>

    // Add the optional "group" field
    root.group = 'iron'
    const output = commitEdit(RECIPE_CONTENT, type, ['group'], 'iron', root)

    // The path ['group'] does not exist in the original, so writeBack falls
    // back to serializeJson(newRoot) — full pretty-printed re-serialization.
    const parsed = JSON.parse(output)
    expect(parsed.group).toBe('iron')
    expect(parsed.type).toBe('minecraft:crafting_shaped')
    expect(parsed.pattern).toEqual(['###'])
    expect(parsed.key).toEqual({ '#': { item: 'minecraft:iron_ingot' } })
    expect(parsed.result).toEqual({ item: 'minecraft:iron_block', count: 1 })

    // Re-serialization produces 2-space indented output with trailing newline.
    expect(output.endsWith('\n')).toBe(true)

    await service.close()
  }, 120_000)

  it('map edit (recipe key) is byte-preserving', async () => {
    const service = new SpyglassService(DB)
    const pack = {
      ...PACK,
      'data/demo/recipe/test.json': RECIPE_CONTENT,
    }
    await service.init(pack, '1.21')
    await service.openFile('data/demo/recipe/test.json', RECIPE_CONTENT)

    const type = await service.getSimplifiedRootType('data/demo/recipe/test.json')
    expect(type).not.toBeNull()

    const form = buildFormState(RECIPE_CONTENT, type)
    expect(form.error).toBeNull()
    const root = form.value as Record<string, any>

    // Change key['#'].item from iron_ingot -> gold_ingot
    root.key['#'].item = 'minecraft:gold_ingot'
    const output = commitEdit(RECIPE_CONTENT, type, ['key', '#', 'item'], 'minecraft:gold_ingot', root)

    // Byte-preserving: replace the changed value back to verify equality.
    const reverted = output.replace('minecraft:gold_ingot', 'minecraft:iron_ingot')
    expect(reverted).toBe(RECIPE_CONTENT)
    expect(output).toContain('minecraft:gold_ingot')
    expect(output).not.toContain('minecraft:iron_ingot')

    await service.close()
  }, 120_000)

  it('buildFormState returns error for invalid JSON', async () => {
    const service = new SpyglassService(DB)
    await service.init(PACK, '1.21')

    const type = await service.getSimplifiedRootType('data/demo/functions/never.json')
    const form = buildFormState('{ not json', type)
    expect(form.error).not.toBeNull()
    expect(form.value).toBeNull()

    await service.close()
  }, 120_000)

  it('getSimplifiedRootType returns null for unknown file types', async () => {
    const service = new SpyglassService(DB)
    const pack = {
      ...PACK,
      'data/demo/functions/test.function': 'say hi',
    }
    await service.init(pack, '1.21')
    await service.openFile('data/demo/functions/test.function', 'say hi')

    const type = await service.getSimplifiedRootType('data/demo/functions/test.function')
    expect(type).toBeNull()

    await service.close()
  }, 120_000)
})
