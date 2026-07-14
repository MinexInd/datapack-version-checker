# Datapack Version Checker (`dpcheck`)

> Check whether a Minecraft **Java Edition datapack** works on a given game version — and find out *exactly what breaks* so you can port it faster.

`dpcheck` looks at the **real content** of your datapack (the actual commands and JSON files) and validates it against the real command tree and registries of each Minecraft version. It also uses a curated list of community-known version changes (the "what people say" layer) — because `pack.mcmeta` is **often wrong** about which versions a datapack really supports.

---

## Why this exists

Datapack authors usually only test on one version. When someone asks *"does this work on 1.21.4?"* the honest answer is *"I don't know."* `pack.mcmeta`'s `supported_formats` field is frequently inaccurate or just missing.

This tool answers that question by:

1. Reading your `.mcfunction` files and checking every command against the **real Brigadier command tree** of each version (from the [Spyglass](https://github.com/SpyglassMC/Spyglass) API).
2. Reading your `.json` files and checking values against each version's **real registries** (entity types, items, biomes, etc.).
3. Cross-referencing a **knowledge base** of version changes (e.g. item components need 1.20.5+, `/random` needs 1.20.2, `/dialog` needs 1.21.6).
4. Reporting which versions **fully work**, which **break**, and **what to change** for each break.

---

## Features

- ✅ Content-based checking (does **not** trust `pack.mcmeta` alone)
- ✅ Real per-version command-tree validation (via Spyglass API)
- ✅ Real per-version registry validation for JSON
- ✅ Community knowledge rules for version-gated features
- ✅ Detects when `pack.mcmeta` is **wrong** (e.g. declares 1.19.3 but uses 1.20.5 features)
- ✅ Lists the exact file + line of every break, with a suggested fix
- ✅ Shows **community-curated breaking changes** per version (from [misode/technical-changes](https://github.com/misode/technical-changes)) — so you know what changes when updating to each version
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
| `--dir <path>` | `-d` | Path to the datapack folder (the one containing `pack.mcmeta`). Default: current directory. |
| `--versions <v1> [v2 ...]` | `-v` | Check **specific** versions, e.g. `-v 1.20.4 1.21 1.21.1`. |
| `--all` | | Check **every** version (releases + snapshots). Slower. |
| `--json` | | Print raw JSON instead of a human report (good for scripts). |
| `--strict` | | Use strict command validation (root **and** every sub-command must exist in the tree). More thorough but reports more false positives on some vanilla quirks. |
| `--refresh` | | Re-download all cached version data (otherwise data is reused for 24h). |
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
```

---

## How to read the report

```
⚡ Datapack Version Checker v0.2.0 (content + load-range)
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

1. **Scan** all `data/**/*.mcfunction` and `data/**/*.json` files.
2. **Tokenize** each command line and walk it against the target version's Brigadier command tree (following redirects like `tp` → `teleport`).
3. **Validate** JSON string values against the target version's registries (entity types, items, etc.), with guards against common false positives.
4. **Apply knowledge rules** — a feature that was added in a later version overrides the lenient walker and is reported as a break on older versions.
5. **Pull breaking changes** per version from [misode/technical-changes](https://github.com/misode/technical-changes) (community-curated, auto-updating) and show them as informational notes.
6. **Combine** with `pack.mcmeta`'s load range to decide: loads? breaks? or outside range?

All downloaded data is **cached locally** (24h) so re-runs are fast and work offline; use `--refresh` to force an update.

See [`docs.md`](./docs.md) for the full technical details.

---

## Data source & credits

- Command trees and registries: [Spyglass API](https://api.spyglassmc.com/mcje/) (`api.spyglassmc.com/mcje/versions`).
- Breaking-change notes: [misode/technical-changes](https://github.com/misode/technical-changes) (community-curated technical changelogs).
- Version-change knowledge: community datapack-porting experience and the [Minecraft Wiki command history](https://minecraft.wiki/w/Commands).

---

## Limitations

- Command argument-level validation is **lenient by default** (the root command must exist; gaps in sub-commands are tolerated because the Spyglass tree has some holes). Use `--strict` for stricter checks.
- NBT *structure* is not deeply validated yet (only item-component syntax and a few known component fields).
- The knowledge base covers the most common breaking changes; it is not an exhaustive list of every MC change. Contributions welcome.

---

## License

MIT (see repository for details).
