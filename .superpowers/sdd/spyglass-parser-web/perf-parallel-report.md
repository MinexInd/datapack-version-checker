# Performance: Concurrent Parser Lane + Parallel Per-Version Parsing

## Commit
- `741810f` — run parser lane concurrently with custom checks, parallelize per-version parsing

## What Changed

### engine.ts — Parser lane runs concurrently with custom checks
The parser lane (`analyzePackWithSpyglass`) was blocking: it ran to completion before the per-version custom loop started. Now the parser starts as a fire-and-forget promise (`parserPromise`), and the custom per-version loop (`checkOneVersion`) runs immediately. Parser results are awaited only at the merge point inside `checkOneVersion` via a memoized `getParserResults()` resolver — awaiting an already-resolved promise is cheap, and the result is cached after first resolution.

Key details:
- `parserLaneFailed` flag still works: set in the parser promise's catch block.
- `parserActive: !parserLaneFailed && parserResults.has(ver.name)` semantics preserved.
- `onProgress` messages from both lanes may interleave — acceptable.
- Try/catch semantics fully preserved: parser failure yields empty Map, custom checks still run.

### parser-runner.ts — Bounded-concurrency parallel parsing
`analyzePackWithSpyglass` previously parsed versions sequentially: `for (const ver of versions) { await runParserForVersion(...) }`. Each version creates a full Spyglass Project (init/ready/close), which is the dominant cost.

Now uses a bounded-concurrency pool (limit 3): processes versions in batches of 3 via `Promise.all()`, then moves to the next batch. Per-version try/catch preserved — one version failing does not kill the batch.

Note: the shared IDB cache (`effectiveCache`) has a known benign TOCTOU race on first open (deferred Minor from an earlier review). Concurrent first-time opens may leak one untracked connection; it only affects `clearIdbCache`'s `deleteDatabase`, not analysis correctness. Not fixed in this task per instructions.

## Test Results

```
PASS (14) FAIL (0)   — vitest (web/)
TypeScript: No errors found  — tsc --noEmit
```

All 14 existing tests pass, including `engine-parser.test.ts` which exercises the parser lane end-to-end. No new test was added because the existing suite already covers `analyzePackWithSpyglass` with multi-version inputs, and the concurrency change is internal (output is identical, just faster).

## Concerns
None. The concurrency limit of 3 is conservative enough to avoid memory pressure in the browser. The memoized parser result ensures the promise is only resolved once regardless of how many versions call `getParserResults()`.

---

# Performance: Parallel Custom Version Loop + Parser Result Caching

## Commit
- `71103fa` — parallelize custom version loop, cache parser results per pack hash

## What Changed

### engine.ts — Custom version loop parallelized (concurrency 4)
The `checkOneVersion` loop was already batched at `BATCH_SIZE = 3` (from commit 741810f). Increased to `BATCH_SIZE = 4` since these operations are I/O-bound (fetchCommandTree + fetchRegistries are network calls, independent per version). The memoized `getParserResults()` resolver works correctly under parallelism — multiple versions awaiting the same resolved promise is cheap and safe.

### parser-runner.ts — Parser results cached per (packHash, version)
Added persistent IndexedDB caching so repeat analyses of the same pack are instant:

1. **`hashPack(files)`** — Deterministic, order-independent djb2 hash of sorted file entries. Exported for testability.

2. **IDB result cache** — Uses `createIdbCache('parser-result-cache')` from the existing idb-cache module. Cache key: `parser:${packHash}:${ver.name}`. On cache hit, the entire Spyglass Project creation is skipped for that version.

3. **Early exit for empty packs** — If the pack has no `.mcfunction`/`.json`/`.nbt`/`.snbt` files, returns an empty Map immediately without creating any Project.

4. **Graceful degradation** — IDB unavailable (private mode) proceeds without caching. Cache write failures are swallowed (`.catch(() => {})`). Cache read failures fall through to parse.

### Tests — 4 new hashPack tests
Added to `parser-runner.test.ts`:
- Deterministic (same input → same output)
- Order-independent (file insertion order doesn't matter)
- Content-sensitive (changing file content changes hash)
- Additive sensitivity (adding a file changes hash)

## Test Results

```
PASS (18) FAIL (0)   — vitest (web/)
TypeScript: No errors found  — tsc --noEmit
```

All 14 original tests pass (including `engine-parser.test.ts` end-to-end). 4 new `hashPack` tests pass.

## Concerns
None. The IDB cache gracefully degrades when unavailable. The TOCTOU race on first open (from earlier review) applies to the new `parser-result-cache` DB as well — same benign behavior, same deferral.
