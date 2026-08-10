### Task 3: Parser spike — Project on a sample pack

**Files:**
- Create: `web/src/engine/parser-runner.ts` (spike version)
- Create: `web/tests/parser-runner.test.ts`
- Modify: `web/package.json` (add spyglass deps)

**Interfaces:**
- Consumes: `createBrowserExternals` (Task 1), `createIdbCache` (Task 2).
- Produces: `analyzePackWithParser(files: PackFileMap, version: string, cache: CacheLike): Promise<ParserIssue[]>` where `ParserIssue = { file: string; line: number; message: string; severity: 'error' | 'warning' | 'info' | 'hint'; source: string }`. This is the spike — it must prove the parser runs in the browser environment (vitest node env is fine; the code must not import Node builtins).

- [ ] **Step 1: Add spyglass deps**

`web/package.json` dependencies (match CLI versions):
```json
"@spyglassmc/core": "0.4.52",
"@spyglassmc/java-edition": "0.3.65",
"@spyglassmc/mcdoc": "0.3.56",
"@spyglassmc/nbt": "0.3.58",
"@spyglassmc/json": "0.3.56",
"@spyglassmc/mcfunction": "0.2.55",
"@spyglassmc/locales": "0.3.26"
```
Run `cd web && npm install`.

- [ ] **Step 2: Write the failing test**

`web/tests/parser-runner.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { analyzePackWithSpyglass } from '../src/engine/parser-runner'

describe('parser runner spike', () => {
  it('reports an unknown command in a mcfunction', async () => {
    const files = {
      'pack.mcmeta': JSON.stringify({ pack: { pack_format: 48, description: 't' } }),
      'data/demo/functions/hello.mcfunction': 'say hi\n/definitely_not_a_command foo\n',
    }
    const issues = await analyzePackWithSpyglass(files, '1.21')
    const bad = issues.find((i) => i.file.endsWith('hello.mcfunction') && i.message.includes('definitely_not_a_command'))
    expect(bad).toBeTruthy()
  })
})
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd web && npx vitest run tests/parser-runner.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 4: Implement parser-runner.ts (spike)**

```ts
import { Project } from '@spyglassmc/core'
import { getVanillaMcdoc, getVanillaDatapack, getVersions } from '@spyglassmc/java-edition/lib/dependency/index.js'
import { createBrowserExternals, type CacheLike } from './browser-externals'

export interface ParserIssue { file: string; line: number; message: string; severity: string; source: string }

export async function analyzePackWithSpyglass(files: Record<string, string>, targetVersion: string, cache: CacheLike): Promise<ParserIssue[]> {
  const externals = createBrowserExternals(cache)
  const logger = { error: () => {}, warn: () => {}, info: () => {}, debug: () => {} } as any
  const versions = await getVersions(externals, logger)
  const ver = versions.find((v: any) => v.name === targetVersion)
  if (!ver) throw new Error(`version ${targetVersion} not found`)

  // Load vanilla data + mcdoc tarballs (cached by the browser externals)
  const datapack = await getVanillaDatapack(externals, logger, targetVersion)
  const mcdoc = await getVanillaMcdoc(externals, logger)

  const project = new Project({
    cacheRoot: 'file:///cache',
    externals,
    projectRoots: ['file:///pack'],
    dependencies: [datapack, mcdoc],
  })
  await project.init()
  await project.ready()

  const issues: ParserIssue[] = []
  for (const [path, content] of Object.entries(files)) {
    const uri = `file:///pack/${path}`
    const lang = path.endsWith('.mcfunction') ? 'mcfunction' : path.endsWith('.json') ? 'json' : path.endsWith('.nbt') ? 'nbt' : path.endsWith('.snbt') ? 'snbt' : 'mcfunction'
    const doc = await project.onDidOpen(uri, lang, 1, content)
    // Collect errors from the document node — read Project.d.ts / FileNode.d.ts
    // for the exact accessor (e.g. FileNode.getErrors(node) or doc.node.parserErrors).
    // Map each LanguageError { message, severity, range } into ParserIssue.
  }
  return issues
}
```

**IMPORTANT — verify against the real API before finalizing:** read `node_modules/@spyglassmc/core/lib/service/Project.d.ts` and `node_modules/@spyglassmc/core/lib/node/FileNode.d.ts` for: (a) the exact `ProjectOptions` fields (`dependencies` vs `initializers` — check how tarball deps are passed; the explorer found `ready()` loads deps via `ArchiveUriSupporter`), (b) how to get errors off a document after `onDidOpen` (event `documentUpdated` vs return value — check `Project.js` around lines 433-497), (c) the `LanguageError` shape (`range` vs `posRange`). Adapt the spike to the real API. The test must pass with the real parser — that is the spike gate.

- [ ] **Step 5: Run test to verify it passes**

Run: `cd web && npx vitest run tests/parser-runner.test.ts`
Expected: PASS — the unknown command is reported.

**Spike gate:** if the parser cannot run in the browser environment (bundling errors, Node builtins leaking in, tarball decompression failing), STOP and report — do not proceed to Task 4. The fallback is: keep the custom engine, ship only the IndexedDB cache (Task 2) as the deliverable.

- [ ] **Step 6: Commit**

```bash
git add web/package.json web/package-lock.json web/src/engine/parser-runner.ts web/tests/parser-runner.test.ts
git commit -m "spike: run spyglass parser in browser env"
```

---
