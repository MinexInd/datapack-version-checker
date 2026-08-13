import 'fake-indexeddb/auto'
import { describe, it, expect, beforeEach } from 'vitest'
import { SpyglassService } from '../src/engine/spyglass-service'
import { clearIdbCache } from '../src/engine/idb-cache'

const DB = 'test-spyglass-service'

beforeEach(async () => { await clearIdbCache(DB) })

const PACK = {
  'pack.mcmeta': JSON.stringify({ pack: { pack_format: 48, description: 't' } }),
  'data/demo/functions/test.mcfunction': 'say hi\neffect give @s speed 10 300\n',
}

describe('spyglass service (IDE lane)', () => {
  it('init -> ready -> openFile exposes markers, tokens and completions', async () => {
    const service = new SpyglassService(DB)
    await service.init(PACK, '1.21')
    expect(service.ready).toBe(true)

    // Mirror IdePage: open the active file, then read features.
    await service.openFile('data/demo/functions/test.mcfunction', PACK['data/demo/functions/test.mcfunction'])

    // Markers: bad amplifier (300 > 255) must surface as an error.
    const markers = await service.getMarkers('data/demo/functions/test.mcfunction')
    expect(markers.length).toBeGreaterThan(0)
    expect(markers.some(m => m.severity === 'error')).toBe(true)

    // Semantic tokens: say/effect/numbers must produce color tokens.
    const tokens = await service.getSemanticTokens('data/demo/functions/test.mcfunction')
    expect(tokens.length).toBeGreaterThan(0)

    // Completions: after "say " the service must suggest something.
    const offset = 'say '.length
    const completions = await service.getCompletions('data/demo/functions/test.mcfunction', offset)
    expect(Array.isArray(completions)).toBe(true)

    // Updating content must re-parse: fix the amplifier, markers clear.
    await service.updateFile('data/demo/functions/test.mcfunction', 'say hi\neffect give @s speed 10 5\n')
    const fixed = await service.getMarkers('data/demo/functions/test.mcfunction')
    expect(fixed.some(m => m.message.includes('255'))).toBe(false)

    await service.close()
  }, 120_000)

  it('getFile returns undefined before any openFile (silent-empty guard)', async () => {
    const service = new SpyglassService(DB)
    await service.init(PACK, '1.21')
    expect(service.getFile('data/demo/functions/never.function')).toBeUndefined()
    await service.close()
  }, 120_000)

  it('getSimplifiedRootType resolves the recipe schema for a recipe file', async () => {
    const service = new SpyglassService(DB)
    const pack = {
      ...PACK,
      'data/demo/recipe/test.json': JSON.stringify({
        type: 'minecraft:crafting_shaped',
        pattern: ['###'],
        key: { '#': { item: 'minecraft:iron_ingot' } },
        result: { item: 'minecraft:iron_block', count: 1 },
      }),
    }
    await service.init(pack, '1.21')
    await service.openFile('data/demo/recipe/test.json', pack['data/demo/recipe/test.json'])

    const type = await service.getSimplifiedRootType('data/demo/recipe/test.json')
    expect(type).not.toBeNull()
    expect(type!.kind).toBe('struct')
    if (type!.kind !== 'struct') return
    const keys = type!.fields.map(f => f.key)
    expect(keys).toContain('type')
    expect(keys).toContain('pattern')
    expect(keys).toContain('result')
    // The recipe "key" map must survive as a map-typed field, and its value
    // (Ingredient — a union of struct/list) must convert to options, not
    // degrade to 'unknown'.
    const keyField = type!.fields.find(f => f.key === 'key' || f.type.kind === 'map')
    expect(keyField).toBeDefined()
    expect(keyField!.type.kind).toBe('map')
    if (keyField!.type.kind !== 'map') return
    expect(keyField!.type.value.kind).toBe('union')
    if (keyField!.type.value.kind !== 'union') return
    expect(keyField!.type.value.options.length).toBeGreaterThanOrEqual(2)

    // The "result" field is a union of ItemResult (until 1.20.5) and
    // ItemStackTemplate (since 1.20.5) — both must convert to struct options
    // with their fields intact.
    const resultField = type!.fields.find(f => f.key === 'result')
    expect(resultField).toBeDefined()
    expect(resultField!.type.kind).toBe('union')
    if (resultField!.type.kind !== 'union') return
    expect(resultField!.type.options.map(o => o.kind)).toEqual(['struct', 'struct'])
    const itemStack = resultField!.type.options[1]
    if (itemStack.kind !== 'struct') return
    expect(itemStack.fields.map(f => f.key)).toContain('id')
    expect(itemStack.fields.map(f => f.key)).toContain('count')

    await service.close()
  }, 120_000)

  it('getSimplifiedRootType returns null for files without type info', async () => {
    const service = new SpyglassService(DB)
    await service.init(PACK, '1.21')
    expect(await service.getSimplifiedRootType('data/demo/functions/never.function')).toBeNull()
    await service.close()
  }, 120_000)
})
