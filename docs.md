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
7. [Worked examples (real datapacks)](#7-worked-examples-real-datapacks)
8. [How the tool actually works](#8-how-the-tool-actually-works)
9. [The knowledge base (version-change rules)](#9-the-knowledge-base-version-change-rules)
10. [Troubleshooting](#10-troubleshooting)
11. [For developers](#11-for-developers)

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

Ports the datapack to the target version by:
- Rewriting commands that don't exist in the target version (e.g. `/dialog` → commented out note)
- Converting between syntax formats (e.g. `/place feature` → `/placefeature`)
- Fixing JSON structure (e.g. advancement icons from post-1.20.5 `ItemStackTemplate` format → pre-1.20.5 `{item,nbt}` format)
- Updating `pack.mcmeta`'s `pack_format` to match the target version

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

---

---

## 6. Reading the report

Here is a typical report, annotated:

```
⚡ Datapack Version Checker v0.4.0 (content + load-range + structural + auto-fix)
══════════════════════════════════════════════════════════

📦 Declared load range (pack.mcmeta): 1.19.3 – 1.19.3
📋 Minimum version from content: 1.20.5
🔍 Versions checked: 26
✅ Fully compatible: 0
❌ Breaks / outside range: 26
```

- **Declared load range** — what `pack.mcmeta` claims. Here it claims only 1.19.3.
- **Minimum version from content** — the *real* oldest version the content can run on.
  Here it's **1.20.5**, which is *newer* than the declared 1.19.3. **That means
  `pack.mcmeta` is wrong.**
- **Versions checked** — how many versions were examined.
- **Fully compatible** — versions where the pack loads *and* has no detected breaks.
- **Breaks / outside range** — versions where something is wrong.

### Compatible versions

```
✅ Compatible versions: 26.1, 26.1.1, 26.1.2, 26.2
```

These are safe to use.

### Outside declared load range

```
⛔ Outside declared load range (won't load): 1.20.5, 1.20.6
```

Minecraft would refuse to load the pack on these versions because the
`pack_format` number in `pack.mcmeta` doesn't match. (Even if the content would
technically work, the game won't enable the pack.)

### Content breaks

```
❌ CONTENT BREAKS ON THESE VERSIONS
▶ 1.20.4
────────────────────────────────────────────────────────────
    data\aop1\functions\dr.mcfunction:1
      ✗ Uses The /item command (replace/modify) overhaul requires 1.20.5+
        — needs >= 1.20.5 but this is 1.20.4
```

This tells you:
- **Which version** breaks (1.20.4)
- **Which file and line** (`dr.mcfunction:1`)
- **Why** (uses `/item`, which needs 1.20.5+)
- **What to change** (use `/replaceitem` for older versions)

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

## 7. Worked examples (real datapacks)

These are the three datapacks the tool was tested against.

### Example A — Wither Ascension v4

Declared load range: **1.21.10 – 26.2 Snapshot 3**.

```bash
node dist/index.js --dir "../real-tests/wither" -v 1.21.9 1.21.10 1.21.11 26.1 26.1.1 26.1.2 26.2
```

Result: **compatible with 1.21.9, 1.21.10, 1.21.11, 26.1, 26.1.1, 26.1.2**.
The content uses features down to 1.19.4 (`/damage`) but the declared load range
starts at 1.21.10, so older versions are outside the load range.

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

## 8. How the tool actually works

In plain terms:

1. **Gather version data.** It asks the Spyglass API for the list of Minecraft
   versions, and for each version it can fetch the **command tree** (the full
   list of valid commands and their arguments) and the **registries** (lists of
   valid entity types, items, biomes, etc.).

2. **Read your datapack.** It scans every `.mcfunction` file and every `.json`
   file under `data/`.

3. **Check commands.** For each command line, it splits the command into tokens
   and "walks" down the version's command tree to see if the command is valid in
   that version. It follows redirects (for example `tp` is really `teleport`),
   handles greedy arguments, and tolerates small tree gaps (lenient mode).

 4. **Check JSON (values).** For each JSON value, it checks whether the string is a
    valid entry in that version's registries (e.g. an entity type like `minecraft:pig`).
    It has guards to avoid false positives (for example `this` is a selector
    keyword, not an entity type).

  4b. **Check JSON (registry deprecations).** When a datapack's `pack.mcmeta` declares
     a source version range, the tool also fetches the **source version's registries**
     and compares them against each target version's registries. If an entry (item,
     entity type, biome, etc.) exists in the source but was REMOVED from the target,
     it's reported as a **registry deprecation** — meaning the datapack uses something
     that used to exist but no longer does.

  4c. **Check JSON (structure).** For datapack JSON of type `recipe`, `loot_table`,
    `advancement`, `predicate`, and `item_modifier`, the tool validates the file's
    **structure** against the official [vanilla-mcdoc](https://github.com/SpyglassMC/vanilla-mcdoc)
    schema for that exact version. The full mcdoc schema is downloaded live (as a
    tarball) from Spyglass and cached. For each version it:

    - confirms that top-level and nested **field names** actually exist in that
      version (e.g. a loot table `random_sequence` field only exists since 1.20);
    - confirms that **dispatch `type` values** are valid for that version (e.g. a
      `minecraft:crafting_dye` recipe only exists since 26.1, and an advancement
      `icon` using the `ItemStackTemplate` format only works since 1.20.5);
    - respects every `#[since]` / `#[until]` version gate in the schema.

    The parser is deliberately tolerant: mcdoc constructs it can't fully parse are
    treated as "allowed", so the tool reports **real** breaks rather than
    fabricating false positives.

 5. **Apply knowledge rules.** Some features are version-gated in ways the tree
    alone doesn't show (e.g. item components need 1.20.5). A curated rule list
    (**the knowledge base**) overrides the lenient walker and reports these as
    breaks on older versions.

6. **Pull breaking changes.** For each version checked, the tool fetches
    community-curated breaking changes from
    [misode/technical-changes](https://github.com/misode/technical-changes)
    (tagged `breaking`) and shows them as informational notes — telling you what
    changes when updating *to* that version. This data is maintained by the
    community and updates automatically; no code change is needed for new
    Minecraft versions.

7. **Combine with `pack.mcmeta`.** The declared load range tells us which
    versions Minecraft will even *load* the pack on. The content check tells us
    where it would *break*. Together they produce the final verdict.

8. **Cache everything.** Command trees, registries, and breaking changes are
    cached locally for 24 hours (in your system temp dir). Re-runs are fast and
    work offline. Use `--refresh` to force a fresh download.

### Why `pack.mcmeta` is used but not trusted

- `pack.mcmeta`'s `supported_formats` is the **authoritative "will it load"**
  signal — if the `pack_format` number doesn't match, Minecraft ignores the pack.
- But the **content** decides whether the pack actually *works* once loaded.
- So `dpcheck` uses `pack.mcmeta` for the load range, and uses real content
  analysis to find breaks — including cases where `pack.mcmeta` is too optimistic
  (declares an old version but uses new features).

---

## 9. The knowledge base (version-change rules)

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
versions. New rules are added over time. See section 11 if you want to add your
own.

---

## 10. Troubleshooting

**"Error: No pack.mcmeta found"**
You pointed `--dir` at the wrong folder. Point it at the folder that contains
`pack.mcmeta`.

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

## 11. For developers

### Project layout

```
datapack-version-checker/
├── package.json          # npm scripts: build, start
├── tsconfig.json         # TypeScript config (NodeNext / ESM)
├── src/
│   ├── index.ts          # CLI entry point + argument parsing
│   ├── engine.ts         # Main compatibility engine
│   ├── fixer.ts          # Auto-fix / porting engine
│   ├── api.ts            # Spyglass API client
│   ├── tokenizer.ts      # Command line tokenizer
│   ├── walker.ts         # Brigadier command-tree walker
│   ├── json-check.ts     # JSON registry validation
│   ├── mcdoc-check.ts    # vanilla-mcdoc structural validator
│   ├── knowledge.ts      # Community version-change rules (FEATURE_RULES)
│   ├── version.ts        # Version comparison helpers
│   ├── technical-changes.ts # misode/technical-changes fetcher
│   ├── pack-mcmeta.ts    # pack.mcmeta reader (load range only)
│   ├── cache.ts          # Local cache for API data
│   └── types.ts          # Shared TypeScript interfaces
└── dist/                 # Compiled output (after npm run build)
```

### Build & run

```bash
npm install
npm run build
node dist/index.js --dir <datapack> [options]
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
