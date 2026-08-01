# `dpcheck` — Detailed Documentation

This document explains, step by step, how to install, use, and understand `dpcheck`.
It is written for **beginners** — no programming experience required beyond opening a terminal.

---

## Table of contents

1. [What is a datapack?](#1-what-is-a-datapack)
2. [What problem does dpcheck solve?](#2-what-problem-does-dpcheck-solve)
3. [Installing the tool](#3-installing-the-tool)
4. [Running your first check](#4-running-your-first-check)
5. [Understanding the command options](#5-understanding-the-command-options)
6. [Reading the report](#6-reading-the-report)
7. [Pack analysis (dependency graph)](#7-pack-analysis-dependency-graph)
8. [Worked examples (real datapacks)](#8-worked-examples-real-datapacks)
9. [How the tool actually works](#9-how-the-tool-actually-works)
10. [The knowledge base (version-change rules)](#10-the-knowledge-base-version-change-rules)
11. [Troubleshooting](#11-troubleshooting)
12. [For developers](#12-for-developers)

---

## 1. What is a datapack?

A **datapack** is a folder of files that changes how Minecraft behaves — adding
commands, functions, loot tables, recipes, advancements, and more. A valid
datapack always contains a file named `pack.mcmeta` at its top level:

```
MyDatapack/
├── pack.mcmeta          <-- required, tells Minecraft it's a datapack
├── data/
│   └── mynamespace/
│       ├── functions/
│       │   └── tick.mcfunction
│       ├── advancements/
│       └── loot_tables/
└── ...
```

`dpcheck` reads the files **inside `data/`** (the `.mcfunction` command files
and the `.json` data files) to figure out compatibility.

---

## 2. What problem does dpcheck solve?

Minecraft changes every version. A command that works in 1.21 might not exist
in 1.20. A JSON format that's valid in 1.20.5 might be invalid in 1.20.4.

The usual ways people guess compatibility are unreliable:

- **`pack.mcmeta` `supported_formats`** — authors fill this in by hand and often
  get it wrong, or copy it from another pack.
- **"It works on my version"** — tells you nothing about other versions.

`dpcheck` instead **reads what the datapack actually does** and checks it against
the *real* command and data definitions of each Minecraft version.

---

## 3. Installing the tool

### Step 3.1 — Install Node.js

1. Go to <https://nodejs.org>
2. Download the **LTS** version.
3. Run the installer, accept defaults.
4. Open a terminal and confirm it works:

   ```bash
   node --version
   ```

   You should see something like `v20.11.0` or higher.

### Step 3.2 — Get the project files

Download or clone this project so you have a folder like:

```
datapack-version-checker/
├── package.json
├── tsconfig.json
├── src/
└── ...
```

### Step 3.3 — Install dependencies and build

Open a terminal **in that folder** and run:

```bash
npm install
npm run build
```

- `npm install` downloads TypeScript and the Node type definitions.
- `npm run build` compiles the `src/` TypeScript into runnable JavaScript in `dist/`.

> You only need to run `npm install` once. Re-run `npm run build` after any
> change to the source code.

---

## 4. Running your first check

Find the folder of the datapack you want to test — the one that contains
`pack.mcmeta`. Then run:

```bash
node dist/index.js --dir "C:\Path\To\Your\Datapack"
```

On macOS/Linux, use forward slashes:

```bash
node dist/index.js --dir "/home/you/Downloads/YourDatapack"
```

If you are **already inside** the datapack folder, you can omit `--dir`:

```bash
node dist/index.js
```

The tool will print a compatibility report (see section 6).

---

## 5. Understanding the command options

The basic shape of every command is:

```
node dist/index.js [options]
```

### `--mode` — pack type selection

`dpcheck` supports two pack types. By default (`--mode auto`) it auto-detects:

- **`datapack`** — if `data/` exists and `assets/` doesn't
- **`resourcepack`** — if `assets/` exists and `data/` doesn't
- If **both** exist, it defaults to `datapack` (use `--mode resourcepack` to override)

```bash
# Force resource pack mode
node dist/index.js --dir "./my-resource-pack" --mode resourcepack

# Force datapack mode (override auto-detection)
node dist/index.js --dir "./my-pack" --mode datapack
```

In resource pack mode, the tool scans `assets/` for:
- **Model files** (`models/`) — validated against mcdoc `model` schema
- **Blockstate files** (`blockstates/`) — validated against `block_definition` schema
- **Item model definitions** (`items/`) — validated against `item_definition` schema
- **Equipment definitions** (`equipment/`) — validated against `equipment` schema
- **Waypoint styles** (`waypoint_style/`) — validated against `waypoint_style` schema
- **Sound definitions** (`sounds.json`) — validated against `sounds` schema
- **Atlas definitions** (`atlases/`) — validated against `atlas` schema
- **Particle definitions** (`particles/`) — validated against `particle` schema
- **Font definitions** (`font/`) — validated against `font` schema
- **Shader programs** (`shaders/`) — validated against `shader` schema
- **Post-process effects** (`shaders/post/`) — validated against `post_effect` schema
- **Language files** (`lang/`) — validated against `lang` schema
- **Texture metadata** (`*.png.mcmeta`) — validated against `texture_meta` schema
- **Credits** (`credits.json`) — validated against `credits` schema
- **GPU warnlist** (`gpu_warnlist.json`) — validated against `gpu_warnlist` schema
- **Regional compliancies** (`regional_compliancies.json`) — validated against `regional_compliancies` schema
- **PNG files** — counted and reported, no deep content validation yet

### `--dir` / `-d` — which datapack

```bash
node dist/index.js --dir "C:\Path\To\Datapack"
```

Points the tool at a specific datapack. **Default:** the current folder.

### `--versions` / `-v` — specific versions

Check only the versions you name. You can list them with spaces:

```bash
node dist/index.js --dir "./mydp" -v 1.20.4 1.21 1.21.1 26.1
```

Or comma-separated:

```bash
node dist/index.js --dir "./mydp" -v 1.20.4,1.21,1.21.1
```

Version names follow Minecraft's naming (`1.21.9`, `26.1`, `26.2`, etc.).

### `--all` — scan everything

```bash
node dist/index.js --dir "./mydp" --all
```

Checks **every** known version including snapshots. This downloads a lot of
data and is slower, but gives the widest picture.

### `--json` — machine output

```bash
node dist/index.js --dir "./mydp" --json > report.json
```

Prints the full result as JSON. Useful if you want to process the result with
another script, or feed it into a CI pipeline.

### `--strict` — stricter command checking

```bash
node dist/index.js --dir "./mydp" --strict
```

By default, the tool is **lenient**: a command passes if its *root* command
exists in the version (e.g. `execute` exists). This avoids false errors caused
by small gaps in the command data.

`--strict` requires **every** part of the command to be valid in the tree. It
is more thorough but may report some false positives for vanilla quirks, so use
it when you want to dig deeper.

### `--fix <target-version>` — auto-fix / porting mode

```bash
node dist/index.js --dir "./mydp" --fix 1.21
```

Ports a datapack or resource pack to the target version:

**Datapack mode:**
- Rewrites commands that don't exist in the target version (e.g. `/dialog` → commented out note)
- Handles commands inside `/execute run` and `$()` macro expressions
- Converts between syntax formats (e.g. `/place feature` → `/placefeature`)
- Removes JSON fields invalid for the target version via mcdoc schema validation
- Fixes advancement icons from post-1.20.5 `ItemStackTemplate` format → pre-1.20.5 `{item,nbt}` format
- Updates `pack.mcmeta`'s `pack_format` to match the target version

**Resource pack mode:**
- Removes JSON fields invalid for the target version (e.g. `render_type` in models)
- Updates `pack.mcmeta`'s `resource_pack_format` to match the target version
- Copies all other files (PNG, etc.) unchanged

The source version is **auto-detected from `pack.mcmeta`**. You can override it:

```bash
node dist/index.js --dir "./mydp" --fix 1.20.4 --from-version 1.21
```

Output goes to `{datapack}_fixed_{version}/` by default. Customize with `--output`:

```bash
node dist/index.js --dir "./mydp" --fix 1.20.4 --output "./my-ported-pack"
```

Fixes are **conservative**: commands that can't be rewritten are commented out
(with `## FIXED(...): original command`) rather than deleted. You can review
and manually adjust the output.

**Important: `--fix` is a partial port, not a complete one.** It handles command
syntax changes, JSON field renames/removals, icon format changes, and pack format
updates. It cannot fix game mechanic changes (mob behavior, redstone, world
generation), deep NBT structure changes not covered by mcdoc schemas, or entirely
new features with no old equivalent. Always test the ported pack in-game and
review the `## FIXED(...)` comments for manual attention items.

### `serve` — launch the web GUI

```bash
node dist/index.js serve
```

Opens a local web server (default port **3001**) with a professional dark-themed GUI. Open `http://localhost:3001/` in your browser for a visual interface with:

- **Drag-and-drop** pack upload (folder or `.zip`)
- **Searchable, scrollable version selector** — filter versions by name, ID, or type
- **All check options** — mode, specific versions, all versions, strict mode
- **Full results display** — summary cards, expandable version rows with every issue type (commands, registries, structural/mcdoc, deprecations, breaking changes)
- **Auto-fix/port** — select source + target version; downloads a ported `.zip`
- Knowledge hits and load-range info

### `--help` / `-h`

```bash
node dist/index.js --help
```

Prints the built-in help.

### `--refresh` — force re-download cached data

```bash
node dist/index.js --dir "./mydp" --refresh
```

All version data (command trees, registries, breaking changes) is **cached
locally for 24 hours** so re-runs are fast and work offline. Use `--refresh`
to discard the cache and fetch everything fresh (e.g. right after a new
Minecraft version releases).

## 6. Reading the report

Here is a typical report, annotated:

```
⚡ dpcheck v0.7.0 (content + load-range + structural + semantic format + registry deprecation + auto-fix + analysis)
══════════════════════════════════════════════════════════

📦 Declared load range (pack.mcmeta): 1.19.3 – 1.19.3
📋 Minimum version from content: 1.20.5
🔍 Versions checked: 26
✅ Fully compatible: 0
❌ Breaks / incompatible: 26
```

- **Declared load range** — what `pack.mcmeta` claims. Here it claims only 1.19.3.
- **Minimum version from content** — the *real* oldest version the content can run on.
  Here it's **1.20.5**, which is *newer* than the declared 1.19.3. **That means
  `pack.mcmeta` is wrong.**
- **Versions checked** — how many versions were examined.
- **Fully compatible** — versions where the pack loads *and* has no detected breaks.
- **Breaks / incompatible** — versions where something is wrong.

### Compatible versions

```
✅ Compatible versions: 26.1, 26.1.1, 26.1.2, 26.2
```

These are safe to use.

### Content breaks

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
- **Which version** breaks (1.20.4)
- **Which file and line** (`dr.mcfunction:1`)
- **Why** (uses `/item`, which needs 1.20.5+)
- **What to change** (use `/replaceitem` for older versions)

Every issue carries a **suggestion line** (`→ ...`) taken from the knowledge
base. When the rule behind the issue has a structured auto-fix (a command
rewrite or field rename), the line is tagged `[auto-fixable]` — `--fix` can
apply it automatically. Otherwise it's a manual hint.

### Why this version range

At the bottom, the tool lists the community-known features that set the minimum
version, with example locations:

```
WHY THIS VERSION RANGE (community knowledge):
══════════════════════════════════════════════════════════════
• The /item command (replace/modify) overhaul requires 1.20.5+
    Requires: >= 1.20.5
    Fix: Use /replaceitem (pre-1.20.5) ...
    Found: data\aop1\functions\dr.mcfunction:1
```

---

## 7. Pack analysis (dependency graph)

When you run a check, the tool also builds a **dependency graph** of your pack and shows a summary at the top of the report. This section explains what each part means.

### What it shows

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

### Resource types detected

The tool scans every `.mcfunction` and `.json` file under `data/` and `assets/` and classifies them by path:

| Type | Detected from path |
|------|-------------------|
| `function` | `data/*/functions/` |
| `tag/function`, `tag/block`, `tag/item`, etc. | `data/*/tags/` |
| `advancement` | `data/*/advancements/` |
| `predicate` | `data/*/predicates/` |
| `item_modifier` | `data/*/item_modifiers/` |
| `loot_table` | `data/*/loot_tables/` |
| `recipe` | `data/*/recipes/` |
| `worldgen/biome`, `worldgen/configured_feature`, etc. | `data/*/worldgen/*/` |
| `model` | `assets/*/models/` |
| `texture` | `assets/*/textures/` |
| `blockstate` | `assets/*/blockstates/` |

### Cross-file references

The tool traces how files reference each other:

- **Function calls**: `/function namespace:path` and `/schedule function namespace:path`
- **Predicate refs**: `/execute if|unless predicate namespace:path`
- **Loot table refs**: `/loot namespace:path` and `"loot_table"` keys in JSON
- **Advancement rewards**: `"function"` key in advancement JSON
- **Recipe items**: `"item"` and `"result"` keys in recipe JSON
- **Tag members**: `"values"` array in tag JSON
- **Model parents/textures**: `"parent"` and `"textures"` keys in model JSON

### Orphans

Resources that are defined but **never referenced** by anything else in the pack. Common examples:

- A `.mcfunction` file that no other function calls
- A loot table not referenced by any block, entity, or advancement
- An advancement with no parent or reward chain

**Tags are excluded** from orphan detection because the game loads them by registry name, not by file reference. Vanilla resource references (like `minecraft:iron_ingot`) are also excluded.

Use orphans to find **dead code** — files you might have forgotten to delete or that are no longer needed.

### Broken references

References that point to files **that don't exist** in the pack. For example:

- `function mypack:do_stuff` but the file is `data/mypack/functions/do_stuf.mcfunction`
- A loot table condition referencing `minecraft:random_chance` — this is a **vanilla reference**, not actually broken, but shown because the tool can't resolve it outside the pack

Use broken refs to catch **typos** in function calls and JSON paths.

### Circular dependencies

When function A calls function B, and function B calls function A (directly or through a chain), that's a circular dependency. In-game this causes an **infinite loop** that freezes or crashes Minecraft.

The tool detects cycles of any length and reports the full loop path:
```
data/demo/functions/loop_a.mcfunction → data/demo/functions/loop_b.mcfunction → data/demo/functions/loop_a.mcfunction
```

### Metrics

- **Functions** — total `.mcfunction` files
- **JSON files** — total `.json` data files (non-function, non-texture, non-model)
- **Commands** — total executable command lines across all functions
- **Avg cmds/fn** — average commands per function (rounded)
- **Max exec depth** — deepest `/execute ... run` nesting found
- **Largest function** — the function with the most lines

### Porting plans

When using `--fix <target>`, the tool first generates a **porting plan** showing every rewrite it will perform, plus:

- **Cascade effects** — files that depend on a file being rewritten (so you know the ripple effect)
- **Manual attention items** — features that need a rewrite but no automated rule exists yet
- **Summary** — total actions, auto-fixable count, manual count, files affected

The plan runs before any file is modified, so you can review what will change.

---

## 8. Worked examples (real datapacks)

These are the three datapacks the tool was tested against.

### Example A — Wither Ascension v4

Declared load range: **1.21.10 – 26.2 Snapshot 3**.

```bash
node dist/index.js --dir "../real-tests/wither" -v 1.21.9 1.21.10 1.21.11 26.1 26.1.1 26.1.2 26.2
```

Result: **compatible with 1.21.9, 1.21.10, 1.21.11, 26.1, 26.1.1, 26.1.2**.
The content uses features down to 1.19.4 (`/damage`) but the declared load range
starts at 1.21.10, so older versions fall outside the declared range and aren't
reported as compatible.

### Example B — Infinity Blade

Declared load range: **1.19.3**.

```bash
node dist/index.js --dir "../real-tests/infinity"
```

Result: **0 compatible versions.** The content uses `/item` and `/execute if
items`, which require **1.20.5+**. So `pack.mcmeta` is wrong — the pack actually
needs 1.20.5, not 1.19.3. `dpcheck` caught the mistake.

### Example C — Ultimate DayCounter (26.x)

Declared load range: **26.1 Snapshot 11 – 26.3 Snapshot 1**.

```bash
node dist/index.js --dir "../real-tests/daycounter"
```

Result: **compatible with 26.1, 26.1.1, 26.1.2, 26.2**. The content uses
`/dialog` (1.21.6+), so versions before 1.21.6 are listed as breaking — but all
declared 26.x versions work.

---

## 9. How the tool actually works

All data (command trees, registries, mcdoc schemas, breaking changes) is cached
locally for 24 hours so re-runs are fast and work offline. Use `--refresh` to
force a fresh download.

### Datapack mode

1. **Gather version data.** Fetch the list of Minecraft versions, command trees,
   registries, and vanilla-mcdoc schema from the Spyglass API.

2. **Read the pack.** Scan every `.mcfunction` and `.json` file under `data/`.

3. **Check JSON values.** Validate each JSON string against the version's
   registries (entity types, items, biomes, etc.), with guards against common
   false positives.

4. **Check JSON structure (mcdoc).** Validate each file against the
   [vanilla-mcdoc](https://github.com/SpyglassMC/vanilla-mcdoc) schema for that
   version — field names, dispatch `type` values, and `#[since]`/`#[until]`
   version gating for 70+ datapack types.

5. **Check JSON semantics (integrated into mcdoc).** Version-aware checks for
   predicate field renames (`alternative`/`any_of`, `requirements`/`all_of` in
   1.20), damage boolean flag removal (1.19.4), biome precipitation format
   changes (1.19.4), loot function type requirements (1.17/1.18), and recipe
   result key renames (`item`/`id` in 1.20.5).

6. **Check registry deprecations.** If `pack.mcmeta` declares a source version,
   compare its registries against each target version — report entries that
   were removed.

7. **Check commands.** Tokenize each command line and walk it against the
   version's Brigadier command tree (following redirects like `tp` → `teleport`).

8. **Apply knowledge rules.** Version-gated features (e.g. item components need
   1.20.5+, `/dialog` needs 1.21.6+) override the lenient walker and are
   reported as breaks on older versions. Every reported issue is matched
   against the unified rule base and gets a `suggestion` — the rule's guidance
   text, plus an auto-fix marker when the rule has a structured fix (command
   rewrite, field rename, registry rename). The CLI prints these as `→ ...`
   lines; the web GUI shows them as green (auto-fixable) / amber (manual)
   hints.

9. **Analyze dependency graph.** Build a resource index of all functions, JSON
   files, tags, and models; trace cross-file references (function calls, loot
   table refs, advancement rewards, tag members, model parents, texture refs);
   detect orphans (dead code), broken refs (typos), and circular dependencies
   (A→B→A loops); compute pack metrics.

10. **Pull breaking changes.** Fetch community-curated notes from
    [misode/technical-changes](https://github.com/misode/technical-changes)
    per version and show as informational notes.

11. **Combine with `pack.mcmeta`.** The declared load range tells us which
    versions Minecraft will load the pack on. The content check tells us where
    it breaks.

### Resource pack mode

1. **Read the pack.** Scan every `.json`, `.png`, and `.mcmeta` file under
   `assets/`.

2-3. **Check JSON values + mcdoc.** Same as datapack steps 3-5, but routes
   files to resource-specific types (`model`, `block_definition`, `sounds`,
   `atlas`, `particle`, `font`, `shader`, `lang`, `texture_meta`,
   `item_definition`, `equipment`, `post_effect`, etc.).

4. **Apply resource knowledge rules.** Resource-specific rules for model format
   changes, atlas/palette additions, sound field versioning, font provider
   fields, and more.

5-8. **Same as datapack steps 6-11** (deprecations, knowledge, analyzer,
   breaking changes, `pack.mcmeta`).

### Why `pack.mcmeta` is used but not trusted

- `pack.mcmeta`'s `supported_formats` is the **authoritative "will it load"**
  signal — if the `pack_format` number doesn't match, Minecraft ignores the pack.
- But the **content** decides whether the pack actually *works* once loaded.
- So `dpcheck` uses `pack.mcmeta` for the load range, and uses real content
  analysis to find breaks — including cases where `pack.mcmeta` is too optimistic
  (declares an old version but uses new features).

---

## 10. The knowledge base (version-change rules)

The knowledge base is a curated list in `src/knowledge.ts`. Each rule says:
*"if the datapack uses feature X, it needs at least version Y."*

Examples of rules included:

| Feature | Minimum version |
|---------|-----------------|
| `/random` | 1.20.2 |
| `/damage`, `/ride` | 1.19.4 |
| `/return` | 1.20 |
| `/fillbiome` | 1.19.3 |
| `/tick` | 1.20.3 (debug/admin only) |
| `/transfer` | 1.20.5 |
| Item components `[...]` in `/give` | 1.20.5 |
| `/item` command | 1.20.5 |
| `/execute if items` | 1.20.5 |
| `/bossbar ... players` | 1.20.5 |
| Function macros `$(var)` | 1.20.4 |
| `/return run` | 1.20.4 |
| Custom enchantments registry | 1.21 |
| Custom jukebox songs registry | 1.21 |
| `/test` (game test) | 1.21.4 |
| `minecraft:item_model` component | 1.21.4 |
| Rich `custom_model_data` (floats/flags/strings/colors) | 1.21.4 |
| `minecraft:consumable` component | 1.21.2 |
| `/rotate` | 1.21.2 |
| `wolf_variant` / `pig_variant` registries | 1.21.5 |
| `/version`, `/waypoint`, `/dialog` | 1.21.6 |
| `/fetchprofile` | 1.21.9 |
| `/swing` | 26.1 |
| `/unpublish` | 26.2 |
| `/posteffect` | 26.3 |

This list is **not exhaustive** — Minecraft has hundreds of changes across
versions. New rules are added over time. See section 12 if you want to add your
own.

---

## 11. Troubleshooting

**"Error: No pack.mcmeta found"**
You pointed `--dir` at the wrong folder. Point it at the folder that contains
`pack.mcmeta`.

**GUI shows nothing / blank screen after running a check**
Rebuild with `npm run build` and make sure your browser cache is cleared.

**"Could not fetch command tree" / network errors**
The tool needs internet access to reach `api.spyglassmc.com`. Check your
connection or firewall.

**"command not found: node"**
Node.js is not installed or not on your PATH. Re-install from nodejs.org and
restart your terminal.

**It says a version is compatible but the pack still fails in-game**
The knowledge base and tree don't cover *every* possible change (especially deep
NBT structure). Treat the report as a strong signal, not a 100% guarantee. The
`--strict` flag can surface more potential issues.

**Too many false positives with `--strict`**
That's expected — the underlying command data has small gaps. Use the default
(lenient) mode for everyday checks.

---

## 12. For developers

### Project layout

```
datapack-version-checker/
├── package.json          # npm scripts: build, start, serve
├── tsconfig.json         # TypeScript config (NodeNext / ESM)
├── docs.md               # Detailed documentation
├── README.md             # Quick-start README
├── src/
│   ├── index.ts          # CLI entry point + argument parsing + serve
│   ├── server.ts         # Express web server (GUI backend + API)
│   ├── engine.ts         # Main compatibility engine
│   ├── analyzer.ts       # Dependency graph analyzer (resource index, orphans, circular deps, porting plans)
│   ├── fixer.ts          # Auto-fix / porting engine
│   ├── api.ts            # Spyglass API client
│   ├── tokenizer.ts      # Command line tokenizer
│   ├── walker.ts         # Brigadier command-tree walker
│   ├── json-check.ts     # JSON registry validation
│   ├── json-format-check.ts # Version-aware JSON semantic format checks
│   ├── mcdoc-check.ts    # vanilla-mcdoc structural validator (67+ resource type mappings)
│   ├── knowledge.ts      # Community version-change rules (FEATURE_RULES)
│   ├── resource-knowledge.ts # Resource pack version-change rules (RESOURCE_FEATURE_RULES)
│   ├── version.ts        # Version comparison helpers
│   ├── technical-changes.ts # misode/technical-changes fetcher
│   ├── pack-mcmeta.ts    # pack.mcmeta reader (load range only)
│   ├── cache.ts          # Local cache for API data
│   ├── logger.ts         # Structured logger (stderr-based, level-configurable)
│   └── types.ts          # Shared TypeScript interfaces
├── web/
│   ├── package.json      # React / Vite dev dependencies
│   ├── vite.config.ts    # Vite config with /api proxy
│   ├── index.html        # Frontend HTML + embedded CSS
│   └── src/
│       ├── main.tsx      # React entry point
│       ├── App.tsx       # Main app component (tabs, file upload, version picker)
│       ├── api.ts        # Frontend API client + TypeScript types
│       ├── engine/
│       │   ├── engine.ts         # Browser-side compatibility engine
│       │   ├── analyzer.ts       # Dependency graph analyzer (browser-compatible)
│       │   ├── json-check.ts     # Registry validation (browser-compatible)
│       │   ├── json-format-check.ts # Format checks (browser-compatible)
│       │   ├── mcdoc-check.ts    # mcdoc validation (browser-compatible)
│       │   ├── knowledge.ts      # Knowledge rules (browser-compatible)
│       │   ├── resource-knowledge.ts # Resource pack rules (browser-compatible)
│       │   ├── tokenizer.ts      # Command tokenizer (browser-compatible)
│       │   ├── walker.ts         # Command tree walker (browser-compatible)
│       │   ├── version.ts        # Version helpers (browser-compatible)
│       │   ├── pack-mcmeta.ts    # pack.mcmeta reader (browser-compatible)
│       │   ├── technical-changes.ts # Breaking changes fetcher (browser-compatible)
│       │   ├── logger.ts         # Logger (browser-compatible)
│       │   └── types.ts          # Shared types (browser-compatible)
│       └── components/
│           └── Results.tsx  # Results display (version rows, issues, knowledge, analysis section)
├── tests/
│   ├── walker.test.ts          # Command walker tests
│   ├── tokenizer.test.ts       # Tokenizer tests
│   ├── pack-mcmeta.test.ts     # pack.mcmeta reader tests
│   ├── mcdoc.test.ts           # mcdoc validation tests
│   ├── json-format-check.test.ts # Semantic format check tests
│   └── analyzer.test.ts        # Dependency graph analyzer tests
├── web/dist/             # Built frontend (served by `serve` command)
└── dist/                 # Compiled server (after npm run build)
```

### Build & run

```bash
npm install
npm run build
node dist/index.js --dir <datapack> [options]
```

### Running tests

```bash
npx vitest run        # run all tests
npx vitest watch      # run in watch mode
npx vitest run tests/analyzer.test.ts  # run a specific test file
```

### Adding a knowledge rule

Open `src/knowledge.ts` and add an entry to `FEATURE_RULES`:

```ts
{
  id: 'my_feature',
  description: 'The /mycommand command was added.',
  type: 'command',          // 'command' | 'command_pattern' | 'registry' | 'json_field' | 'function_macro'
  match: 'mycommand',        // root command, regex, registry name, or json field
  minVersion: '1.22',        // minimum Minecraft version
  fix: 'How to port it to older versions.',
  note: 'Added in <snapshot>',
},
```

- `type: 'command'` — matches a root command name exactly.
- `type: 'command_pattern'` — `match` is a regular expression tested against the
  whole command line (good for sub-commands like `/execute if items`).
- `type: 'registry'` — matches a datapack path or content reference (e.g.
  `enchantment/foo.json`).
- `type: 'function_macro'` — matches a regex (e.g. `$(var)` macros).

Then rebuild (`npm run build`) and test against a real datapack.

### Data source

All version data comes from these live sources (fetched at runtime, cached locally):

- **Spyglass API** — command trees and registries:
  - `GET https://api.spyglassmc.com/mcje/versions`
  - `GET https://api.spyglassmc.com/mcje/versions/{id}/commands`
  - `GET https://api.spyglassmc.com/mcje/versions/{id}/registries`
- **misode/technical-changes** — community-curated breaking-change notes per version
  (fetched via the GitHub API tree + raw markdown files, filtered by the `breaking` tag).

---

*Happy porting!*
