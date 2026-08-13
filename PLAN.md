# MinexStudio — Product and Engineering Roadmap

**Last reviewed:** 2026-08-12  
**Product:** MinexStudio, a browser-first IDE for Minecraft datapacks and resource packs  
**Repository:** `datapack-version-checker`  
**Delivery model:** vertical milestones; each milestone ends with a usable, tested release

## 1. Product direction

MinexStudio combines the existing compatibility checker with a VS Code-like browser IDE. A creator should be able to load a pack, understand its real compatibility, edit files with Minecraft-aware tooling, apply safe porting fixes, and export a playable pack without a backend or account.

### Primary user journey

1. Open a `.zip` or folder and identify the pack type and metadata.
2. Browse the normalized pack tree and open a file in the editor.
3. Edit with Monaco, Spyglass completions, hover, semantic colors, and diagnostics.
4. Run a compatibility check or whole-pack analysis and jump from a problem to its source.
5. Preview conservative fixes, apply or reject them, and re-run analysis.
6. Export the merged original-plus-edits as a new zip.

### Product principles

- **Browser-first:** no required server, login, or upload of pack contents.
- **Safe editing:** preserve user text where possible; never silently discard files or commands.
- **Evidence over guesses:** diagnostics come from real command trees, registries, mcdoc schemas, and explicit source/version labels.
- **Progressive disclosure:** Monaco remains the fallback for every file; visual forms are additive.
- **Offline-tolerant:** cached vanilla data and drafts should make repeat work resilient to transient network failure.
- **Observable actions:** long-running work reports progress, timing, errors, and cache state in Output.

## 2. Current baseline (verified 2026-08-12)

### Implemented

- React/Vite web app with Hub and IDE routing (`App.tsx`, `HubPage`, `IdePage`).
- Zip/folder loading, normalized paths, merged edited workspace, drop-to-merge, and drag-to-move.
- Nested file explorer with create, rename, delete, tabs, Monaco editing, language detection, and dark theme.
- Spyglass integration for parsing, semantic highlighting, markers, completions, hover, and definitions.
- Analysis, Problems, Fix, and Output panels; resizable/collapsible VS Code-style bottom panel.
- Auto/manual Minecraft version selection, reset/reload, whole-pack analyze, and problem navigation.
- `pack.mcmeta` form editor with JSON toggle and debounced write-back.
- Export of the current merged workspace to zip and Ctrl+S shortcut.
- Checker engine for commands, registries, mcdoc structure, technical changes, dependency analysis, and conservative fixes.
- Vitest coverage for engine lanes, parser mapping, Spyglass service, cache fallbacks, tar, diff, and pack I/O helpers.

### Known gaps

- Draft persistence and restore are not yet a complete workspace contract.
- Analysis/fix APIs need a single explicit workspace snapshot and cancellation/progress policy.
- Visual mcdoc editing is designed but not implemented beyond `pack.mcmeta`.
- Create/rename/delete need stronger reference-awareness, undo/recovery, and unsaved-change UX.
- Browser production behavior for CORS/COEP, cache eviction, and large packs needs validation.
- There is no stable end-to-end browser test suite or performance budget enforcement.

## 3. Architecture and contracts

### Runtime layers

```text
React shell (App/Hub/IdePage)
  ├─ Workspace state: originalFiles, editedFiles, deletedFiles, metadata, draft status
  ├─ IDE adapters: pack I/O, Monaco, SpyglassService, visual editors
  └─ checker adapters: runCheck, analyze-all, fix preview/apply, exportZip
Engine (pure TypeScript)
  ├─ parser/tokenizer/walker
  ├─ command + registry + mcdoc validation
  ├─ dependency/metrics analysis
  └─ conservative fix planning and rewrites
Data/cache layer
  ├─ Spyglass/mcmeta/registry fetchers
  ├─ IndexedDB cache and draft storage
  └─ browser fallbacks and telemetry-free diagnostics
```

### Workspace contract

All actions operate on one immutable-at-call-time snapshot:

```ts
type WorkspaceSnapshot = {
  files: Record<string, string>
  packName: string
  mode: 'auto' | 'datapack' | 'resourcepack'
  sourceVersion: string | 'Auto'
  revision: number
}
```

Edits update a revisioned workspace. Checks, analyzes, fixes, and exports capture a snapshot; results carry the revision they used. A stale result must be visibly marked and must not overwrite newer edits.

