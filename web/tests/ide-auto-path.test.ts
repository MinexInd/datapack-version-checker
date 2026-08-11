import 'fake-indexeddb/auto'
import { describe, it, expect } from 'vitest'
import { SpyglassService } from '../src/engine/spyglass-service'
import { clearIdbCache } from '../src/engine/idb-cache'

describe('IDE Auto-version path (browser equivalent)', () => {
  it('init with Auto version works', async () => {
    await clearIdbCache('test-auto-db')
    const PACK = {
      'pack.mcmeta': JSON.stringify({ pack: { pack_format: 48, description: 't' } }),
      'data/demo/functions/test.mcfunction': 'say hi\n',
    }
    const service = new SpyglassService('test-auto-db')
    const t0 = Date.now()
    await service.init(PACK, 'Auto')
    console.log('AUTO INIT OK in', Date.now() - t0, 'ms — ready:', service.ready)
    await service.openFile('data/demo/functions/test.mcfunction', 'say hi\n')
    const markers = await service.getMarkers('data/demo/functions/test.mcfunction')
    const tokens = await service.getSemanticTokens('data/demo/functions/test.mcfunction')
    console.log('markers:', markers.length, 'tokens:', tokens.length)
    expect(service.ready).toBe(true)
    expect(tokens.length).toBeGreaterThan(0)
    await service.close()
  }, 180_000)
})
