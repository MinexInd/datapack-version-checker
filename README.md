# Datapack / Resource Pack Version Checker (`dpcheck`)

> Check whether a Minecraft **Java Edition datapack or resource pack** works on a given game version — and find out *exactly what breaks* so you can port it faster.

`dpcheck` looks at the **real content** of your pack (the actual commands, JSON files, models, sounds, textures) and validates it against the real command tree, registries, and mcdoc schemas of each Minecraft version. It also uses a curated list of community-known version changes (the "what people say" layer) — because `pack.mcmeta` is **often wrong** about which versions a pack really supports.

---

## Why this exists

Datapack authors usually only test on one version. When someone asks *"does this work on 1.21.4?"* the honest answer is *"I don't know."* `pack.mcmeta`'s `supported_formats` field is frequently inaccurate or just missing.

This tool answers that question by:

1. Reading your `.mcfunction` files and checking every command against the **real Brigadier command tree** of each version (from the [Spyglass](https://github.com/SpyglassMC/Spyglass) API).
 2. Reading your `.json` files and checking values against each version's **real registries** (entity types, items, biomes, etc.).
 3. **Structurally validating** datapack JSON (`recipe`, `loot_table`, `advancement`, `predicate`, `item_modifier`) against the real [vanilla-mcdoc](https://github.com/SpyglassMC/vanilla-mcdoc) schema, with full `#[since]`/`#[until]` version gating — so it catches things like a `crafting_dye` recipe (added in 26.1), a `random_sequence` loot-table field (added in 1.20), or an advancement `icon` using the post-1.20.5 `ItemStackTemplate` format.
 4. Cross-referencing a **knowledge base** of version changes (e.g. item components need 1.20.5+, `/random` needs 1.20.2, `/dialog` needs 1.21.6).
 5. Reporting which versions **fully work**, which **break**, and **what to change** for each break.

---

## Features

- ✅ **Datapack mode** — scans `data/` for `.mcfunction` commands + `.json` registries
- ✅ **Resource pack mode** — scans `assets/` for models, blockstates, sounds, atlases, particles, fonts, lang, shaders, and textures
- ✅ Auto-detection of pack type (`--mode auto`)
- ✅ Content-based checking (does **not** trust `pack.mcmeta` alone)
- ✅ Real per-version command-tree validation (via Spyglass API)
- ✅ Real per-version registry validation for JSON
- ✅ Real **structural** JSON validation via [vanilla-mcdoc](https://github.com/SpyglassMC/vanilla-mcdoc) — field names, dispatch `type` values, and `#[since]`/`#[until]` version gating for datapack types (`recipe`, `loot_table`, `advancement`, etc.) **and** resource pack types (`model`, `block_definition`, `sounds`, `atlas`, `particle`, `font`, `shader`, `lang`, `texture_meta`, `item_model`, etc.)
- ✅ Community knowledge rules for version-gated features (datapack **and** resource pack)
- ✅ **Registry deprecation detection** — detects registry entries (items, entities, biomes, etc.) that existed in the pack's source version but were REMOVED in the target version
- ✅ Detects when `pack.mcmeta` is **wrong** (e.g. declares 1.19.3 but uses 1.20.5 features)
- ✅ Lists the exact file + line of every break, with a suggested fix
- ✅ Shows **community-curated breaking changes** per version (from [misode/technical-changes](https://github.com/misode/technical-changes)) — so you know what changes when updating to each version
- ✅ **Auto-fix / porting** — `--fix <target>` rewrites commands, converts JSON structures, and updates pack.mcmeta to port your datapack to any target version
- ✅ Works on releases **and** snapshots
- ✅ **Local caching** of all version data (fast re-runs, works offline) with `--refresh` to force re-download
- ✅ JSON output (`--json`) for scripting/CI

---

## Quick start

### 1. Prerequisites

- **Node.js** 18 or newer — download from <https://nodejs.org>
- **Internet access** (the tool downloads version data from the Spyglass API)
- A terminal (PowerShell, Command Prompt, or bash)

Check your Node version:

```bash
node --version
```

### 2. Install / build

```bash
# clone or download this folder, then:
cd datapack-version-checker
npm install      # install TypeScript + Node types
npm run build    # compile TypeScript -> dist/
```

> The compiled program lives in `dist/`. You run it with `node dist/index.js ...`.

### 3. Check a datapack

Point it at a datapack folder (the folder that contains `pack.mcmeta`):

```bash
node dist/index.js --dir "C:\Path\To\Your\Datapack"
```

That's it. The tool prints a report (see [Sample output](#sample-output)).

---

## Usage

```
node dist/index.js [options]
```

| Option | Short | Description |
|--------|-------|-------------|
| `--dir <path>` | `-d` | Path to the pack folder (the one containing `pack.mcmeta`). Default: current directory. |
| `--mode <type>` | | Pack type: `datapack`, `resourcepack`, or `auto` (detect from folder contents). Default: `auto`. |
| `--versions <v1> [v2 ...]` | `-v` | Check **specific** versions, e.g. `-v 1.20.4 1.21 1.21.1`. |
| `--all` | | Check **every** version (releases + snapshots). Slower. |
| `--json` | | Print raw JSON instead of a human report (good for scripts). |
| `--strict` | | Use strict command validation (root **and** every sub-command must exist in the tree). More thorough but reports more false positives on some vanilla quirks. Datapack mode only. |
| `--refresh` | | Re-download all cached version data, including the vanilla-mcdoc schema (otherwise data is reused for 24h). |
| `--fix <version>` | | **Auto-fix mode:** port the datapack to the target version. Detects source version from `pack.mcmeta` (override with `--from`). Rewrites commands, fixes JSON structure, converts advancement icons, updates `pack.mcmeta`. Outputs to `{dir}_fixed_{version}/` (override with `--output`). Datapack mode only. |
| `--from-version <ver>` | `--from` | Explicit source version for fix mode (default: auto-detected from `pack.mcmeta`). |
| `--output <path>` | `-o` | Output directory for fix mode (default: `{dir}_fixed_{version}`). |
| `--help` | `-h` | Show help. |

### Examples

```bash
# Check the current folder
node dist/index.js

# Check a specific datapack against a few versions
node dist/index.js --dir "../real-tests/wither" -v 1.21.9 1.21.10 1.21.11

# Check every version (wide scan)
node dist/index.js --dir "./my-datapack" --all

# Get machine-readable output for a script
node dist/index.js --dir "./my-datapack" --json > report.json

# Auto-fix: port a datapack to 1.21 (auto-detects source from pack.mcmeta)
node dist/index.js --dir "./my-datapack" --fix 1.21

# Auto-fix: port from a specific source version with custom output
node dist/index.js --dir "./my-datapack" --fix 1.20.4 --from-version 1.21 --output ./ported

# Check a resource pack
node dist/index.js --dir "./my-resource-pack" --mode resourcepack

# Check a resource pack against specific versions
node dist/index.js --dir "./my-resource-pack" --mode resourcepack -v 1.21.4 1.21.5 26.1

# Auto-detect pack type (uses data/ for datapack, assets/ for resource pack)
node dist/index.js --dir "./my-pack" --mode auto
```

---

## How to read the report

```
⚡ Datapack Version Checker v0.5.0 (content + load-range + structural + registry deprecation + auto-fix)
══════════════════════════════════════════════════════════

📦 Declared load range (pack.mcmeta): 1.19.3 – 1.19.3
📋 Minimum version from content: 1.20.5
🔍 Versions checked: 26
✅ Fully compatible: 0
❌ Breaks / outside range: 26

⛔ Outside declared load range (won't load): 1.20.5, 1.20.6
```

- **Declared load range** — what `pack.mcmeta` says Minecraft will load.
- **Minimum version from content** — the *actual* oldest version the content can run on, based on the features it uses. If this is **newer** than the declared range, your `pack.mcmeta` is lying.
- **Fully compatible** — versions where the pack both *loads* and has *no detected content breaks*.
- **Outside declared load range** — versions where Minecraft wouldn't even load the pack (the `pack_format` doesn't match).
- **Content breaks** — versions where the pack loads but specific commands/JSON would fail.

Each break lists the **file + line** and a **fix** suggestion:

```
▶ 1.20.4
────────────────────────────────────────────────────────────
    data\aop1\functions\dr.mcfunction:1
      ✗ Uses The /item command (replace/modify) overhaul requires 1.20.5+ — needs >= 1.20.5 but this is 1.20.4
```

At the end, a **"WHY THIS VERSION RANGE"** section explains which community-known features set the minimum version, and a **"KNOWN BREAKING CHANGES BY VERSION"** section lists curated breaking changes for each version you checked (what changes when updating *to* that version).

---

 ## How it works (short version)

 **Datapack mode** (`data/`):
 1. **Scan** all `data/**/*.mcfunction` and `data/**/*.json` files.
 2. **Tokenize** each command line and walk it against the target version's Brigadier command tree (following redirects like `tp` → `teleport`).
 3. **Validate** JSON string values against the target version's registries (entity types, items, etc.), with guards against common false positives.
 4. **Structurally validate** datapack JSON (`recipe`, `loot_table`, `advancement`, `predicate`, `item_modifier`) against the target version's [vanilla-mcdoc](https://github.com/SpyglassMC/vanilla-mcdoc) schema.
 5. **Apply knowledge rules** — a feature that was added in a later version overrides the lenient walker and is reported as a break on older versions.

 **Resource pack mode** (`assets/`):
 1. **Scan** all `assets/**/*.json`, `*.png`, and `*.mcmeta` files.
 2. **Validate** JSON string values against the target version's registries.
 3. **Structurally validate** resource pack JSON (`model`, `block_definition`, `sounds`, `atlas`, `particle`, `font`, `shader`, `lang`, `texture_meta`, `item_model`, etc.) against the target version's mcdoc schema.
 4. **Apply resource knowledge rules** — model features, atlas sources, font provider fields, etc.

 **Both modes:**
 6. **Pull breaking changes** per version from [misode/technical-changes](https://github.com/misode/technical-changes) (community-curated, auto-updating) and show them as informational notes.
 7. **Combine** with `pack.mcmeta`'s load range to decide: loads? breaks? or outside range.

All downloaded data is **cached locally** (24h) so re-runs are fast and work offline; use `--refresh` to force an update.

See [`docs.md`](./docs.md) for the full technical details.

---

## Data source & credits

- Command trees and registries: [Spyglass API](https://api.spyglassmc.com/mcje/) (`api.spyglassmc.com/mcje/versions`).
- Structural JSON schema: [vanilla-mcdoc](https://github.com/SpyglassMC/vanilla-mcdoc) (fetched live as a tarball via the Spyglass dependency loader).
- Breaking-change notes: [misode/technical-changes](https://github.com/misode/technical-changes) (community-curated technical changelogs).
- Version-change knowledge: community datapack-porting experience and the [Minecraft Wiki command history](https://minecraft.wiki/w/Commands).

---

## Limitations

- Command argument-level validation is **lenient by default** (the root command must exist; gaps in sub-commands are tolerated because the Spyglass tree has some holes). Use `--strict` for stricter checks.
- Structural JSON validation covers `recipe`, `loot_table`, `advancement`, `predicate`, and `item_modifier` files. It tolerates mcdoc constructs it can't parse yet (treating them as "allowed"), so it aims to report **real** breaks without false positives rather than exhaustively proving correctness. Tags, dimensions, worldgen, and other JSON types are not deeply validated yet.
- NBT *structure* is not deeply validated yet (only JSON structure via vanilla-mcdoc).
- Registry deprecation detection only fires when checking versions NEWER than the datapack's declared `pack.mcmeta` range. When the source version is unknown (no `pack.mcmeta` range), deprecation detection is skipped.
- The knowledge base covers the most common breaking changes; it is not an exhaustive list of every MC change. Contributions welcome.
- **Auto-fix mode** (`--fix`) rewrites commands and JSON based on known patterns. It is conservative (comments out unavailable commands rather than deleting them). Complex migrations (e.g. `/execute if/unless` subconditions → `/testfor` + conditional) are not automated; the tool tells you what to change, leaving the final logic to you.

---

## License

MIT (see repository for details).
