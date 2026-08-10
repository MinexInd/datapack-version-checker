## Task 4 Report: Error mapping — LanguageError → existing issue shapes

**Status**: DONE  
**Commit**: `da867e8`  
**Test summary**: 3/3 tests pass — mcfunction→McfunctionIssue, json→StructuralIssue(source=mcdoc), registry→RegistryIssue(entry extracted)

### What was done

Created `web/src/engine/parser-issues.ts` and `web/tests/parser-issues.test.ts` per the brief's TDD process.

1. **Step 1**: Wrote failing test verbatim from brief.
2. **Step 2**: Confirmed FAIL — "Cannot find module '../src/engine/parser-issues'".
3. **Step 3**: Implemented `mapParserIssues()` — routes issues by file extension and message pattern:
   - `.mcfunction` files → `McfunctionIssue` (extracts command from file content)
   - Messages matching `Unknown (item|block|entity|registry)` → `RegistryIssue` (extracts `minecraft:...` ID)
   - `.json` files → `StructuralIssue` with `source: 'mcdoc'`
   - Everything else → `ReferenceIssue`
4. **Step 4**: All 3 tests PASS.
5. **Step 5**: Committed as `da867e8`.

### API deviations from brief

None. The implementation matches the brief's sketch exactly — the types from `web/src/engine/types.ts` aligned perfectly with the brief's descriptions, and the `ParserIssue` interface from Task 3 was consumed as-is.

### Concerns

None.
