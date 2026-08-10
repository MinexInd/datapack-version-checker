### Task 4: Error mapping — LanguageError → existing issue shapes

**Files:**
- Create: `web/src/engine/parser-issues.ts`
- Create: `web/tests/parser-issues.test.ts`

**Interfaces:**
- Consumes: `ParserIssue` from Task 3.
- Produces: `mapParserIssues(issues: ParserIssue[], files: Record<string, string>): { mcfunction: McfunctionIssue[]; structural: StructuralIssue[]; registry: RegistryIssue[]; reference: ReferenceIssue[] }` using the existing shapes from `web/src/engine/types.ts` (McfunctionIssue `{ file, line, command, issue, snippet?, suggestion?, autoFixable? }`, StructuralIssue `{ file, issue, source?, suggestion?, autoFixable? }`, RegistryIssue `{ file, registry, entry, issue, suggestion?, autoFixable? }`, ReferenceIssue `{ file, line?, reference, type, issue, code? }`).

- [ ] **Step 1: Write the failing test**

`web/tests/parser-issues.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { mapParserIssues } from '../src/engine/parser-issues'

describe('mapParserIssues', () => {
  it('maps mcfunction errors to McfunctionIssue', () => {
    const out = mapParserIssues(
      [{ file: 'data/demo/functions/a.mcfunction', line: 2, message: 'Unknown command', severity: 'error', source: 'mcfunction' }],
      new Map([['data/demo/functions/a.mcfunction', 'say hi\n/foo\n']]),
    )
    expect(out.mcfunction).toHaveLength(1)
    expect(out.mcfunction[0].file).toBe('data/demo/functions/a.mcfunction')
    expect(out.mcfunction[0].line).toBe(2)
    expect(out.mcfunction[0].issue).toContain('Unknown command')
  })

  it('maps json errors to StructuralIssue with source mcdoc', () => {
    const out = mapParserIssues(
      [{ file: 'data/demo/advancements/x.json', line: 1, message: 'Missing required field', severity: 'error', source: 'json' }],
      new Map(),
    )
    expect(out.structural).toHaveLength(1)
    expect(out.structural[0].source).toBe('mcdoc')
  })

  it('maps registry reference errors to RegistryIssue', () => {
    const out = mapParserIssues(
      [{ file: 'data/demo/recipes/r.json', line: 1, message: 'Unknown item minecraft:not_a_thing', severity: 'error', source: 'json' }],
      new Map(),
    )
    expect(out.registry).toHaveLength(1)
    expect(out.registry[0].entry).toBe('minecraft:not_a_thing')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web && npx vitest run tests/parser-issues.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement parser-issues.ts**

```ts
import type { McfunctionIssue, StructuralIssue, RegistryIssue, ReferenceIssue } from './types'
import type { ParserIssue } from './parser-runner'

export interface MappedIssues {
  mcfunction: McfunctionIssue[]
  structural: StructuralIssue[]
  registry: RegistryIssue[]
  reference: ReferenceIssue[]
}

export function mapParserIssues(issues: ParserIssue[], files: Map<string, string>): MappedIssues {
  const out: MappedIssues = { mcfunction: [], structural: [], registry: [], reference: [] }
  for (const issue of issues) {
    const line = issue.line
    const command = files.get(issue.file)?.split('\n')[line - 1]?.trim() ?? ''
    if (issue.file.endsWith('.mcfunction')) {
      out.mcfunction.push({ file: issue.file, line, command, issue: issue.message })
    } else if (/Unknown (item|block|entity|registry)/i.test(issue.message)) {
      const m = issue.message.match(/minecraft:[a-z0-9_./-]+/i)
      out.registry.push({ file: issue.file, registry: 'unknown', entry: m?.[0] ?? issue.message, issue: issue.message })
    } else if (issue.file.endsWith('.json')) {
      out.structural.push({ file: issue.file, issue: issue.message, source: 'mcdoc' })
    } else {
      out.reference.push({ file: issue.file, line, reference: issue.message, type: issue.source, issue: issue.message })
    }
  }
  return out
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd web && npx vitest run tests/parser-issues.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add web/src/engine/parser-issues.ts web/tests/parser-issues.test.ts
git commit -m "map parser errors into existing issue shapes"
```

---