### Non-negotiable behavior

- Paths are normalized to forward-slash relative paths; duplicate/conflicting imports are resolved explicitly.
- Every diagnostic includes file, line/column when available, severity, source, and game version.
- Fix preview is non-mutating. Apply is an explicit action and records changed files.
- Export includes original files plus edits minus deletions, with deterministic ordering and a clear filename.
- Monaco is always available when a schema, network request, or visual editor fails.

## 4. Delivery milestones

### Milestone 0 — IDE foundation (complete)

**Outcome:** load → browse → edit → analyze → fix preview → export.  
**Evidence:** commits `8a216a9` through `27dc761`; build and existing Vitest suites remain green.

### Milestone 1 — Reliable editing workspace (next)

**Goal:** make editing durable and predictable before adding more intelligence.

1. **Workspace synchronization and revisioning**
   - Centralize `workspaceFiles` derivation and pass snapshots to check/fix/analyze/export.
   - Mark stale results; prevent race conditions when edits occur during a run.
   - Add cancellation for superseded Spyglass/check operations.
2. **Draft persistence**
   - IndexedDB schema keyed by pack identity plus content hash.
   - Persist edits, deletions, open tabs, active file, selected version, panel state, and timestamps.
   - Restore only with user confirmation when source content changed; provide discard/clear-draft action.
3. **File lifecycle safety**
   - Confirm destructive deletes; add undo for local operations.
   - Detect likely function/tag references on rename/delete and show affected files.
   - Validate names, extensions, path traversal, duplicate paths, and empty folders.
4. **Metadata validation**
   - Surface missing/invalid `pack.mcmeta`, pack type, and unsupported format ranges as Problems.
   - New-file templates must generate valid metadata when requested.
5. **Keyboard and accessibility contract**
   - Ctrl+S export/save, Ctrl+Enter analyze, Escape close/clear, keyboard tree navigation, focus-visible states, and accessible labels.

**Acceptance gate:** reload restores a draft; edits made during a run cannot be lost; rename/delete/export produce deterministic workspace output; keyboard-only smoke test passes.

### Milestone 2 — Diagnostics and porting workflow

**Goal:** make compatibility work explainable at pack scale.

- Manual version selector with Auto detection, reset/re-init, and explicit version shown in every result.
- Whole-pack Spyglass analyze with progress, cancellation, cache hit/miss reporting, and grouped Problems.
- Problems UX: file grouping, filtering, severity counts, source/version labels, line/column navigation, and “open in Monaco” fallback.
- Checker result model unifies parser, command, registry, structural, dependency, and technical-change findings.
- Fix preview shows per-file diff, reason, confidence, skipped/manual items, and rollback-safe apply.
- Re-run analysis automatically after apply; preserve a before/after summary.

**Acceptance gate:** a fixture pack with cross-file references yields stable grouped findings; every finding navigates correctly; preview never changes workspace; apply + re-run reaches the expected result.

### Milestone 3 — Visual mcdoc editing

**Goal:** provide schema-driven forms without creating separate editors for every JSON format.

#### 3.1 Generic framework (first visual-editor release)

- `SpyglassService.getSimplifiedRootType(path)` returns a pure `SimplifiedMcdocType` tree: struct, union, list, tuple, enum, primitive, literal, or map, with `since`/`until` and registry-id hints.
- `web/src/ide/mcdoc-edit.ts` provides dependency-free path edits, schema defaults, union migration, subtree serialization, and JSON-pointer-safe operations.
- `McdocEditor.tsx` recursively renders fields with optional add/remove, list reorder/duplicate, enum/registry selectors, version-gated hints, invalid-JSON state, and Monaco JSON toggle.
- Write-back replaces only the edited AST range when possible; whole-document serialization is the explicit fallback.
- `IdePage` dispatches recipe JSON to the form, keeps Monaco for unsupported/failed files, and loads presets from the versioned vanilla data source.

#### 3.2–3.4 Enable formats

Unlock loot tables, predicates, and advancements only after each format has parser/round-trip fixtures and schema coverage. Keep the generic renderer unchanged unless a format-specific widget materially improves safety or comprehension.

#### 3.5 Metadata form (complete)

Maintain the existing `pack.mcmeta` form and JSON toggle as the reference implementation for debounce, invalid input, and write-back behavior.

**Acceptance gate:** no-op form load is byte-stable; edits produce valid JSON; union changes preserve intended values; version-gated fields hide/show correctly; unsupported schemas fall back to Monaco.

