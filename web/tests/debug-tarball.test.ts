// Temporary: does including @vanilla-datapack unlock item completions after "/give @s "?
import 'fake-indexeddb/auto'
import { it } from 'vitest'
import { SpyglassService } from '../src/engine/spyglass-service'
import { clearIdbCache } from '../src/engine/idb-cache'

const DB = 'debug-tarball'

it('dumps completions with datapack tarball included', async () => {
  await clearIdbCache(DB)
  const PACK = {
    'pack.mcmeta': JSON.stringify({ pack: { pack_format: 48, description: 't' } }),
    'data/demo/functions/test.mcfunction': '/give @s diamond 1\n',
  }
  const service = new SpyglassService(DB)
  await service.init(PACK, '1.21')
  await service.openFile('data/demo/functions/test.mcfunction', PACK['data/demo/functions/test.mcfunction'])

  const content = PACK['data/demo/functions/test.mcfunction']
  const off = content.indexOf('@s ') + 3
  const items = await service.getCompletions('data/demo/functions/test.mcfunction', off)
  console.log(`AFTER "@s " (offset ${off}): ${items.length} items`)
  for (const c of items.slice(0, 12)) {
    console.log(' -', JSON.stringify({ label: c.label, kind: c.kind, detail: c.detail, range: c.range }))
  }
  await service.close()
}, 120_000)

