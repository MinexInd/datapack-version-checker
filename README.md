# datapack-version-checker

CLI tool to check & auto-fix Minecraft datapack compatibility across versions. Content-based validation using actual datapack content (commands, JSON) and community knowledge of version changes — NOT from `pack.mcmeta` (which is often wrong).

## What it does

1. **Command validation** — Scans all `.mcfunction` files and validates every command against each version's real command tree (from Spyglass API)
2. **Registry validation** — Validates all JSON files against each version's registries (items, blocks, entities, etc.)
3. **Structural validation** — Checks JSON structure against vanilla-mcdoc (field names, dispatch type values, and since/until version gating) for recipe, loot_table, advancement, predicate, and item_modifier files
4. **Breaking changes** — Shows community-curated breaking changes per version (misode/technical-changes)
5. **Auto-fix** — Port datapack to a target version by rewriting commands, fixing JSON structure, updating advancement icons, and updating pack.mcmeta
6. **Resource pack mode** — Scan `assets/` for models, textures, sounds, blockstates, particles, fonts, shaders, atlases, and language files

## Usage

```bash
# Check current directory
dpcheck

# Check a specific datapack
dpcheck --dir ./my-datapack

# Check specific versions
dpcheck --versions "1.20.4,1.21,1.21.1"

# Auto-fix to target version
dpcheck --dir ./my-datapack --fix 1.21

# Resource pack mode
dpcheck --dir ./my-resource-pack --mode resourcepack

# JSON output for scripting
dpcheck --dir ./my-datapack --json > report.json

# Start web GUI
dpcheck serve
```

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
├── knowledge.ts          # Historical feature rules (now in rules.ts)
├── resource-knowledge.ts # Historical resource rules (now in rules.ts)
├── technical-changes.ts  # Misode technical changes data
├── tokenizer.ts          # Command tokenizer
├── walker.ts             # JSON walker
├── suggest.ts            # Fix suggestions
├── server.ts             # Web server (Express)
├── logger.ts             # Logging
├── types.ts              # TypeScript types
└── version.ts            # Version utilities

web/
├── src/
│   ├── engine/           # Web port (mirrors src/ logic)
│   ├── components/       # React components
│   ├── App.tsx           # Main app
│   └── main.tsx          # Entry point
├── index.html
├── vite.config.ts
└── package.json
```

### Key concepts

- **`rules.ts`** is the single source of truth for all porting knowledge (commands, registries, resource paths, JSON field renames). Both `src/rules.ts` and `web/src/engine/rules.ts` must stay byte-identical.
- **`json-check.ts`** handles registry validation with `FIELD_TO_REGISTRY` (maps JSON field names to Spyglass registry keys) and `TAG_KIND_TO_REGISTRY` (maps tag kinds to registries).
- **`mcdoc-check.ts`** validates JSON structure against vanilla-mcdoc schemas with since/until version gating.
- **`engine.ts`** orchestrates all checks and computes compatibility results.

### Validation layers

1. **Command rules** — Pattern-based rules matching command syntax (e.g., `/execute rotated` requires 1.19.4+)
2. **Registry checks** — Validate field values against Spyglass registry data
3. **Tag registry checks** — Validate tag members against registries per tag kind
4. **mcdoc structural checks** — Validate JSON structure against vanilla-mcdoc schemas
5. **noise_router structural checks** — Hand-rolled validation for noise_router files (no upstream mcdoc variant)

### Version gating

- `since` — Feature exists from this version (inclusive)
- `until` — Feature removed/changed at this version (exclusive)
- Fields tracked via `allFields` → precise "requires >= X" / "was removed in X" messages
- One-time per-run note for schema-less kinds (no mcdoc definition available)

## Testing

```bash
# Run all tests
npm test

# Run tests in watch mode
npm run test:watch

# Type check
npx tsc --noEmit

# Build
npm run build
```

## Data sources

- **Spyglass API** — `api.spyglassmc.com/mcje/versions|/commands|/registries` (ETag-cached)
- **vanilla-mcdoc** — Structural schemas for recipe, loot_table, advancement, predicate, item_modifier
- **misode/technical-changes** — Community-curated breaking changes per version
- **Community knowledge** — Porting rules, command rewrites, registry renames

## License

ISC
