### Task 5: Engine wiring — parser lane in checkCompatibilityContentBased

**Files:**
- Modify: `web/src/engine/engine.ts` (the `checkCompatibilityContentBased` function, around lines 480-680)
- Modify: `web/src/engine/parser-runner.ts` (finalize: accept `allVersions`/`targetVersions` like the custom engine, return per-version issues)
- Create: `web/tests/engine-parser.test.ts`

**Interfaces:**
- Consumes: `analyzePackWithSpyglass` (Task 3), `mapParserIssues` (Task 4).
- Produces: nothing new — the existing `VersionCompatibility` results gain parser issues merged into `mcfunction_issues`, `structural_issues`, `registry_issues`, `reference_issues`.

- [ ] **Step 1: Write the failing test**

`web/tests/engine-parser.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { checkCompatibilityContentBased } from '../src/engine/engine'

describe('engine with parser lane', () => {
  it('reports parser errors alongside custom checks', async () => {
    const files = {
      'pack.mcmeta': JSON.stringify({ pack: { pack_format: 48, description: 't' } }),
      'data/demo/functions/bad.mcfunction': 'say hi\n/not_a_real_command x\n',
    }
    const result = await checkCompatibilityContentBased(files, ['1.21'])
    const ver = result.versions.find((v) => v.version.name === '1.21')
    expect(ver).toBeTruthy()
    const hasParserError = ver!.mcfunction_issues.some((i) => i.issue.includes('not_a_real_command'))
    expect(hasParserError).toBe(true)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web && npx vitest run tests/engine-parser.test.ts`
Expected: FAIL — parser lane not wired (or the custom engine already flags it — if the custom walker already catches `not_a_real_command`, use a fixture the custom engine misses, e.g. a valid-command-with-bad-argument case the parser catches; adjust the fixture accordingly).

- [ ] **Step 3: Wire the parser lane into engine.ts**

In `checkCompatibilityContentBased` (web/src/engine/engine.ts, around lines 480-660):
1. After the existing per-version custom checks, run the parser lane: `const parserIssues = await analyzePackWithSpyglass(files, ver.name, idbCache)` (guard with try/catch — on failure, log and skip, keeping custom-only results).
2. `const mapped = mapParserIssues(parserIssues, new Map(Object.entries(files)))`.
3. Merge: `mcfunctionIssues.push(...mapped.mcfunction)`, `structuralIssues.push(...mapped.structural)`, `registryIssues.push(...mapped.registry)`, `referenceIssues.push(...mapped.reference)`.
4. Keep the existing `hasContentIssues` computation (it already derives from these arrays).
5. Add a `parserActive: boolean` field to the result (or reuse an existing flag) so the UI can show "parser analysis active" — check `VersionCompatibility` in `web/src/engine/types.ts` and add the field if missing.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd web && npx vitest run tests/engine-parser.test.ts`
Expected: PASS.

- [ ] **Step 5: Run full web test suite + build**

Run: `cd web && npx vitest run && npx tsc --noEmit`
Expected: all pass, no type errors.

- [ ] **Step 6: Commit**

```bash
git add web/src/engine/engine.ts web/src/engine/parser-runner.ts web/tests/engine-parser.test.ts
git commit -m "wire parser lane into web engine"
```

---
