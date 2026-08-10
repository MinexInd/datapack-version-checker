<!-- SEED: established with the user before implementation; re-run /impeccable document once there's code to capture the actual tokens and components. -->
---
name: MinexStudio
description: Browser studio for Minecraft datapacks — version-aware analysis and editing
---

# Design System: MinexStudio

**Direction contract** (committed 2026-08-10, seed key 32d8ad79):

- **THESIS:** MinexStudio presents every tool as a filed case on a diagnostics desk. It refuses the generic dark-tool-card grid: tool cards become docket entries, statuses become severity-stamped chips, versions become tracker labels, and the checker's findings read as triaged issue cards.
- **OWN-WORLD:** Dark slate ground (deep blue-gray), paper-docket surfaces, one warm stamp accent reserved for the active tool, and the checker's existing severity language (error / warning / info / success) as the chip vocabulary. Mono for case numbers, versions, and readouts; a clean sans for labels and body. No gradients, no glass, no decorative borders.
- **STORY:** A creator lands on MinexStudio, sees a case desk, opens the Datapack Editor case, runs a version check, and reads findings as triaged issue cards grouped per version — then fixes and re-runs in place.
- **FIRST VIEWPORT:** MinexStudio wordmark in a filing-stamp register, a docket row of tool cases (Datapack Editor open; Resourcepack Studio and future tools sealed/coming soon), and a readout strip showing versions covered.
- **FORM:** Assigned grounded direction (candidate 6), built fully committed; no safer rendition.

## Overview

**Creative North Star: "The Diagnostics Desk"**

MinexStudio is a case desk for Minecraft datapack work. Every tool the studio offers is a filed case with a docket: a title, a status stamp, and an evidentiary readout of what it covers. The desk is quiet and technical — deep slate surfaces, mono readouts, severity chips that borrow their colors from the checker that already works — and the warmth comes from a single stamp accent that marks the active tool.

The world is built for creators working in a browser at a desk, often at night: dark ground by default, low-glare surfaces, high legibility. The interface reads like instrumented paperwork, not like a game menu. Density is moderate — enough to feel like a working tool, never cramped.

**Key Characteristics:**
- Diagnostics-desk metaphor carried through naming, layout, and state language ("case", "docket", "stamp", "severity")
- Severity-chip vocabulary as the primary semantic color system
- Mono typography for anything measured or versioned; sans for labels and prose
- One warm accent, spent only on the active/staged tool
- No gradient text, no glass, no decorative side borders

## Colors

The palette is a dark slate ground with a warm stamp accent and a severity chip system. Exact values marked `[to be resolved during implementation]` until the build settles them.

### Primary
- **Stamp Accent** (`[to be resolved]`): a warm, saturated orange. Reserved for the active tool, the primary action, and the MinexStudio wordmark's emphasis. Rarity is the point — it marks the one thing you can do now.

### Neutral
- **Desk Ground** (`[to be resolved]`): near-black blue-gray page background.
- **Docket Surface** (`[to be resolved]`): one step lighter than ground; tool cards, panels.
- **Inset Well** (`[to be resolved]`): darker than docket; inputs, code wells, readouts.
- **Hairline** (`[to be resolved]`): low-contrast border between surfaces; 1px, never decorative on its own.
- **Ink** (`[to be resolved]`): primary text.
- **Ink Dim** (`[to be resolved]`): secondary text, ≥4.5:1 on its surface.

### Severity system (carried from the existing checker)
- **Error** (`[to be resolved]`): findings that break the pack.
- **Warning** (`[to be resolved]`): risky or version-specific.
- **Info** (`[to be resolved]`): informational findings.
- **Success** (`[to be resolved]`): compatible / passed.

### Named Rules
**The Stamp Rarity Rule.** The warm accent covers ≤5% of any given screen. Its scarcity is what makes the active tool legible.

## Typography

**Display Font:** [to be resolved during implementation] — a technical sans with real weight contrast, used for the wordmark and case titles.
**Body Font:** [to be resolved during implementation] — the existing Inter stack is a candidate; keep it clean and workhorse.
**Mono Font:** [to be resolved during implementation] — the existing JetBrains Mono stack; required for case numbers, versions, and readouts.

**Character:** the pairing is instrument/paper — mono carries anything measured, sans carries anything said.

### Hierarchy
- **Display** ([weight] / [size] / [line-height]): MinexStudio wordmark and case titles. Balanced heading, tight tracking floor -0.04em.
- **Title** ([weight] / [size] / [line-height]): tool names, section heads.
- **Body** ([weight] / [size] / [line-height]): prose and descriptions, max measure 65–75ch.
- **Label** ([weight] / [size] / [letter-spacing]): uppercase, tracked; kickers and metadata.
- **Mono** ([weight] / [size]): versions, case numbers, counts, severity codes.

### Named Rules
**The Measured-in-Mono Rule.** Versions, counts, and case identifiers are mono. If a number is data, it is mono; if it is prose, it is not.

## Layout

A single-column center-rhythm for the hub: wordmark lockup, case docket row, readout strip. Tool cases sit in a responsive grid — one column on narrow screens, up to three across on wide ones. Spacing follows one rhythm scale; more space above a heading than below it.

## Elevation & Depth

Dark tonal layering, not shadows: depth comes from surface steps (ground < docket < inset well) plus 1px hairlines. Hover may lift a case with a subtle offset shadow `[to be resolved]`; at rest, the desk is flat.

**The Flat-By-Default Rule.** Surfaces are flat at rest. Shadows appear only as a response to hover or focus.

## Shapes

Sharp or near-sharp corners (`[to be resolved]`, likely 2–6px) — paperwork, not game chrome. Chips are fully rounded pills. No decorative silhouettes.

## Components

No components exist yet; the build establishes them. Canonical primitives to land: the tool-case card, the severity chip, the primary action button, the status stamp, the readout strip.

## Do's and Don'ts

### Do:
- **Do** reserve the warm accent for the active tool and primary actions.
- **Do** render versions, counts, and case identifiers in mono.
- **Do** use the severity chip system for any state a finding can have.
- **Do** keep the hub reachable from the checker (MinexStudio wordmark returns to the desk).

### Don't:
- **Don't** use gradient text, glass panels, or blur-as-decoration.
- **Don't** add colored borders thicker than 1px as decoration.
- **Don't** use mono as a costume; it carries data or nothing.
- **Don't** bury the Datapack Editor case — it is the active tool and the primary action.
