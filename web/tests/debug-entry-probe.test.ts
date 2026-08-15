import 'fake-indexeddb/auto'
import { describe, it, expect } from 'vitest'
import { SpyglassService } from '../src/engine/spyglass-service'
import { clearIdbCache } from '../src/engine/idb-cache'
import type { SimplifiedMcdocType } from '../src/ide/mcdoc-edit'

const DB = 'test-entry-probe-v6'
const PACK = {
  'pack.mcmeta': JSON.stringify({ pack: { pack_format: 48, description: 't' } }),
  'data/demo/functions/test.mcfunction': 'say hi\n',
}
const ITEM_ENTRY = JSON.stringify({
  pools: [{ rolls: 1, entries: [{ type: 'minecraft:item', name: 'minecraft:diamond', weight: 3 }] }],
  random_sequence: 'minecraft:chests/test',
})

function dump(t: any, depth = 0, max = 6): string {
  const indent = '  '.repeat(depth)
  if (!t || typeof t !== 'object') return indent + JSON.stringify(t)
  if (t.kind === 'struct') return `${indent}struct{\n${(t.fields ?? []).map((f: any) => `${indent}  ${f.key}${f.required === false ? '?' : ''}: ${dump(f.type, depth + 2, max)}`).join('\n')}\n${indent}}`
  if (t.kind === 'union') return `${indent}union[\n${(t.options ?? t.members ?? []).map((o: any) => dump(o, depth + 1, max)).join('\n')}\n${indent}]`
  if (t.kind === 'list') return `${indent}list<${dump(t.item, depth + 1, max)}>`
  if (t.kind === 'map') return `${indent}map<v:${dump(t.value, depth + 1, max)}>`
  if (t.kind === 'enum') return `${indent}enum<${(t.values ?? []).join(',')}>`
  if (t.kind === 'primitive') return `${indent}prim<${t.name}${t.registry ? ':' + t.registry : ''}>`
  if (t.kind === 'literal') return `${indent}lit(${t.value})`
  return `${indent}${t.kind}`
}

describe('entry probe', () => {
  it('trace entries type', async () => {
    await clearIdbCache(DB)
    const service = new SpyglassService(DB)
    await service.init({ ...PACK, 'data/demo/loot_table/chests/test.json': ITEM_ENTRY }, '1.21')
    await service.openFile('data/demo/loot_table/chests/test.json', ITEM_ENTRY)
    const root = await service.getSimplifiedRootType('data/demo/loot_table/chests/test.json')

    if (root?.kind === 'struct') {
      const pools = root.fields.find(f => f.key === 'pools')
      if (pools?.type.kind === 'list' && pools.type.item.kind === 'struct') {
        const poolFields = pools.type.item.fields.map(f => f.key).join(', ')
        console.error('POOL FIELDS:', poolFields)

        const entries = pools.type.item.fields.find(f => f.key === 'entries')
        if (entries?.type.kind === 'list') {
          const ei = entries.type.item
          console.error('ENTRY ITEM KIND:', ei.kind)
          console.error('ENTRY ITEM:', dump(ei))

          if (ei.kind === 'struct') {
            console.error('ENTRY STRUCT KEYS:', ei.fields.map((f: any) => `${f.key}:${f.type.kind}`).join(', '))
          }
        }
      }
    }

    expect(root).not.toBeNull()
    await service.close()
  }, 120_000)
})
