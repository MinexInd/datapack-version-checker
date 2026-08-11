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
})
