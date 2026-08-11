# MinexStudio IDE — Implementation Plan

**Generated:** 2026-08-10  
**Status:** Phase 0 — Foundation  
**Branch:** `master` (D:\dataapck version solution\datapack-version-checker)

---

## Executive Summary

Build a browser-based IDE for Minecraft datapacks — "VS Code for Datapacks" — that runs entirely in the browser with zero backend. The IDE integrates the existing checker engine (`checkCompatibilityContentBased`) as an Analysis panel, adds a Monaco-based code editor with file explorer, and progressively adds SpyglassMC LSP, visual editors, Git, and extensions.

**Vision:** A creator opens MinexStudio, sees a Diagnostics Desk, opens the Datapack Editor case, loads a pack, edits files with full IDE support, runs version checks, reads findings as triaged issue cards, auto-fixes, and re-runs — all in the browser.

---

## Current Checkpoint (2026-08-10)

### Completed
- DESIGN.md / PRODUCT.md recovered from git history (local only, in `.gitignore`)
- Global AGENTS.md: GitNexus mandatory, AI file rules, todo discipline
- GitNexus indexed at `D:\dataapck version solution\datapack-version-checker`
- CSS token bug fixed (33 missing tokens defined in `tokens.css`)
- Architecture mapped via GitNexus:
  - `App.tsx` — view router (`hub` | `checker`), all state lives here
  - `HubPage` — tool cases, `onOpenDatapackEditor` → `setView('checker')`
  - `PackSelector` — file upload (zip/folder), dropzone
  - `CheckPanel` — mode, versions, checkboxes, run button
  - `FixPanel` — target/source, preview/download
  - `Results` — issue display
  - `web/src/engine/engine.ts` — `checkCompatibilityContentBased` (main orchestrator)
  - `web/src/api.ts` — `runCheck`, `runFix`, `runFixPreview`, `fetchVersions`
- Monaco Editor installed: `@monaco-editor/react@4.7.0`, `monaco-editor@0.56.0`

### Missing
- IDE shell (`IdePage.tsx`)
- Monaco integration (editor, tabs, syntax highlighting)
- File explorer reusing `PackSelector`
- Analysis panel (reuse `CheckPanel` + `Results`)
- Fix panel (reuse `FixPanel`)
- IDE view routing in `App.tsx`

---

## Phase 0 — Foundation (MVP) — Target: This Week

| ID | Task | Description | Acceptance Criteria |
|----|------|-------------|---------------------|
| 0.1 | Create `IdePage.tsx` | Three-pane layout: explorer (left) / editor + tabs (center) / bottom panels (Analysis/Fix/Output) | Layout renders without errors |
| 0.2 | Monaco integration | Install `@monaco-editor/react`, render editor with `.mcfunction`/`.json` syntax highlighting, tabs, dark theme | File opens → Monaco shows syntax-highlighted content |
| 0.3 | File explorer | Reuse `PackSelector` logic → render loaded pack as nested tree; click → opens in editor | Click file in tree → opens in Monaco |
| 0.4 | Analysis panel | Embed `CheckPanel` + `Results` as "Analysis" bottom tab | Run check → see results in bottom panel |
| 0.5 | Fix panel | Embed `FixPanel` as "Fix" bottom tab | Preview fix → download zip |
| 0.6 | Output panel | Timestamped log (run/fix errors/downloads) | Log shows timestamped events |
| 0.7 | IDE routing | Add `view === 'ide'` to `App.tsx`; `HubPage` `onOpenDatapackEditor` → `setView('ide')` | Hub → Datapack Editor opens IDE |

**Definition of Done:** Open a pack → see files in explorer → click → edit in Monaco → run check → see results → preview

---

## Phase 1 — Core Editing (Week 2)

| ID | Task | Description |
|----|------|-------------|
| 1.1 | Sync edited content | Merge editedFiles + files when calling runCheck/runFix |
| 1.2 | File tree with folders | Nest paths by /; show folder hierarchy; create/rename/delete |
| 1.3 | pack.mcmeta validation | Warn if missing pack_format; auto-set version on create |
| 1.4 | Auto-save to IndexedDB | Persist draft edits per pack; restore on reload |
| 1.5 | Keyboard shortcuts | Ctrl+S save, Ctrl+Enter run, Escape close tab |

