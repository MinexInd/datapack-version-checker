# Minex Datapack Checker

![Node.js](https://img.shields.io/badge/Node.js-18%2B-green)
![License](https://img.shields.io/badge/License-MIT-blue)
![Platform](https://img.shields.io/badge/Platform-Windows%20%7C%20macOS%20%7C%20Linux-lightgrey)

**Check Minecraft datapack compatibility across versions — with a visual editor, CLI, and auto-fix.**

Minex Datapack Checker reads your datapack's actual content (commands, JSON files, functions) and checks it against real Minecraft version data. It tells you exactly which versions work, which break, and why — then can auto-fix many issues for you.

🌐 **Web GUI:** `http://localhost:3001`  
⌨️ **CLI tool:** `node dist/index.js --dir ./your-datapack`

---

## What this tool does

Minecraft changes every update. A command that works in 1.21 might not exist in 1.20. A JSON format valid in 1.20.5 could be invalid in 1.20.4.

Most authors guess compatibility using `pack.mcmeta`, but that file is often wrong. This tool **reads what your datapack actually does** and checks it against the real command trees and data definitions of each Minecraft version.

### Two ways to use it

| Mode | Best for | How to start |
|------|----------|--------------|
| **Web GUI** | Visual editing, drag-and-drop upload, browsing results | `node dist/index.js serve` → open `http://localhost:3001` |
| **CLI** | Scripts, CI/CD, terminal users, quick checks | `node dist/index.js --dir ./my-datapack` |

Both modes use the same engine and produce the same results.

---

## Quick start

### 1. Install Node.js

Download the **LTS** version from [nodejs.org](https://nodejs.org). Run the installer and accept defaults.

Verify it works:

```bash
node --version
# Expected: v20.x or higher
```

### 2. Get the project

```bash
git clone https://github.com/MinexInd/minexind.github.io.git
cd minexind.github.io
```

### 3. Install and build

```bash
npm install
npm run build
```

> `npm install` downloads dependencies once. Re-run `npm run build` after any code changes.

---

## Using the Web GUI

Start the local server:

```bash
node dist/index.js serve
```

Open your browser to **`http://localhost:3001`**.

You'll see a dark-themed IDE-like interface with:

- **Drag-and-drop** pack upload (folder or `.zip`)
- **Version selector** — searchable, scrollable list of Minecraft versions
- **Check tab** — run compatibility analysis with options
- **Fix tab** — select source and target versions, preview changes, download ported `.zip`
- **Problems panel** — grouped issues with line numbers and suggestions
- **Visual JSON editor** — form-based editing for recipes, loot tables, predicates, and advancements (powered by live mcdoc schemas)

### Web GUI features

| Feature | Description |
|---------|-------------|
| Drag-and-drop upload | Drop a folder or `.zip` directly into the browser |
| Version picker | Filter by version name, ID, or type (release, snapshot) |
| Whole-pack analysis | Analyze every file in the pack at once |
| Fix preview | See exactly what will change before downloading |
| Visual forms | Edit structured JSON (recipes, loot tables, etc.) with auto-complete |
| Monaco editor | Raw JSON editing with syntax highlighting |
| Problems panel | Grouped issues with file, line, severity, and fix suggestions |
| Output log | Timestamped progress and results |

---

## Using the CLI

### Basic check

```bash
# Check a datapack (auto-detects pack type)
node dist/index.js --dir "./my-datapack"

# Check specific versions
node dist/index.js --dir "./my-datapack" --versions "1.20.4,1.21,1.21.1"

# Check ALL versions including snapshots (slower)
node dist/index.js --dir "./my-datapack" --all

# Resource pack mode
node dist/index.js --dir "./my-resource-pack" --mode resourcepack
```

### Auto-fix (porting)

```bash
# Port a datapack to 1.21
node dist/index.js --dir "./my-datapack" --fix 1.21

# Port from a specific source version
node dist/index.js --dir "./my-datapack" --fix 1.21 --from 1.20.4

# Custom output directory
node dist/index.js --dir "./my-datapack" --fix 1.21 --output "./ported-pack"

# Preview changes before applying
node dist/index.js --dir "./my-datapack" --fix 1.21 --diff
```

### Other useful commands

```bash
# JSON output for scripts and CI
node dist/index.js --dir "./my-datapack" --json > report.json

# Summary mode (separates content issues from load-range issues)
node dist/index.js --dir "./my-datapack" --summary

# Verbose progress
node dist/index.js --dir "./my-datapack" --verbose

# Force refresh cached data
node dist/index.js --dir "./my-datapack" --refresh
```

---

## CLI reference

| Option | Description |
|--------|-------------|
| `--dir <path>` | Datapack or resource pack folder (default: current folder) |
| `--versions <v1,v2>` | Check specific versions (comma or space separated) |
| `--all` | Check every known version including snapshots |
| `--mode <auto\|datapack\|resourcepack>` | Pack type (auto-detected by default) |
| `--fix <target>` | Auto-port pack to target version |
| `--from <source>` | Override source version for `--fix` |
| `--output <dir>` | Output folder for `--fix` (default: `{pack}_fixed_{version}/`) |
| `--json` | Output as JSON for scripting |
| `--summary` | Show content issues and load-range issues separately |
| `--strict` | Stricter command checking (fewer false positives, but may flag more) |
| `--diff` | Show before/after diff for each fix |
| `--verbose` | Detailed progress and timing |
| `--debug` | Very verbose internal messages |
| `--refresh` | Re-download cached version data |
| `serve` | Start the web GUI on `localhost:3001` |

---

## What it checks

### Datapack mode

1. **Commands** — every `.mcfunction` line validated against real Brigadier command trees
2. **Registry values** — JSON strings checked against version registries (items, blocks, entities, etc.)
3. **JSON structure** — field names, types, and dispatch values validated against vanilla schemas
4. **Version-gated features** — `/item` (1.20.5+), `/dialog` (1.21.6+), etc.
5. **Breaking changes** — community notes from [misode/technical-changes](https://github.com/misode/technical-changes)
6. **Dependency graph** — orphans, broken references, circular dependencies

### Resource pack mode

Validates `assets/` files against schemas for:

- Models, blockstates, item models
- Equipment definitions
- Sounds, atlases, particles
- Fonts, shaders, post-process effects
- Languages, texture metadata
- And more (70+ schema types)

### Auto-fix capabilities

The tool can automatically:

- Rewrite commands removed in target versions
- Convert syntax formats (e.g., `/place feature` → `/placefeature`)
- Remove invalid JSON fields
- Fix advancement icon formats (pre/post 1.20.5)
- Update `pack.mcmeta` pack format numbers

> **Conservative by design:** commands that can't be rewritten are commented out (`## FIXED(...): original command`) rather than deleted. Always test the output in-game.

---

## Example output

```
⚡ Minex Datapack Checker v0.5.0
═══════════════════════════════════════════════════════════

📦 Declared load range (pack.mcmeta): 1.19.3 – 1.19.3
📋 Minimum version from content: 1.20.5
🔍 Versions checked: 26
✅ Fully compatible: 0
❌ Breaks / incompatible: 26

WHY THIS VERSION RANGE (community knowledge):
═══════════════════════════════════════════════════════════════
• The /item command (replace/modify) overhaul requires 1.20.5+
    Requires: >= 1.20.5
    Fix: Use /replaceitem (pre-1.20.5)
    Found: data\aop1\functions\dr.mcfunction:1
```

### With `--summary`

```
✅ Fully compatible: 26
❌ Breaks / incompatible: 5
  Outside declared load range: 15
```

The "Outside declared load range" line shows versions where the pack would load but uses newer features. These aren't bugs — just outside the author's declared range.

---

## Data sources

All data is fetched from authoritative sources and cached for 24 hours:

| Source | What it provides |
|--------|-----------------|
| **Spyglass API** | Command trees and registries for every Minecraft version |
| **vanilla-mcdoc** | Structural schemas for 70+ datapack and resource pack types |
| **misode/technical-changes** | Community-curated breaking-change notes per version |
| **Built-in knowledge base** | Porting rules, command rewrites, registry renames |

Use `--refresh` to re-download everything.

---

## Live site

The web GUI is deployed at: **`https://minexind.github.io/`**

The `gh-pages` branch contains the built frontend. The `master` branch contains the full source (CLI + web).

---

## Testing

```bash
npx vitest run          # Run all tests
npx vitest watch        # Watch mode
npx vitest run tests/<file>  # Run a specific test file
npx tsc --noEmit        # Type check
```

---

## License

MIT — see [LICENSE.md](LICENSE.md) for details.

---

## Contributing

See [`docs.md`](docs.md) for developer documentation, project layout, and how to add new knowledge rules.
