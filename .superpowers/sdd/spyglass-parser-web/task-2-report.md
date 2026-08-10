# Task 2 Report: IndexedDB-backed cache (web.getCache)

Status: DONE
Commit: 3291667 ("add persistent IndexedDB cache for web api fetches")

## What was done

1. **`web/package.json`** — added `fake-indexeddb` ^6.0.0 to devDependencies; ran `npm install` (package-lock.json updated).

2. **`web/tests/idb-cache.test.ts`** (new) — the 3 tests from the brief, verbatim. Written first, run, confirmed FAIL (module not found).

3. **`web/src/engine/idb-cache.ts`** (new) — implements `createIdbCache(dbName)`, `clearIdbCache(dbName)`, and `API_CACHE_DB` constant. Object store `entries` keyed by `url`. `StoredResponse` = `{ body: ArrayBuffer, status, statusText, headers: Record<string,string> }`. `get` returns a fresh `Response` so `.json()`/`.clone()`/`.text()` work.

   Deviation from the brief's sketch: a module-level `connections` Map tracks one open `IDBDatabase` per dbName. `clearIdbCache` closes the connection before `deleteDatabase`, otherwise the delete blocks on the still-open connection and the next `open` hangs (observed: tests 2-3 timed out at 5s/10s with the naive version). `get`/`put` lazily reopen via `getDb` if the connection was closed. This also means multiple `createIdbCache` calls for the same db share one connection.

5. **`web/src/engine/api.ts`** — replaced the in-memory `getCache/setCache/getCachedEtag/setCachedEtag` storage layer with the IndexedDB cache. Kept the ETag revalidation flow (If-None-Match -> 304 -> serve cached; offline fallback to cached copy). Cache key is now the URL (per brief). Removed the now-unused `cacheKey` param from `doFetch` and its callers. Added lazy cache init with a no-op `nullCache` fallback if IndexedDB is unavailable (private mode etc.), so the app still works without IDB. Exported `clearCache()` from api.ts (clears the IDB cache and resets the lazy promise).

6. **`web/src/engine/cache.ts`** — kept (mcdoc-check.ts and technical-changes.ts still use its in-memory `getCache/setCache` for parsed symbol tables / technical-changes data). `clearCache()` is now async and also clears the IndexedDB cache via `clearIdbCache(API_CACHE_DB)`. No callers of `clearCache` exist in web/ (verified by grep), so the signature change is safe.

## Test output

- `npx vitest run tests/idb-cache.test.ts` (before impl): FAIL — "Cannot find module '../src/engine/idb-cache'".
- `npx vitest run tests/idb-cache.test.ts` (after impl): PASS (3).
- `npx tsc --noEmit`: no errors (one fix needed: `new Promise<void>` in clearIdbCache for TS2794).
- `npx vitest run` (full suite): PASS (5) — 3 idb-cache + 2 browser-externals.
- `npx vite build`: success (62 modules, 481 kB bundle).

## Deviations

- `clearIdbCache` closes tracked connections before deleting (see above) — required for the test's beforeEach to work.
- `api.ts` now also exports `clearCache()` (clears IDB); `cache.ts`'s `clearCache` also clears IDB. Both are belt-and-suspenders; neither has callers in web/ yet.
- Committed `web/src/engine/cache.ts` and `web/package-lock.json` in addition to the brief's file list, since they are part of this change.

## Concerns

- The `nullCache` fallback means if `createIdbCache` rejects once (e.g. IDB blocked), the app silently runs uncached for the session. Acceptable degradation.
- `cache.ts`'s `clearCache` becoming async is a signature change; safe today (no callers) but worth noting for future use.
- `web/tsconfig.json` only includes `src`, so the test file is not type-checked by `tsc`; vitest covers it.

---

## Fix report (review findings, commit 2)

Status: DONE
Commit: c98b3ff ("fix idb cache failure handling in web api fetches")

### Finding 1 — nullCache fallback was dead code (idb-cache.ts + api.ts)

`createIdbCache` was async but contained no await/throw; it returned an object whose get/put opened the DB lazily, so `createIdbCache(...).catch(() => nullCache)` could never fire and a failing `indexedDB.open` would reject on the first `cache.get`, breaking every fetch.

Fix: `createIdbCache` now eagerly awaits `getDb(dbName)` before returning, so an unavailable IndexedDB rejects the promise and the `nullCache` fallback in api.ts actually engages. As a second layer, api.ts wraps the per-call storage ops in `safeGet`/`safePut` helpers so a connection that dies after init (e.g. after `clearCache` closed it) degrades to a cache miss / no-op write instead of throwing.

### Finding 2 — storage-write failures propagated into fetch results (api.ts)

The old in-memory `setCache` could not fail; an IDB `put` can (quota, private-mode write errors). Two bad paths:
- Fresh-fetch path: a failed `put` threw and failed a fetch that already succeeded over the network.
- Revalidation-200 path: the `put` sat inside the try, so a write failure was swallowed by the catch and the STALE cached copy was served even though the server returned fresh data.

Fix: both `put` sites now go through `safePut` (try/catch, swallow). The network result always wins; a failed write never falls into the revalidation catch, so no stale serve.

### New tests: web/tests/api-cache.test.ts (4 tests)

fake-indexeddb cannot simulate quota/private-mode failures, so these mock the idb-cache module (`vi.hoisted` + `vi.mock`) and stub global `fetch`:
1. put rejects on fresh fetch -> network data still returned.
2. put rejects during revalidation (cached etag + 200 fresh response) -> FRESH data returned, not stale (regression test for the silent staleness bug).
3. get rejects -> treated as a miss, fresh fetch succeeds.
4. createIdbCache rejects -> nullCache fallback used, fetch succeeds.

### Verification output

- `npx vitest run`: PASS (9) — 3 idb-cache + 2 browser-externals + 4 api-cache.
- `npx tsc --noEmit`: TypeScript: No errors found.
- `npx vite build`: success (62 modules, 481.36 kB).

### Concerns

- The failure-path tests rely on module mocking rather than real IndexedDB behavior; they verify api.ts's handling, not idb-cache.ts's rejection mechanics. The eager-open behavior itself is covered implicitly by test 4 (createIdbCache rejects -> fallback).
- `safeGet`/`safePut` swallow all storage errors silently; the app runs uncached in that session. Acceptable degradation, same tradeoff as before.