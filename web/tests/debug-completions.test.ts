// Debug: mirror the browser completion path exactly and dump raw results.
// Run with: npx vitest run tests/debug-completions.test.ts (temporary)
import 'fake-indexeddb/auto'
import { it } from 'vitest'
import { SpyglassService } from '../src/engine/spyglass-service'
import { clearIdbCache } from '../src/engine/idb-cache'

const DB = 'debug-completions'

it('dumps completions for /give', async () => {
  await clearIdbCache(DB)
  const PACK = {
    'pack.mcmeta': JSON.stringify({ pack: { pack_format: 48, description: 't' } }),
    'data/demo/functions/test.mcfunction': '/give @s diamond 1\n',
  }
  const service = new SpyglassService(DB)
  await service.init(PACK, '1.21')
  await service.openFile('data/demo/functions/test.mcfunction', PACK['data/demo/functions/test.mcfunction'])

  // Offset 1: right after '/'
  const afterSlash = await service.getCompletions('data/demo/functions/test.mcfunction', 1)
  console.log('=== AFTER "/" (offset 1):', afterSlash.length, 'items')
  for (const c of afterSlash.slice(0, 15)) {
    console.log(' -', JSON.stringify({ label: c.label, kind: c.kind, detail: c.detail, range: c.range }))
  }

  // Offset 10: after "/give @s "
  const content = PACK['data/demo/functions/test.mcfunction']
  const off10 = content.indexOf('@s ') + 3
  const afterAtS = await service.getCompletions('data/demo/functions/test.mcfunction', off10)
  console.log('=== AFTER "@s " (offset', off10, '):', afterAtS.length, 'items')
  for (const c of afterAtS.slice(0, 15)) {
    console.log(' -', JSON.stringify({ label: c.label, kind: c.kind, detail: c.detail, range: c.range }))
  }

  // With trigger character '/'
  const withTrigger = await service.getCompletions('data/demo/functions/test.mcfunction', 1, '/')
  console.log('=== AFTER "/" with triggerChar="/":', withTrigger.length, 'items')

  await service.close()
}, 120_000)