---

## Phase 2 — Intelligence (Weeks 3-4)

| ID | Task | Description |
|----|------|-------------|
| 2.1 | SpyglassMC LSP | Autocomplete, hover, diagnostics in Monaco via LSP client |
| 2.2 | Go-to-definition | Jump to function definition (function mypack:foo) |
| 2.3 | Rename refactor | Rename function updates all calls/tags/predicates |
| 2.4 | Find references | Show all usages of a function/tag/predicate |
| 2.5 | Inline diagnostics | Squiggly lines from checker results in Monaco gutter |

---

## Phase 3 — Visual Editors (Weeks 5-6)

| ID | Task | Description |
|----|------|-------------|
| 3.1 | Recipe editor | Drag-drop crafting grid (shaped/shapeless/smithing) |
| 3.2 | Loot table editor | Probability editor with simulation preview |
| 3.3 | Predicate builder | Visual condition builder (checkboxes, dropdowns) |
| 3.4 | Advancement graph | Node-based editor (nodes + edges) |
| 3.5 | pack.mcmeta GUI | Form editor for pack format, description, version |

---

## Phase 4 — Project Tools (Weeks 7-8)

| ID | Task | Description |
|----|------|-------------|
| 4.1 | Function call graph | tick -> spawn -> boss visualization |
| 4.2 | Dependency graph | Circular detection, unused files, dead code |
| 4.3 | Scoreboard/Storage inspector | Live view of objectives, storage data |
| 4.4 | Performance analyzer | Tick cost, execute depth, entity scans, scoreboard ops |
| 4.5 | Vanilla datapack browser | Search recipes, loot tables, tags, functions |

---

## Phase 5 — Platform (Weeks 9+)

| ID | Task | Description |
|----|------|-------------|
| 5.1 | Git integration | isomorphic-git: commit, history, diff, push, branches |
| 5.2 | Extension API | File types, validators, templates, commands, panels, themes |
| 5.3 | Templates marketplace | Boss, Minigame, Library, Magic, Skyblock, RPG |
| 5.4 | COOP/COEP headers | SharedArrayBuffer for Spyglass on GitHub Pages |

---

## Technical Debt / Infrastructure (Ongoing)

| Task | Description |
|------|-------------|
| CSS token bug fixed | 33 missing tokens defined in tokens.css |
| DESIGN.md/PRODUCT.md | Restored locally (untracked, in .gitignore) |
| | GitNexus re-index after each phase (npx gitnexus analyze) |
| | Add test coverage for IdePage, editor sync, fix preview |
| | CI: lint, typecheck, test on PR |

---

## Architecture Notes

### Current State (from GitNexus)
App.tsx (view router, all state)
  +-- HubPage.tsx (tool cases)
  +-- Checker view (PackSelector + CheckPanel/FixPanel + Results)
        +-- web/src/engine/engine.ts -> checkCompatibilityContentBased()
        +-- web/src/api.ts (runCheck, runFix, runFixPreview)
        +-- web/src/engine/analyzer.ts, walker.ts, fixer.ts, etc.

### IDE Integration Points
- PackSelector -> File explorer (reuse file loading logic)
- CheckPanel + Results -> Analysis panel (bottom tab)
- FixPanel -> Fix panel (bottom tab)
- Monaco editor -> new component, reads/writes editedFiles
- State stays in App.tsx (lifted for reuse)

---

## Definition of Done -- Phase 0 (MVP)

- [x] Open pack -> file tree in explorer
- [x] Click file -> opens in Monaco with syntax highlighting
- [x] Edit file -> changes tracked in editedFiles
- [x] Run check -> Analysis panel shows Results
- [x] Port to version -> Fix panel shows preview -> Download zip
- [x] Output log shows timestamped events
- [x] Hub -> Datapack Editor opens IDE view
- [x] Build passes, deploys to gh-pages
- [x] SpyglassMC integration: semantic highlighting, inline diagnostics, autocomplete, hover, go-to-definition

---

## Next Action

Start Phase 0.1-0.3: Create IdePage.tsx with three-pane layout, Monaco, and file explorer. Wire into App.tsx as view === ide.
