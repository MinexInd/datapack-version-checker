# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Minecraft Java Edition datapack creators (hobbyist to advanced) who need to know whether their pack works across Minecraft versions and want a browser-based editing environment without installing an IDE. Inferred from the existing tool's audience and the confirmed MinexStudio direction.

## Product Purpose

MinexStudio is a browser-based studio for Minecraft datapacks: create, edit, and analyze datapacks entirely in the browser. The current shipped capability is version-compatibility analysis — upload a pack, select Minecraft versions, and get a precise issue report (command syntax, registries, mcdoc structure, breaking changes) powered by the real SpyglassMC parser. The confirmed evolution adds a Monaco-based editor inside a "Datapack Editor" IDE with Spyglass language services (autocomplete, live errors, semantic highlighting, hover, go-to-definition), all version-aware. The whole product is client-side and free, deployed on GitHub Pages with no backend.

## Positioning

Version-aware intelligence with a real parser, in the browser, with no setup: MinexStudio runs the actual SpyglassMC parser and full version registry data client-side, so completion, diagnostics, and compatibility reports are correct per Minecraft version. A neighboring tool could copy the layout but not the client-side Spyglass pipeline, the per-version registry coverage, and the zero-install browser workflow.

## Operating Context

Users work in a desktop or laptop browser. Workflows confirmed in the existing app: drag-and-drop a datapack folder or .zip (File System Access API + JSZip), select target Minecraft versions, run a check, review version-grouped issue reports, preview and download auto-fixes as a new .zip. The IDE adds: file explorer sidebar, open tabs, Monaco editing, and an Analyze panel reusing the existing checker. Data is cached in IndexedDB (version registry, command trees, parser results) so repeat checks are fast. COOP/COEP headers are already set for SharedArrayBuffer support (Spyglass).

## Capabilities and Constraints

- Runs entirely in the browser; no backend, no account, no telemetry. Deployed to GitHub Pages (`base: './'`).
- Real SpyglassMC parser (@spyglassmc/core + java-edition + mcfunction + json + nbt + mcdoc, pinned versions) running client-side.
- Existing check pipeline (9 check types): command syntax walker, knowledge rules, registry existence/deprecation, mcdoc structural, cross-file references, breaking changes, pack format/load range, plus the Spyglass parser lane.
- Version range: datapacks 1.13 → 26.2 (and snapshots).
- Existing components: PackSelector, VersionSelector, CheckPanel, Results, FixPanel.
- Auto-fix: command rewrites, JSON fixes, registry fixes, NBT→component rewrites, mcdoc structural fixes; produces a downloadable zip.
- Constraints: Monaco (~5MB) must lazy-load so the hub stays fast; browser-only engine (no Node deps in `web/src/engine/`); Vite + React 19 + TS strict; plain CSS with CSS custom properties (no Tailwind); current bundle ~1.1MB.
- Undecided: exact hub content beyond the confirmed tool cards (Datapack Editor active; Resourcepack Studio + other tools "coming soon"); whether users edit existing packs from disk or create blank projects first in the IDE.

## Brand Commitments

- Product name: **MinexStudio**. Hub page shows the MinexStudio identity with tool cards; the Datapack Editor card opens the IDE, the Resourcepack card is a "coming soon" placeholder, and more tools are planned.
- The existing "Datapack Version Checker" becomes the **Analyze** panel inside the Datapack Editor IDE (user-confirmed decision).
- Repo: `MinexInd/datapack-version-checker` (GitHub). "Minex" prefix is the user's brand root. No logo assets exist yet — a wordmark-based identity is to be created.
- Tone: professional dev-tool, plain English, no emojis, no marketing hype.

## Evidence on Hand

- Working shipped app: upload → analyze → report → auto-fix → download. 18/18 web tests pass, tsc clean.
- Verified in-browser Spyglass parser integration (spike passed, committed).
- Perf work done: parallel parser lane, per-version parsing parallelized, IndexedDB parser-result cache.
- No testimonials, benchmarks, pricing, or press exist — future work must not fabricate them.

## Product Principles

- Correctness over coverage: version-aware results come from a real parser and real registry data, not guesses.
- Zero-install, zero-backend: everything a creator needs happens in the browser tab.
- The checker and the editor are one tool: analyze and fix inside the same IDE, never as separate silos.
- Fast to load, fast to repeat: lazy-load heavy features, cache aggressively.
- Keep the existing engine and pipelines intact — the IDE is an addition, not a rewrite.

## Accessibility & Inclusion

No product-specific accessibility requirement was established. Preserve existing keyboard affordances (Ctrl+Enter run, Escape clear) and standard web accessibility in new UI.
