import 'fake-indexeddb/auto'
import { describe, it, expect, beforeEach } from 'vitest'
import { createIdbCache, clearIdbCache } from '../src/engine/idb-cache'

beforeEach(async () => { await clearIdbCache('test-db') })

describe('idb cache', () => {
  it('round-trips a response', async () => {
    const cache = await createIdbCache('test-db')
    const resp = new Response(JSON.stringify({ a: 1 }), { status: 200, headers: { 'content-type': 'application/json', etag: '"abc"' } })
    await cache.put('https://x/1', resp)
    const got = await cache.get('https://x/1')
    expect(got).not.toBeNull()
    expect(got!.status).toBe(200)
    expect(got!.headers.get('etag')).toBe('"abc"')
    expect(await got!.json()).toEqual({ a: 1 })
  })

  it('returns null for a miss', async () => {
    const cache = await createIdbCache('test-db')
    expect(await cache.get('https://x/miss')).toBeNull()
  })

  it('survives a fresh cache instance (persistence)', async () => {
    const c1 = await createIdbCache('test-db')
    await c1.put('https://x/p', new Response('body', { status: 200 }))
    const c2 = await createIdbCache('test-db')
    const got = await c2.get('https://x/p')
    expect(await got!.text()).toBe('body')
  })
})