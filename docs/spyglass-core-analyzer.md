# Spyglass-Core Analyzer — Design Note

**Decision:** replace the hand-rolled `mcdoc-check.ts` (1401-line regex parser) with Spyglass's real core (`@spyglassmc/core` + `@spyglassmc/java-edition`) for datapack analysis.

## Why

- `mcdoc-check.ts` re-parses `.mcdoc` sources with regexes, dropping dispatcher unions, enum registry IDs, and version-gated fields.
- Spyglass already ships a typed parser/binder/checker for mcfunction, JSON, mcdoc, and NBT — the web app (`web/src/engine/spyglass-service.ts`) already proves the Node bootstrap works.
- The package.json already depends on `@spyglassmc/core`, `java-edition`, `mcdoc`, `json`, `nbt` — the dependency is there, we just aren't using it in the Node CLI.

## Target architecture

```
src/spyglass-analyze.ts   ← new, version-driven
  analyzePackWithSpyglass(packDir, version) → SpyglassAnalysisResult
  clearSpyglassCache()
```

- **Version is an explicit caller-supplied input** (CLI flag / MCP param), NOT inferred from `pack.mcmeta`. This lets users ask "does this pack work in 1.21.4?" directly.
- Bootstraps a `Service`/`Project` with `initialize` from `@spyglassmc/java-edition`.
- Uses `getVanillaDatapack(externals, logger, version)` for version-specific vanilla data; `getVanillaMcdoc(externals, logger)` for latest mcdoc schema.
- Collects diagnostics from `Project`'s `documentErrored` event / `FileNode.getErrors()`.
- Maps `ErrorSeverity` (Hint=0, Info=1, Warning=2, Error=3) → `error`/`warning`/`info`.
- Caches the `Service`/`Project` per `(packDir, version)`.

## MCP tool

Add `dpcheck_diagnostics` to `src/mcp-server.ts`:
- Params: `path` (pack dir), `version` (required, e.g. `"1.21.4"`), `mode` (optional).
- Returns `{ version, fileCount, errorCount, warningCount, diagnostics: [...] }`.
- Does NOT fall back to `pack.mcmeta` for version selection.

## Sequencing

1. `src/spyglass-analyze.ts` + fixture test (this task).
2. `dpcheck_diagnostics` MCP tool.
3. Validate on real fixture packs; compare output vs existing `engine.ts` + `mcdoc-check.ts` paths.
4. Retire `mcdoc-check.ts` once parity is proven.

## Status

- Research: done.
- M1.3 (file lifecycle): committed `20cd68f`.
- M1.4 (metadata validation): committed `19cd534`.
- Analyzer: in progress.
