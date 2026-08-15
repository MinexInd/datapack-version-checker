# Minex Datapack Checker — Detailed Documentation

This guide explains everything you need to know: from what a datapack is, to running your first check, to understanding every line of the output. Written for **beginners** — no programming experience required beyond opening a terminal.

Also see the quick-start [`README.md`](README.md) if you just want to get going fast.

---

## Table of contents

1. [What is a datapack?](#1-what-is-a-datapack)
2. [What problem does this tool solve?](#2-what-problem-does-this-tool-solve)
3. [Two ways to run it: localhost GUI and CLI](#3-two-ways-to-run-it-localhost-gui-and-cli)
4. [Installing the tool](#4-installing-the-tool)
5. [Running your first check](#5-running-your-first-check)
6. [Understanding the output](#6-understanding-the-output)
7. [Auto-fix and porting](#7-auto-fix-and-porting)
8. [Pack analysis (dependency graph)](#8-pack-analysis-dependency-graph)
9. [Worked examples (real datapacks)](#9-worked-examples-real-datapacks)
10. [How it works under the hood](#10-how-it-works-under-the-hood)
11. [The knowledge base (version-change rules)](#11-the-knowledge-base-version-change-rules)
12. [Troubleshooting](#12-troubleshooting)
13. [For developers](#13-for-developers)

---

## 1. What is a datapack?

A **datapack** is a folder of files that changes how Minecraft behaves — adding commands, functions, loot tables, recipes, advancements, and more. A valid datapack always contains a file named `pack.mcmeta` at its top level:

```
MyDatapack/
├── pack.mcmeta          ← required, tells Minecraft "this is a datapack"
├── data/
│   └── mynamespace/
│       ├── functions/
│       │   └── tick.mcfunction
│       ├── advancements/
│       └── loot_tables/
└── ...
```

This tool reads the files **inside `data/`** (the `.mcfunction` command files and the `.json` data files) to figure out compatibility.

A **resource pack** is similar but lives in `assets/` and controls textures, sounds, models, and other visual elements. This tool supports both.

---

## 2. What problem does this tool solve?

Minecraft changes every version. A command that works in 1.21 might not exist in 1.20. A JSON format valid in 1.20.5 could be invalid in 1.20.4.

The usual ways people guess compatibility are unreliable:

- **`pack.mcmeta` `supported_formats`** — authors fill this in by hand and often get it wrong, or copy it from another pack.
- **"It works on my version"** — tells you nothing about other versions.

This tool **reads what your datapack actually does** and checks it against the real command and data definitions of each Minecraft version.

---

## 3. Two ways to run it: localhost GUI and CLI

### Web GUI (recommended for most users)

Start the local server and open your browser:

```bash
node dist/index.js serve
# Then open http://localhost:3001
```

The GUI gives you:

- **Drag-and-drop** pack upload (folder or `.zip`)
- **Searchable version picker** — filter by name, ID, or type
- **Check tab** — run compatibility analysis with full options
- **Fix tab** — choose source + target versions, preview changes, download ported `.zip`
- **Visual forms** — edit recipes, loot tables, predicates, and advancements with live schema-driven forms
- **Monaco editor** — raw JSON editing with syntax highlighting
- **Problems panel** — grouped issues with file, line, severity, and fix suggestions

### CLI (for scripts, CI, and terminal users)

Run directly from the terminal:

```bash
# Check a datapack
node dist/index.js --dir "./my-datapack"

# Check specific versions
node dist/index.js --dir "./my-datapack" --versions "1.20.4,1.21,1.21.1"

# Auto-fix to target version
node dist/index.js --dir "./my-datapack" --fix 1.21

# Resource pack mode
node dist/index.js --dir "./my-resource-pack" --mode resourcepack

# JSON output for scripting
node dist/index.js --dir "./my-datapack" --json > report.json
```

Both modes use the same engine and produce the same results.

---

## 4. Installing the tool

### Step 1 — Install Node.js

1. Go to [nodejs.org](https://nodejs.org)
2. Download the **LTS** version
3. Run the installer, accept defaults
4. Verify it works:

   ```bash
   node --version
   # Expected: v20.x or higher
   ```

### Step 2 — Get the project files

Download or clone this project so you have a folder like:

```
minexind.github.io/
├── package.json
├── tsconfig.json
├── src/
├── web/
└── ...
```

### Step 3 — Install dependencies and build

Open a terminal **in that folder** and run:

```bash
npm install
npm run build
```

- `npm install` downloads dependencies (TypeScript, React, Vite, testing tools, etc.)
- `npm run build` compiles the TypeScript into runnable JavaScript

> You only need to run `npm install` once. Re-run `npm run build` after any code changes.

---

## 5. Running your first check

Find the folder of the datapack you want to test — the one that contains `pack.mcmeta`.

### Using the GUI

```bash
node dist/index.js serve
# Open http://localhost:3001 in your browser
```

Then drag-and-drop your datapack folder into the browser window.

### Using the CLI

```bash
node dist/index.js --dir "C:\Path\To\Your\Datapack"
```

On macOS/Linux:

```bash
node dist/index.js --dir "/home/you/Downloads/YourDatapack"
```

If you are **already inside** the datapack folder, you can omit `--dir`:

```bash
node dist/index.js
```

---

## 6. Understanding the output

### CLI report header

```
⚡ Minex Datapack Checker v0.5.0
═══════════════════════════════════════════════════════════

📦 Declared load range (pack.mcmeta): 1.19.3 – 1.19.3
📋 Minimum version from content: 1.20.5
🔍 Versions checked: 26
✅ Fully compatible: 0
❌ Breaks / incompatible: 26
```

| Field | What it means |
|-------|---------------|
| **Declared load range** | What `pack.mcmeta` claims. Here it says only 1.19.3. |
| **Minimum version from content** | The *real* oldest version the content can run on. Here it's **1.20.5**, which is newer than the declared range. **That means `pack.mcmeta` is wrong.** |
| **Versions checked** | How many versions were examined |
| **Fully compatible** | Versions where the pack loads and has no detected breaks |
| **Breaks / incompatible** | Versions where something is wrong |

### Detailed issue report

```
❌ CONTENT BREAKS ON THESE VERSIONS
▶ 1.20.4
────────────────────────────────────────────────────────────
    data\aop1\functions\dr.mcfunction:1
      ✗ Uses The /item command (replace/modify) overhaul requires 1.20.5+
        — needs >= 1.20.5 but this is 1.20.4
      → Use /replaceitem for pre-1.20.5.
```

This tells you:

- **Which version** breaks: `1.20.4`
- **Which file and line**: `dr.mcfunction:1`
- **Why it breaks**: uses `/item`, which needs 1.20.5+
- **What to change**: use `/replaceitem` for older versions

### Suggestion format

Every issue shows a suggestion line starting with `→`:

- **`→ ...`** — guidance from the knowledge base
- **`→ ... [auto-fixable]`** — the tool can fix this automatically with `--fix`
- **`## FIXED(...): original command`** — appears in auto-fixed files for commands that couldn't be rewritten

### Summary mode (`--summary`)

With `--summary`, outside-load-range versions are shown separately:

```
✅ Fully compatible: 26
❌ Breaks / incompatible: 5
  Outside declared load range: 15
```

This makes it easier to see which versions actually have content problems vs. which are simply outside the declared range.

---

## 7. Auto-fix and porting

### What `--fix` does

Ports a datapack or resource pack to a target version:

**Datapack mode:**

- Rewrites commands that don't exist in the target version (e.g., `/dialog` → commented note)
- Handles commands inside `/execute run` and `$()` macro expressions
- Converts syntax formats (e.g., `/place feature` → `/placefeature`)
- Removes JSON fields invalid for target version via mcdoc schema validation
- Fixes advancement icons (post-1.20.5 `ItemStackTemplate` → pre-1.20.5 `{item,nbt}`)
- Updates `pack.mcmeta` `pack_format`
- Skips files whose registry doesn't exist in target version

**Resource pack mode:**

- Removes JSON fields invalid for target (e.g., `render_type` in models)
- Updates `pack.mcmeta` `resource_pack_format`
- Copies other files (PNG, etc.) unchanged

### How to use it

```bash
# Basic port
node dist/index.js --dir "./my-datapack" --fix 1.21

# Port from a specific source version
node dist/index.js --dir "./my-datapack" --fix 1.21 --from 1.20.4

# Custom output directory
node dist/index.js --dir "./my-datapack" --fix 1.21 --output "./my-ported-pack"

# Preview changes before applying
node dist/index.js --dir "./my-datapack" --fix 1.21 --diff
```

### Important limitations

`--fix` is a **partial port**, not a complete one. It handles:

- Command syntax changes
- JSON field renames/removals
- Icon format changes
- Pack format updates

It **cannot** fix:

- Game mechanic changes (mob behavior, redstone, world generation)
- Deep NBT structure changes not covered by mcdoc schemas
- Entirely new features with no old equivalent

**Always test the ported pack in-game** and review the `## FIXED(...)` comments for manual attention items.

---

## 8. Pack analysis (dependency graph)

When you run a check, the tool builds a **dependency graph** of your pack and shows a summary:

```
--- Pack Analysis ---
Resources: 12 indexed
  7 Functions, 5 JSON files
  9 Commands, 1 Avg cmds/fn
  Max exec depth: 0
  Largest function: data/demo/functions/helper.mcfunction (5 lines)
  Namespaces: demo (12)

  12 cross-file references found
  4 Orphans
  1 Broken references
  1 Circular dependency
```

### What each section means

#### Resource types detected

| Type | Detected from path |
|------|-------------------|
| `function` | `data/*/functions/` |
| `tag/function`, `tag/block`, `tag/item`, etc. | `data/*/tags/` |
| `advancement` | `data/*/advancements/` |
| `predicate` | `data/*/predicates/` |
| `item_modifier` | `data/*/item_modifiers/` |
| `loot_table` | `data/*/loot_tables/` |
| `recipe` | `data/*/recipes/` |
| `worldgen/*` | `data/*/worldgen/*/` |
| `model` | `assets/*/models/` |
| `texture` | `assets/*/textures/` |
| `blockstate` | `assets/*/blockstates/` |

#### Cross-file references

The tool traces how files reference each other:

- **Function calls**: `/function namespace:path` and `/schedule function namespace:path`
- **Predicate refs**: `/execute if|unless predicate namespace:path`
- **Loot table refs**: `/loot namespace:path` and `"loot_table"` keys in JSON
- **Advancement rewards**: `"function"` key in advancement JSON
- **Recipe items**: `"item"` and `"result"` keys in recipe JSON
- **Tag members**: `"values"` array in tag JSON
- **Model parents/textures**: `"parent"` and `"textures"` keys in model JSON

#### Orphans

Resources that are defined but **never referenced** by anything else in the pack. Use orphans to find dead code — files you might have forgotten to delete.

#### Broken references

References that point to files **that don't exist** in the pack. Use broken refs to catch typos in function calls and JSON paths.

#### Circular dependencies

When function A calls function B, and function B calls function A (directly or through a chain). In-game this causes an **infinite loop** that freezes or crashes Minecraft. The tool detects cycles of any length and reports the full loop path.

### Porting plans

When using `--fix <target>`, the tool first generates a **porting plan** showing every rewrite it will perform, plus:

- **Cascade effects** — files that depend on a file being rewritten
- **Manual attention items** — features that need a rewrite but no automated rule exists yet
- **Summary** — total actions, auto-fixable count, manual count, files affected
- **Skipped files** — files whose registry doesn't exist in the target version

The plan runs before any file is modified, so you can review what will change.

---

## 9. Worked examples (real datapacks)

### Example A — Wither Ascension v4

Declared load range: **1.21.10 – 26.2 Snapshot 3**.

```bash
node dist/index.js --dir "../real-tests/wither" -v 1.21.9 1.21.10 1.21.11 26.1 26.1.1 26.1.2 26.2
```

**Result:** compatible with 1.21.9, 1.21.10, 1.21.11, 26.1, 26.1.1, 26.1.2.

The content uses features down to 1.19.4 (`/damage`) but the declared load range starts at 1.21.10, so older versions fall outside the declared range.

### Example B — Infinity Blade

Declared load range: **1.19.3**.

```bash
node dist/index.js --dir "../real-tests/infinity"
```

**Result:** 0 compatible versions.

The content uses `/item` and `/execute if items`, which require **1.20.5+**. So `pack.mcmeta` is wrong — the pack actually needs 1.20.5, not 1.19.3. This tool caught the mistake.

### Example C — Ultimate DayCounter (26.x)

Declared load range: **26.1 Snapshot 11 – 26.3 Snapshot 1**.

```bash
node dist/index.js --dir "../real-tests/daycounter"
```

**Result:** compatible with 26.1, 26.1.1, 26.1.2, 26.2.

The content uses `/dialog` (1.21.6+), so versions before 1.21.6 are listed as breaking — but all declared 26.x versions work.

---

## 10. How it works under the hood

All data is cached locally for 24 hours so re-runs are fast and work offline. Use `--refresh` to force a fresh download.

### Datapack mode

1. **Gather version data.** Fetch the list of Minecraft versions, command trees, registries, and vanilla-mcdoc schema from the Spyglass API.
2. **Read the pack.** Scan every `.mcfunction` and `.json` file under `data/`.
3. **Check JSON values.** Validate each JSON string against the version's registries (entity types, items, biomes, etc.).
4. **Check JSON structure (mcdoc).** Validate each file against the [vanilla-mcdoc](https://github.com/SpyglassMC/vanilla-mcdoc) schema for that version — field names, dispatch `type` values, and version gating for 70+ datapack types.
5. **Check JSON semantics.** Version-aware checks for predicate field renames, damage boolean flag removal, biome precipitation format changes, loot function type requirements, and recipe result key renames.
6. **Check registry deprecations.** If `pack.mcmeta` declares a source version, compare its registries against each target version — report entries that were removed.
7. **Check commands.** Tokenize each command line and walk it against the version's Brigadier command tree (following redirects like `tp` → `teleport`).
8. **Apply knowledge rules.** Version-gated features override the lenient walker and are reported as breaks on older versions. Every reported issue is matched against the unified rule base and gets a suggestion.
9. **Analyze dependency graph.** Build a resource index of all functions, JSON files, tags, and models; trace cross-file references; detect orphans, broken refs, and circular dependencies; compute pack metrics.
10. **Pull breaking changes.** Fetch community-curated notes from [misode/technical-changes](https://github.com/misode/technical-changes) per version and show as informational notes.
11. **Combine with `pack.mcmeta`.** The declared load range tells us which versions Minecraft will load the pack on. The content check tells us where it breaks.

### Resource pack mode

Same pipeline as datapack, but routes files to resource-specific types (`model`, `block_definition`, `sounds`, `atlas`, `particle`, `font`, `shader`, `lang`, `texture_meta`, etc.).

### Why `pack.mcmeta` is used but not trusted

- `pack.mcmeta`'s `pack_format` is the **authoritative "will it load"** signal — if the number doesn't match, Minecraft ignores the pack.
- But the **content** decides whether the pack actually works once loaded.
- This tool uses `pack.mcmeta` for the load range, and uses real content analysis to find breaks — including cases where `pack.mcmeta` is too optimistic (declares an old version but uses new features).

---

## 11. The knowledge base (version-change rules)

The knowledge base is a curated list of **porting rules** in `src/rules.ts`. Each rule says: *"if the datapack uses feature X, it needs at least version Y."*

Rules drive three things:

1. **Detection** — the `match` / `type` / `since` fields power version-range knowledge checks and per-version issue detection.
2. **Guidance** — the `guidance` field becomes the per-issue porting suggestion shown in the CLI and web GUI.
3. **Auto-fix** — the structured `fix` action (`rewrite`, `rename_field`, `remove_field`, `comment_out`, `rename_registry_entry`) powers the `--fix` command rewrite engine.

Examples of rules included:

| Feature | Minimum version |
|---------|-----------------|
| `/random` | 1.20.2 |
| `/damage`, `/ride` | 1.19.4 |
| `/return` | 1.20 |
| `/fillbiome` | 1.19.3 |
| `/tick` (debug/admin only) | 1.20.3 |
| `/transfer` | 1.20.5 |
| Item components in `/give` | 1.20.5 |
| `/item` command | 1.20.5 |
| `/execute if items` | 1.20.5 |
| `/bossbar ... players` | 1.20.5 |
| Function macros `$(var)` | 1.20.4 |
| `/return run` | 1.20.4 |
| Custom enchantments registry | 1.21 |
| Custom jukebox songs registry | 1.21 |
| `/test` (game test) | 1.21.4 |
| `minecraft:item_model` component | 1.21.4 |
| Rich `custom_model_data` | 1.21.4 |
| `minecraft:consumable` component | 1.21.2 |
| `/rotate` | 1.21.2 |
| `wolf_variant` / `pig_variant` registries | 1.21.5 |
| `/version`, `/waypoint`, `/dialog` | 1.21.6 |
| `/fetchprofile` | 1.21.9 |
| `/swing` | 26.1 |
| `/unpublish` | 26.2 |
| `/posteffect` | 26.3 |

This list is **not exhaustive** — Minecraft has hundreds of changes across versions. New rules are added over time.

---

## 12. Troubleshooting

**"Error: No pack.mcmeta found"**
You pointed `--dir` at the wrong folder. Point it at the folder that contains `pack.mcmeta`.

**GUI shows nothing / blank screen after running a check**
Rebuild with `npm run build` and clear your browser cache.

**"Could not fetch command tree" / network errors**
The tool needs internet access to reach `api.spyglassmc.com`. Check your connection or firewall.

**"command not found: node"**
Node.js is not installed or not on your PATH. Re-install from nodejs.org and restart your terminal.

**It says a version is compatible but the pack still fails in-game**
The knowledge base and tree don't cover *every* possible change (especially deep NBT structure). Treat the report as a strong signal, not a 100% guarantee. The `--strict` flag can surface more potential issues.

**Too many false positives with `--strict`**
That's expected — the underlying command data has small gaps. Use the default (lenient) mode for everyday checks.

---

## 13. For developers

### Project layout

```
minexind.github.io/
├── package.json          # npm scripts: build, start, serve
├── tsconfig.json         # TypeScript config (NodeNext / ESM)
├── README.md             # Quick-start README
├── docs.md               # Detailed documentation (this file)
├── LICENSE.md            # MIT license
├── src/
│   ├── index.ts          # CLI entry point + argument parsing + serve
│   ├── server.ts         # Express web server (GUI backend + API)
│   ├── engine.ts         # Main compatibility engine
│   ├── analyzer.ts       # Dependency graph analyzer
│   ├── fixer.ts          # Auto-fix / porting engine
│   ├── api.ts            # Spyglass API client
│   ├── tokenizer.ts      # Command line tokenizer
│   ├── walker.ts         # Brigadier command-tree walker
│   ├── json-check.ts     # JSON registry validation
│   ├── json-format-check.ts # Version-aware JSON semantic format checks
│   ├── mcdoc-check.ts    # vanilla-mcdoc structural validator
│   ├── rules.ts          # Single source of truth for all porting knowledge
│   ├── knowledge.ts      # Re-exports from rules.ts (historical compatibility)
│   ├── resource-knowledge.ts # Resource pack rules
│   ├── version.ts        # Version comparison helpers
│   ├── technical-changes.ts # misode/technical-changes fetcher
│   ├── suggest.ts        # Fix suggestions
│   ├── pack-mcmeta.ts    # pack.mcmeta reader (load range only)
│   ├── cache.ts          # Local cache for API data
│   ├── logger.ts         # Structured logger
│   └── types.ts          # Shared TypeScript interfaces
├── web/
│   ├── package.json      # React / Vite dev dependencies
│   ├── vite.config.ts    # Vite config with /api proxy
│   ├── index.html        # Frontend HTML + embedded CSS
│   └── src/
│       ├── main.tsx      # React entry point
│       ├── App.tsx       # Main app component (Check / Fix tabs)
│       ├── api.ts        # Frontend API client + TypeScript types
│       ├── engine/
│       │   ├── engine.ts         # Browser-side compatibility engine
│       │   ├── analyzer.ts       # Dependency graph analyzer
│       │   ├── json-check.ts     # Registry validation
│       │   ├── json-format-check.ts # Format checks
│       │   ├── mcdoc-check.ts    # mcdoc validation
│       │   ├── knowledge.ts      # Knowledge rules
│       │   ├── resource-knowledge.ts # Resource pack rules
│       │   ├── tokenizer.ts      # Command tokenizer
│       │   ├── walker.ts         # Command tree walker
│       │   ├── version.ts        # Version helpers
│       │   ├── pack-mcmeta.ts    # pack.mcmeta reader
│       │   ├── technical-changes.ts # Breaking changes fetcher
│       │   ├── logger.ts         # Logger
│       │   └── types.ts          # Shared types
│       └── components/
│           ├── Results.tsx   # Results display
│           ├── FixPanel.tsx  # Fix/port panel
│           ├── IdePage.tsx   # IDE-like pack editor
│           └── editors/      # Visual mcdoc editors
├── tests/
│   ├── walker.test.ts
│   ├── tokenizer.test.ts
│   ├── pack-mcmeta.test.ts
│   ├── mcdoc.test.ts
│   ├── json-format-check.test.ts
│   ├── analyzer.test.ts
│   ├── spyglass-analyze.test.ts
│   ├── diagnostics.test.ts
│   └── ...
├── web/dist/             # Built frontend (served by `serve` command)
└── dist/                 # Compiled server (after npm run build)
```

### Build and run

```bash
npm install
npm run build
node dist/index.js --dir <datapack> [options]
node dist/index.js serve
```

### Running tests

```bash
npx vitest run              # run all tests
npx vitest watch            # watch mode
npx vitest run tests/<file> # run a specific test file
npx tsc --noEmit            # type check
```

### Adding a knowledge rule

Open `src/rules.ts` and add an entry to `PORT_RULES` (then copy the same entry into `web/src/engine/rules.ts` — the two files must stay byte-identical):

```ts
{
  id: 'my_feature',
  description: 'The /mycommand command was added.',
  type: 'command',          // 'command' | 'command_pattern' | 'registry' | 'json_field' | 'function_macro' | 'resource_path'
  match: 'mycommand',        // root command, regex, registry name, or json field
  since: '1.22',            // minimum Minecraft version
  until: undefined,          // optional: feature removed/changed at this version
  guidance: 'How to port it to older versions.',
  fix: undefined,            // optional structured fix
  note: 'Added in <snapshot>',
}
```

- `type: 'command'` — matches a root command name exactly
- `type: 'command_pattern'` — `match` is a regex tested against the whole command line
- `type: 'registry'` — matches a datapack path or content reference
- `type: 'function_macro'` — matches a regex (e.g. `$(var)` macros)
- `type: 'resource_path'` — resource-pack rule

Rules with a structured `fix` action are auto-fixable: issues matched by them get a green "auto-fix" marker in the CLI and web GUI, and `--fix` can apply the rewrite automatically.

Then rebuild (`npm run build`) and test against a real datapack.

### Data sources

All version data comes from these live sources (fetched at runtime, cached locally):

- **Spyglass API** — command trees and registries:
  - `GET https://api.spyglassmc.com/mcje/versions`
  - `GET https://api.spyglassmc.com/mcje/versions/{id}/commands`
  - `GET https://api.spyglassmc.com/mcje/versions/{id}/registries`
- **vanilla-mcdoc** — structural schemas for 70+ datapack and resource pack types
- **misode/technical-changes** — community-curated breaking-change notes per version

---

*Happy porting!*
