### Task 2: IndexedDB-backed cache (web.getCache)

**Files:**
- Create: `web/src/engine/idb-cache.ts`
- Create: `web/tests/idb-cache.test.ts`
- Modify: `web/src/engine/api.ts` (route existing fetches through the cache)

**Interfaces:**
- Consumes: nothing new.
- Produces: `createIdbCache(dbName: string): Promise<CacheLike>` where `CacheLike` is from Task 1 (`get(url) → Response|null`, `put(url, response) → void`), plus `clearIdbCache(dbName: string): Promise<void>`. Responses are stored as `{ body: ArrayBuffer, status, headers: Record<string,string> }` in an IndexedDB object store keyed by URL; `get` returns a fresh `Response` (so `response.clone()`/`response.json()` work).

- [ ] **Step 1: Write the failing test**

`web/tests/idb-cache.test.ts` (use `fake-indexeddb` dev dep — add to `web/package.json` devDependencies):

```ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web && npx vitest run tests/idb-cache.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement idb-cache.ts**

```ts
export interface CacheLike {
  get(url: string): Promise<Response | null>
  put(url: string, response: Response): Promise<void>
}

interface StoredResponse { body: ArrayBuffer; status: number; statusText: string; headers: Record<string, string> }

export async function createIdbCache(dbName: string): Promise<CacheLike> {
  const db = await openDb(dbName)
  return {
    async get(url) {
      const stored = await getEntry(db, url)
      if (!stored) return null
      return new Response(stored.body, { status: stored.status, statusText: stored.statusText, headers: stored.headers })
    },
    async put(url, response) {
      const body = await response.clone().arrayBuffer()
      const headers: Record<string, string> = {}
      response.headers.forEach((v, k) => { headers[k] = v })
      await putEntry(db, url, { body, status: response.status, statusText: response.statusText, headers })
    },
  }
}
```

Implement `openDb` (object store `entries`, keyPath `url`), `getEntry`, `putEntry`, `clearIdbCache` (deleteDatabase). Use `fake-indexeddb` in tests; real IndexedDB in the browser.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd web && npx vitest run tests/idb-cache.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Wire api.ts through the cache**

Modify `web/src/engine/api.ts`: replace the in-memory `getCache/setCache` calls with the IndexedDB cache. Keep the ETag revalidation flow (If-None-Match → 304 → serve cached). The cache key stays the URL. Keep the existing `doFetch` structure; only the storage layer changes. Also keep `clearCache()` exported (now clears IndexedDB).

- [ ] **Step 6: Run web build + tests**

Run: `cd web && npx tsc --noEmit && npx vitest run`
Expected: PASS, no type errors.

- [ ] **Step 7: Commit**

```bash
git add web/package.json web/src/engine/idb-cache.ts web/src/engine/api.ts web/tests/idb-cache.test.ts
git commit -m "add persistent IndexedDB cache for web api fetches"
```

---