### Milestone 4 — Project intelligence

**Goal:** help users understand behavior beyond individual files.

- Function/tag/predicate call graph with unresolved and circular references.
- Dependency graph with orphan, dead-code, and broken-reference views.
- Scoreboard objectives and storage inspector derived from static analysis.
- Performance heuristics: tick entrypoints, execute depth, entity scans, and high-cost command patterns.
- Vanilla browser for recipes, loot, tags, and registries with insert/copy-to-workspace actions.

**Acceptance gate:** graphs are deterministic for fixtures, every edge can navigate to source, and analysis never blocks editing on large packs.

### Milestone 5 — Collaboration and extensibility

**Goal:** make the tool useful in team and ecosystem workflows.

- isomorphic-git repository state, commits, diffs, history, branches, and push/pull only after browser storage/security review.
- Extension API for file types, validators, templates, commands, panels, and themes with versioned capability boundaries.
- Template marketplace with signed/validated manifests and offline-safe installation.
- COOP/COEP deployment checks and SharedArrayBuffer capability diagnostics.

**Acceptance gate:** an extension cannot mutate files outside the workspace contract; Git operations are recoverable; deployment smoke tests pass on GitHub Pages.

### Milestone 6 — Desktop shell (deferred)

Use Tauri only when native folder access, disk cache, or packaging is a demonstrated blocker for the web product. Reuse the React/Monaco/Spyglass frontend; do not rewrite the editor in Rust.

## 5. Testing, quality, and release gates

### Required checks for every milestone

- `npm run build` for the web app.
- Root TypeScript build/typecheck and all Vitest suites.
- GitNexus impact analysis before changing any function/class/method; warn on HIGH/CRITICAL blast radius.
- GitNexus `detect_changes()` before commit; compare with `master` for regression reviews.
- Update fixtures and tests with every new engine or workspace contract.

### Test layers

- Pure unit tests: path normalization, workspace merge, revision/stale-result rules, mcdoc mutations, serializers, diffing.
- Engine integration tests: real Spyglass parser, command trees, registries, mcdoc schemas, cache failures, and version selection.
- Component tests: tree operations, panel resizing/collapse, Problems navigation, form/JSON toggle, draft restore prompts.
- Browser smoke tests: load zip, edit, analyze, preview, apply, export, reload draft, and fallback when network is unavailable.
- Performance fixtures: small/medium/large packs with budgets for initial load, first diagnostic, analyze-all, and export.

### Release checklist

- No data loss in the workspace journey.
- No uncaught errors in the browser console during smoke tests.
- All async operations show loading/progress and recoverable errors.
- Cache and network failures degrade to usable local behavior.
- Accessibility pass for keyboard navigation, focus, labels, and contrast.
- Documentation updated for user-visible behavior and known limitations.

## 6. Risks and mitigations

| Risk | Mitigation |
|---|---|
| Spyglass/CDN unavailable or changes shape | Version-pin adapters, cache successful responses, expose fallback state, keep Monaco/checker independent. |
| Large packs freeze the browser | Incremental parsing, debounced updates, worker boundary when profiling justifies it, progress/cancellation. |
| Visual editor corrupts JSON or loses comments/order | AST-range write-back, golden byte-stability tests, Monaco fallback, explicit whole-document fallback. |
| Async results overwrite newer edits | Revisioned snapshots, stale-result checks, cancellation, visible result provenance. |
| Git/extension features expand security surface | Defer until contracts, permissions, validation, and recovery UX are specified and tested. |

## 7. Decision log and assumptions

- Web-first remains the default; Tauri is deferred.
- One generic mcdoc renderer is preferred over bespoke recipe/loot/predicate/advancement editors.
- Monaco is the universal fallback and raw JSON escape hatch.
- Browser storage is local and privacy-preserving; no pack contents are sent to a backend.
- Dates and “weeks” are planning estimates, not commitments; milestone gates determine sequencing.

## 8. Immediate next actions

1. Establish the revisioned `WorkspaceSnapshot` and make check/fix/analyze/export consume it.
2. Add draft persistence with migration/versioning and restore/discard UX.
3. Add unit and component tests for file lifecycle and stale-result behavior.
4. Profile a large-pack analyze run and record baseline timings.
5. Start Milestone 3.1 only after Milestone 1’s data-loss and async-race gates pass.
