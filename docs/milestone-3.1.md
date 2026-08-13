# Milestone 3.1 — Visual mcdoc editing (status)

Goal: schema-driven forms without bespoke editors for every JSON format. One
generic renderer over a simplified mcdoc type tree.

## Done (all lanes, commit pending)

- `web/src/ide/mcdoc-edit.ts` — dependency-free pure engine:
  - `SimplifiedMcdocType` model (struct/union/list/tuple/enum/literal/map/primitive) with `since`/`until` and `registry` hints on primitives.
  - Version gating: `compareVersions`, `typeVisibleAt`.
  - Path safety: `isJsonPointerSafe`; immutable JSON-pointer reads/writes on plain values:
    `getAtPath`, `setAtPath` (creates ancestor containers), `removeAtPath`,
    `insertInList`, `moveListItem`. No input is ever mutated.
  - Schema defaults: `defaultValue` / `defaultForField` (required-only, union picks
    first non-literal, primitive/bool/int/string/map defaults).
  - Union preservation: `selectUnionOption` maps a plain JSON value back to the
    representative union branch so edits are not lost on branch switches; struct
    branches are scored by value-key overlap so `{"id":...}` picks the item
    stack branch, not the first index tie.
  - Type walking: `typeAtPath` descends the type tree following the same path as
    the JSON value.
  - Serialization: `serializeJson` (indented, trailing newline, pack-file style)
    and `serializeNode` (one node, byte-stable write-back).
- `web/src/ide/json-ranges.ts` — byte-preserving write-back: `parseWithRanges`
  (full string-escape handling), `findNodeRange`, `replaceNode`, `writeBack`
  (in-place node splice when the path exists, whole-document serialize fallback).
- `web/src/engine/type-bridge.ts` — `spyglassTypeToEngine` converts the checker's
  attached simplified types into the engine model; `resolveDynamicTypes` resolves
  the references/dispatchers the checker's shallow simplify leaves in struct
  fields (via the checker's own `simplify` against the project symbol table);
  single-dynamic-key structs collapse to the engine `map` kind (recipe "key");
  `#[id]` registry hints extracted with the `minecraft:` namespace stripped.
  **Bug fixed:** nested types (struct fields, map values, list items) went
  through the no-union converter and degraded to `unknown`; they now use the
  full union-aware path.
- `web/src/engine/spyglass-service.ts` — `getSimplifiedRootType(path)` resolves
  the mcdoc schema for an open JSON file. **Bug fixed:** `mcdoc.initialize` was
  missing from the project initializers, so the vanilla-mcdoc dependency's
  `.mcdoc` files were never bound, every dispatcher lookup failed, and all JSON
  validation silently degraded to `any`. JSON files now get real schemas and
  real markers.
- `web/src/components/editors/McdocEditor.tsx` + `mcdoc-editor-logic.ts` —
  recursive field renderer (add/remove, list reorder/duplicate, enum selectors,
  version-gated hints, invalid-JSON banner, resolving state, Monaco JSON toggle);
  300ms debounced commits through `writeBack`.
- `web/src/ide/presets.ts` — `fetchRecipeIds` / `fetchRecipePreset` from the
  versioned misode mcmeta CDN (`https://cdn.jsdelivr.net/gh/misode/mcmeta@{version}-summary/data/recipe/data.min.json`),
  in-memory per-version cache, graceful `[]`/`null` on failure.
- `web/src/components/IdePage.tsx` — recipe files (`data/*/recipe/*.json`, any
  namespace, any depth under `recipe/` — real packs nest e.g. `recipe/blocks/bulk/...`) dispatch to McdocEditor with async type resolution + loading state;
  "Load preset" dropdown above the editor (both form and JSON views), version
  mapped from the selector ('Auto' → latest known; CDN tag uses the version
  *id* — `26.3-snapshot-7` — not the display name); Show Form/JSON toggle mirrors
  the pack.mcmeta pattern; Monaco fallback when the type resolves to null.
  **Two races fixed:** the checker attaches a per-recipe-type struct (shaped =
  pattern/key, shapeless = ingredients), so a `recipeDiscriminator` memo
  (JSON `type` value) re-resolves the schema when a preset switches shaped ->
  shapeless; and the mcdoc schema loads lazily on first bind, so the resolver
  re-parses (with a cancel flag) until the checker attaches a `typeDef` instead
  of giving up on the first type-less node.
- Tests (100 across the 7 3.1 suites + 73 elsewhere, all green;
  `npx tsc --noEmit` clean):
  - `mcdoc-edit.test.ts` (18), `json-ranges.test.ts` (33), `type-bridge.test.ts`
    (13), `mcdoc-editor.test.ts` (17), `presets.test.ts` (11),
    `spyglass-service.test.ts` (4, incl. real recipe schema resolution),
    `editor-roundtrip.test.ts` (5, byte-identity round trips through the real
    service: existing-node edits byte-preserving, add-field re-serialization,
    map edits, invalid JSON, unknown-file null).
- Browser smoke (Playwright, steps 1-8 green): pack load -> recipe form renders
  -> count edit round-trips byte-preserving (minified `"count":2`) -> form
  reflects the edit after JSON toggle -> preset `acacia_button` (shapeless)
  loads and the form re-renders with ingredients + item-stack result branch ->
  clean console. Debug artifacts (`dump-*` tests, smoke scripts) removed.

## Note on Milestone 1 gate
plan.md gates 3.1 on Milestone 1's data-loss/async-race gates. M1 is committed
(snapshot + stale-result guards + draft persistence); Item 3 (file-lifecycle
unit/component tests + undo + rename/delete reference awareness) is still open.
The pure engine here does not depend on it.

## Next increments
- 3.2 loot table, 3.3 predicate, 3.4 advancement: the bridge is generic — the
  same `getSimplifiedRootType` path works for any `minecraft:resource` category;
  each milestone widens the IdePage dispatch gate and adds category-specific
  presets.
- Registry dropdowns: `primitive.registry` hints are already carried by the
  bridge; wire `fetchRegistries(version)` into McdocEditor's string inputs.

## Dev
- `web: npm run dev` → http://localhost:5173/ (route `/datapack-editor`).
- Tests: `web: npx vitest run <file>`; typecheck: `cd web && npx tsc --noEmit`.