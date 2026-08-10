### Task 1: Add spyglass packages + browser Externals (fs/error/archive)

**Files:**
- Modify: `web/package.json` (dependencies)
- Create: `web/src/engine/browser-externals.ts`
- Create: `web/tests/browser-externals.test.ts`
- Test: `web/tests/browser-externals.test.ts`

**Interfaces:**
- Consumes: nothing (first task).
- Produces: `createBrowserExternals(cache: CacheLike): Externals` where `Externals` is `@spyglassmc/core`'s type: `{ archive: { decompressBall(buffer: Uint8Array<ArrayBuffer>, options?: { stripLevel?: number }): Promise<DecompressedFile[]> }, error: { createKind(kind, message), isKind(e, kind) }, fs: ExternalFileSystem, web: { getCache(): Promise<CacheLike> } }`. `DecompressedFile = { data: Uint8Array<ArrayBuffer>, mode: number, mtime: string, path: string, type: string }`. `CacheLike` is defined in Task 2; for this task use a minimal `{ match(url): Promise<Response|null>, put(url, resp): Promise<void> }` stub.

- [ ] **Step 1: Write the failing test**

`web/tests/browser-externals.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { createBrowserExternals } from '../src/engine/browser-externals'

describe('browser externals', () => {
  it('decompresses a gzipped tar into DecompressedFile entries', async () => {
    // Build a tiny tar.gz in-memory: one file "data/foo.txt" with content "hi"
    // Use the same tar+gunzip helpers the web app already has in
    // web/src/engine/mcdoc-check.ts (lines ~94-126) — extract them into a
    // shared module `web/src/engine/tar.ts` (export gunzipBytes + parseTar)
    // and reuse here to CREATE the fixture, then decompressBall must round-trip.
    const { createTarGzFixture } = await import('./fixtures/tar-fixture')
    const ext = createBrowserExternals({ get: async () => null, put: async () => {} } as any)
    const files = await ext.archive.decompressBall(await createTarGzFixture(), { stripLevel: 0 })
    expect(files.length).toBe(1)
    expect(files[0].path).toBe('data/foo.txt')
    expect(new TextDecoder().decode(files[0].data)).toBe('hi')
  })

  it('error helpers mirror NodeJsExternals behavior', () => {
    const ext = createBrowserExternals({ get: async () => null, put: async () => {} } as any)
    const err = ext.error.createKind('network', 'boom')
    expect(ext.error.isKind(err, 'network')).toBe(true)
    expect(ext.error.isKind(err, 'other')).toBe(false)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web && npx vitest run tests/browser-externals.test.ts`
Expected: FAIL — `browser-externals` module not found.

- [ ] **Step 3: Extract tar helpers + write browser externals**

1. In `web/src/engine/mcdoc-check.ts` find the existing gzip+tar parsing (lines ~94-126, uses `DecompressionStream('gzip')` + manual tar header parsing). Extract that logic into `web/src/engine/tar.ts` exporting `gunzipBytes(bytes: Uint8Array): Promise<Uint8Array>` and `parseTar(bytes: Uint8Array): Array<{ path: string; data: Uint8Array }>`. Update `mcdoc-check.ts` to import from `./tar` (behavior identical).
2. Create `web/src/engine/browser-externals.ts`:

```ts
import type { Externals, DecompressedFile } from '@spyglassmc/core'
import { gunzipBytes, parseTar } from './tar'

export interface CacheLike {
  get(url: string): Promise<Response | null>
  put(url: string, response: Response): Promise<void>
}

export function createBrowserExternals(cache: CacheLike): Externals {
  return {
    archive: {
      async decompressBall(buffer, options) {
        const gz = await gunzipBytes(buffer)
        const entries = parseTar(gz)
        const strip = options?.stripLevel ?? 0
        return entries.map((e) => ({
          data: e.data,
          mode: 0o644,
          mtime: '1970-01-01T00:00:00.000Z',
          path: e.path.split('/').slice(strip).join('/'),
          type: 'file',
        }))
      },
    },
    error: {
      createKind(kind, message) {
        const err = new Error(message) as Error & { kind?: string }
        err.kind = kind
        return err
      },
      isKind(e, kind) {
        return typeof e === 'object' && e !== null && (e as any).kind === kind
      },
    },
    fs: {
      // In-memory FS: the Project reads pack files + vanilla tarball entries
      // through this. Implement with a Map<string, Uint8Array>; all methods
      // return sensible browser equivalents (readFile from map, stat with
      // mode 0o644, readdir from keys, writeFile/mkdir/rm/unlink/chmod no-op
      // or map ops, showFile no-op).
      async readFile(location) { /* ... */ },
      async stat() { return { mode: 0o644, mtimeMs: 0, isFile: () => true, isDirectory: () => false } as any },
      async readdir() { return [] },
      async writeFile() {},
      async mkdir() {},
      async rm() {},
      async unlink() {},
      async chmod() {},
      async showFile() {},
    },
    web: {
      getCache: () => Promise.resolve(cache),
    },
  }
}
```

Note: check `@spyglassmc/core/lib/common/externals/index.d.ts` for the exact `ExternalErrorKind` union and `ExternalFileSystem` method signatures; adapt the stub to match exactly (the `fs` methods must satisfy the interface — read the .d.ts and implement every member).

- [ ] **Step 4: Run test to verify it passes**

Run: `cd web && npx vitest run tests/browser-externals.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add web/package.json web/src/engine/browser-externals.ts web/src/engine/tar.ts web/src/engine/mcdoc-check.ts web/tests/browser-externals.test.ts web/tests/tar-fixture.ts
git commit -m "add browser externals for spyglass parser"
```

---
