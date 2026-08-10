### Task 6: Progressive enhancement + GH Pages verification

**Files:**
- Modify: `web/src/engine/engine.ts` (fallback flag + notice)
- Modify: `web/src/components/Results.tsx` (show parser status notice)
- Modify: `web/src/engine/parser-runner.ts` (lazy tarball loading: only fetch the vanilla datapack tarball for versions actually checked; skip when offline)

**Interfaces:**
- Consumes: everything above.
- Produces: a working GH Pages build.

- [ ] **Step 1: Fallback + notice**

In `engine.ts`: when the parser lane throws (offline, tarball too big, quota), set `parserActive: false` and continue with custom checks only. In `Results.tsx`, render a small muted line when `parserActive === false`: "Parser unavailable — using built-in checks" (reuse existing notice styling; do not redesign).

- [ ] **Step 2: Lazy tarball loading**

In `parser-runner.ts`: fetch `getVanillaDatapack` only for the target version being checked (already per-version), and skip it entirely when the pack has no cross-file references (no `data/*/functions/**` + no `data/*/loot_tables/**` + no `data/*/advancements/**`). Cache tarballs in IndexedDB (they go through `fetchWithCache` → `web.getCache()` automatically).

- [ ] **Step 3: Verify build + tests**

Run: `cd web && npx vitest run && npm run build`
Expected: PASS; `web/dist/` produced.

- [ ] **Step 4: GH Pages verification**

1. `cd web && npm run build` (fresh).
2. Serve locally: `cd web && npx vite preview` — open the app, upload a test pack (use the corpus at `C:\Users\DELL\AppData\Local\Temp\opencode\wither-tests\`), confirm: analysis runs, parser errors appear, fixer still works, second analysis is instant (IndexedDB cache).
3. Deploy: push to `gh-pages` branch (the branch method from the earlier session: copy `web/dist/*` into the gh-pages worktree, commit, push). Verify the live site loads and analyzes.

- [ ] **Step 5: Commit**

```bash
git add web/src/engine/engine.ts web/src/engine/parser-runner.ts web/src/components/Results.tsx
git commit -m "add parser fallback and lazy tarball loading"
```

---
