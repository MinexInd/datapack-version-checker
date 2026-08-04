# dpcheck — Minecraft Datapack & Resource Pack Version Checker

**CLI tool to check & auto-fix Minecraft datapack compatibility across versions.**

`dpcheck` validates your datapack or resource pack against *real* Minecraft command trees and registry data — not from `pack.mcmeta` (which is often wrong). It reads what your pack actually does and checks it against each version's definitions.

**Features:**
- Command validation against each version's real Brigadier command tree
- Registry validation (items, blocks, entities, etc.)
- Structural validation against vanilla-mcdoc schemas (70+ datapack types)
- Breaking-change notes from community sources
- Auto-fix / porting between versions
- Resource pack support (models, textures, sounds, blockstates, fonts, shaders)
- Web GUI with drag-and-drop upload
- Dependency graph analysis (orphans, circular deps, broken refs)
- `--summary` flag to separate content issues from outside-load-range issues

---

## Quick Start

### Install

1. Install [Node.js](https://nodejs.org) (LTS version)
2. Download or clone this project
3. Build:

```bash
npm install
npm run build
```

### Run

```bash
# Check a datapack
dpcheck --dir ./my-datapack

# Check specific versions
dpcheck --dir ./my-datapack --versions "1.20.4,1.21,1.21.1"

# Auto-fix to target version
dpcheck --dir ./my-datapack --fix 1.21

# Resource pack mode
dpcheck --dir ./my-resource-pack --mode resourcepack

# Start web GUI
dpcheck serve

# JSON output for scripting
dpcheck --dir ./my-datapack --json > report.json
```

---

## CLI Options

| Option | Description |
|--------|-------------|
| `--dir <path>` | Datapack or resource pack directory (default: current folder) |
| `--versions <v1,v2>` | Check specific versions (space-separated or comma-separated) |
| `--all` | Check all versions including snapshots |
| `--mode <auto\|datapack\|resourcepack>` | Pack type selection (auto-detect by default) |
| `--fix <target>` | Port pack to target version |
| `--from <source>` | Override source version for `--fix` |
| `--output <dir>` | Custom output directory for `--fix` (default: `{pack}_fixed_{version}/`) |
| `--json` | Output as JSON (for scripting/CI) |
| `--summary` | Separate content issues from outside-load-range |
| `--strict` | Stricter command checking (every part must be valid) |
| `--verbose` | Show detailed progress and timing |
| `--diff` | Show before/after code diff for each fix |
| `--debug` | Show all debug messages (very verbose) |
| `--refresh` | Re-download all cached version data |
| `serve` | Start web GUI on localhost:3001 |
| `--help` | Show help |
| `--version` | Show version |

---

## What It Does

### Datapack Mode

1. **Scans `.mcfunction` files** — validates every command against each version's real command tree
2. **Validates JSON files** — checks field values against version registries (items, blocks, biomes, etc.)
3. **Structural validation** — checks JSON structure against vanilla-mcdoc schemas (field names, dispatch type values, since/until version gating)
4. **Version-gated features** — community-curated rules for features like `/random` (1.20.2+), `/item` (1.20.5+), `/dialog` (1.21.6+)
5. **Breaking changes** — shows community notes from [misode/technical-changes](https://github.com/misode/technical-changes)
6. **Dependency graph** — traces cross-file references, detects orphans, broken refs, and circular dependencies

### Resource Pack Mode

Validates `assets/` for:
- **Models** (`models/`) — against mcdoc `model` schema
- **Blockstates** (`blockstates/`) — against `block_definition` schema
- **Item models** (`items/`) — against `item_definition` schema
- **Equipment** (`equipment/`) — against `equipment` schema
- **Sounds** (`sounds.json`) — against `sounds` schema
- **Atlases** (`atlases/`) — against `atlas` schema
- **Particles** (`particles/`) — against `particle` schema
- **Fonts** (`font/`) — against `font` schema
- **Shaders** (`shaders/`) — against `shader` schema
- **Post-process effects** (`shaders/post/`) — against `post_effect` schema
- **Languages** (`lang/`) — against `lang` schema
- **Texture metadata** (`*.png.mcmeta`) — against `texture_meta` schema
- **Waypoint styles** (`waypoint_style/`) — against `waypoint_style` schema

### Auto-Fix Mode (`--fix`)

Ports a pack to a target version:

**Datapack:**
- Rewrites commands that don't exist in target (e.g., `/dialog` → commented note)
- Handles commands inside `/execute run` and `$()` macro expressions
- Converts syntax formats (e.g., `/place feature` → `/placefeature`)
- Removes JSON fields invalid for target version via mcdoc validation
- Fixes advancement icons (post-1.20.5 `ItemStackTemplate` → pre-1.20.5 `{item,nbt}`)
- Updates `pack.mcmeta` `pack_format`
- Skips files whose registry doesn't exist in target version

**Resource pack:**
- Removes JSON fields invalid for target (e.g., `render_type` in models)
- Updates `pack.mcmeta` `resource_pack_format`
- Copies other files (PNG, etc.) unchanged

Fixes are conservative: commands that can't be rewritten are commented out (`## FIXED(...): original command`) rather than deleted. Always test the output in-game.

---

## Report Format

```
⚡ Datapack Version Checker v0.5.0 (content + load-range + structural + breaking changes)
═══════════════════════════════════════════════════════════

📦 Declared load range (pack.mcmeta): 1.19.3 – 1.19.3
📋 Minimum version from content: 1.20.5
🔍 Versions checked: 26
✅ Fully compatible: 0
❌ Breaks / incompatible: 26
```

- **Declared load range** — what `pack.mcmeta` claims
- **Minimum version from content** — the real oldest version the content can run on
- **Fully compatible** — versions where the pack loads with no detected breaks
- **Breaks / incompatible** — versions where something is wrong

With `--summary`, outside-load-range versions are shown separately:

```
  Fully compatible: 26
  Breaks / incompatible: 5
  Outside declared load range: 15
```

---

## Architecture

```
src/
├── index.ts              # CLI entry point, argument parsing, output formatting
├── engine.ts             # Core compatibility checking engine
├── rules.ts              # Single source of truth for all porting knowledge
├── json-check.ts         # Registry validation (FIELD_TO_REGISTRY, TAG_KIND_TO_REGISTRY)
├── mcdoc-check.ts        # Structural validation against vanilla-mcdoc schemas
├── fixer.ts              # Auto-fix/porting engine
├── api.ts                # Spyglass API client with ETag caching
├── cache.ts              # Version data caching
├── knowledge.ts          # Re-exports from rules.ts (historical compatibility)
├── resource-knowledge.ts # Re-exports from rules.ts (historical compatibility)
├── technical-changes.ts  # Misode technical changes data
├── tokenizer.ts          # Command tokenizer
├── walker.ts             # Command tree walker
├── suggest.ts            # Fix suggestions
├── server.ts             # Web server (Express)
├── logger.ts             # Logging
├── types.ts              # TypeScript types
└── version.ts            # Version utilities

web/
├── src/
│   ├── engine/           # Web port (mirrors src/ logic)
│   ├── components/       # React components
│   ├── App.tsx           # Main app (Check / Fix tabs)
│   └── main.tsx          # Entry point
├── index.html
├── vite.config.ts
└── package.json
```

---

## Data Sources

- **Spyglass API** — Command trees and registries (`api.spyglassmc.com/mcje`)
- **vanilla-mcdoc** — Structural schemas for 70+ datapack and resource pack types
- **misode/technical-changes** — Community-curated breaking changes per version
- **Community knowledge** — Porting rules, command rewrites, registry renames (in `rules.ts`)

All data is cached locally for 24 hours. Use `--refresh` to re-download.

---

## Testing

```bash
npm test                    # Run all tests
npm run test:watch          # Watch mode
npm run test:coverage       # Coverage report
npx tsc --noEmit            # Type check
```

---

## License

MIT — see [LICENSE.md](LICENSE.md) for details.
