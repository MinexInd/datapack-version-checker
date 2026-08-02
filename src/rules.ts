// =============================================================================
// rules.ts — SINGLE SOURCE OF TRUTH for all porting knowledge.
//
// Merges every porting rule previously spread across:
//   - src/knowledge.ts           (FEATURE_RULES, datapack feature knowledge)
//   - src/resource-knowledge.ts  (RESOURCE_FEATURE_RULES, resource-pack knowledge)
//   - src/fixer.ts               (CMD_REWRITES, command rewrite strategies)
//   - src/json-format-check.ts   (predicate / recipe rename tables)
//
// Existing consumers must keep compiling AND behave EXACTLY as before: the
// backward-compatible derived views at the bottom of this file reproduce the
// historical exported arrays (same data, same order).
//
// NOTE: src/rules.ts and web/src/engine/rules.ts must stay BYTE-IDENTICAL.
// =============================================================================

export type PortRuleType = 'command' | 'command_pattern' | 'registry' | 'json_field' | 'function_macro' | 'resource_path'
export type PortRuleScope = 'datapack' | 'resource_pack'

export interface RewriteFix {
  kind: 'rewrite'
  pattern: RegExp
  replacement: string
  sourceSince?: string  // only rewrite when porting FROM source >= this
  targetUntil?: string  // only rewrite when porting TO target <= this
  targetSince?: string  // only rewrite when porting TO target >= this
}
export interface RenameFieldFix { kind: 'rename_field'; from: string; to: string; since: string }
export interface CommentOutFix { kind: 'comment_out' }
export interface RemoveFieldFix { kind: 'remove_field'; field: string }
export interface RenameRegistryEntryFix { kind: 'rename_registry_entry'; from: string; to: string; since?: string }
export type FixAction = RewriteFix | RenameFieldFix | CommentOutFix | RemoveFieldFix | RenameRegistryEntryFix

export interface PortRule {
  id: string
  type: PortRuleType
  scope?: PortRuleScope       // default 'datapack'
  match: string | RegExp
  since?: string              // feature exists from (was minVersion)
  until?: string              // feature removed/changed at (was maxVersion)
  description: string
  guidance?: string           // human advice (was prose `fix`)
  fix?: FixAction
  note?: string
  jsonKind?: 'predicate' | 'recipe'  // json_field rules: which JSON file kind
}

/**
 * Unified porting knowledge, merged in this order:
 *   1. Datapack feature rules (was knowledge.ts FEATURE_RULES)
 *   2. Resource-pack feature rules (was resource-knowledge.ts RESOURCE_FEATURE_RULES)
 *   3. Command rewrite strategies (was fixer.ts CMD_REWRITES)
 *   4. JSON field rename rules (was json-format-check.ts local rename tables)
 */
export const PORT_RULES: PortRule[] = [
  // =============================================================================
  // 1. Datapack feature rules — was knowledge.ts FEATURE_RULES (81 rules)
  // =============================================================================
  { id: "tag", type: "command", scope: "datapack", match: "tag", since: "1.13", description: "The /tag command (entity tags) was added.", guidance: "Use /scoreboard players tag in pre-1.13.", note: "Replaced /scoreboard players tag in 1.13" },
  { id: "team", type: "command", scope: "datapack", match: "team", since: "1.13", description: "The /team command (teams) was added.", guidance: "Use /scoreboard teams in pre-1.13.", note: "Split from /scoreboard in 1.13" },
  { id: "data_cmd", type: "command", scope: "datapack", match: "data", since: "1.13", description: "The /data command (get/merge/modify/remove) was added.", guidance: "Use /entitydata or /blockdata in pre-1.13.", note: "Replaced /entitydata and /blockdata in 1.13" },
  { id: "datapack_cmd", type: "command", scope: "datapack", match: "datapack", since: "1.13", description: "The /datapack command (enable/disable/list) was added.", guidance: "Datapacks do not exist in pre-1.13.", note: "Added with data pack system in 1.13" },
  { id: "bossbar_cmd", type: "command", scope: "datapack", match: "bossbar", since: "1.13", description: "The /bossbar command was added.", guidance: "Boss bars cannot be created via commands in pre-1.13.", note: "Added in 1.13" },
  { id: "forceload", type: "command", scope: "datapack", match: "forceload", since: "1.13", description: "The /forceload command was added.", guidance: "Use /chunk in pre-1.13 or manual chunk loading.", note: "Renamed from /chunk in 1.13.1" },
  { id: "experience", type: "command", scope: "datapack", match: "experience", since: "1.13", description: "The /experience command (alias of /xp) was added.", guidance: "Use /xp in pre-1.13.", note: "Alias added in 1.13" },
  { id: "loot", type: "command", scope: "datapack", match: "loot", since: "1.14", description: "The /loot command was added.", guidance: "Use /give or /data with loot tables in older versions.", note: "Added in 18w43a (1.14)" },
  { id: "spectate", type: "command", scope: "datapack", match: "spectate", since: "1.15", description: "The /spectate command was added.", guidance: "Spectate is 1.15+ only; use /tp in older versions.", note: "Added in 19w40a (1.15)" },
  { id: "locatebiome", type: "command", scope: "datapack", match: "locatebiome", since: "1.16", description: "The /locatebiome command was added.", guidance: "Use /locate biome (1.19+) or external tools for pre-1.16.", note: "Added in 20w11a (1.16); merged into /locate in 1.19" },
  { id: "item_cmd", type: "command", scope: "datapack", match: "item", since: "1.17", description: "The /item command (replace/modify) was added, replacing /replaceitem.", guidance: "Use /replaceitem in pre-1.17.", note: "Added in 21w05a (1.17); /replaceitem deprecated" },
  { id: "perf", type: "command", scope: "datapack", match: "perf", since: "1.17", description: "The /perf command was added.", guidance: "Perf is 1.17+ only.", note: "Added in 21w11a (1.17)" },
  { id: "jfr", type: "command", scope: "datapack", match: "jfr", since: "1.18", description: "The /jfr command (Java Flight Recorder) was added.", guidance: "JFR profiling is 1.18+ only.", note: "Added in 21w37a (1.18)" },
  { id: "placefeature", type: "command", scope: "datapack", match: "placefeature", since: "1.18.2", description: "The /placefeature command was added.", guidance: "Use /place feature (1.19+) or /setblock for older versions.", note: "Added in 1.18.2; replaced by /place in 1.19" },
  { id: "random", type: "command", scope: "datapack", match: "random", since: "1.20.2", description: "The /random command (value, roll, reset) was added.", guidance: "Replace with /scoreboard random (1.20.4) or a custom RNG via /scoreboard.", note: "Added in 23w31a" },
  { id: "damage", type: "command", scope: "datapack", match: "damage", since: "1.19.4", description: "The /damage command was added.", guidance: "Use /effect with instant damage, /attribute, or /data to apply damage in older versions.", note: "Added in 23w06a (1.19.4)" },
  { id: "ride", type: "command", scope: "datapack", match: "ride", since: "1.19.4", description: "The /ride command was added.", guidance: "Use /tp or /data merge for entity mounting in older versions.", note: "Added in 23w03a (1.19.4)" },
  { id: "return", type: "command", scope: "datapack", match: "return", since: "1.20", description: "The /return command for functions was added.", guidance: "Restructure function logic to not early-return.", note: "Added in 23w16a (1.20)" },
  { id: "fillbiome", type: "command", scope: "datapack", match: "fillbiome", since: "1.19.3", description: "The /fillbiome command was added.", guidance: "Use /fill with biome NBT or world editing tools in older versions.", note: "Added in 22w46a (1.19.3)" },
  { id: "place", type: "command", scope: "datapack", match: "place", since: "1.19", description: "The /place command (feature/structure/jigsaw/template) replaced /placefeature.", guidance: "Pre-1.19 uses /placefeature (1.18) or /locate + manual building.", note: "Added in 22w11a (1.19)" },
  { id: "tick", type: "command", scope: "datapack", match: "tick", since: "1.20.3", description: "The /tick command (sprint/step/freeze/rate) was added.", guidance: "Note: /tick is an admin/debug command and is NOT available in command blocks/datapacks by default.", note: "Added in 23w43a (1.20.3); requires elevated permissions" },
  { id: "transfer", type: "command", scope: "datapack", match: "transfer", since: "1.20.5", description: "The /transfer command was added.", guidance: "Transfer is 1.20.5+ only; no direct replacement in older versions.", note: "Added in 24w04a (1.20.5)" },
  { id: "function_macro", type: "function_macro", scope: "datapack", match: "\\$\\(", since: "1.20.4", description: "Function macros with $(variable) and line continuation require 1.20.4+", guidance: "Macros are 1.20.4+. Use /function with multiple hardcoded functions for older versions.", note: "Macros + line continuation added in 23w45a" },
  { id: "item_components_give", type: "command_pattern", scope: "datapack", match: "^/?(?:give|clear)\\s+\\S+\\s+[\\w.:-]+\\[", since: "1.20.5", description: "Item components [components] syntax in /give requires 1.20.5+", guidance: "Use NBT tag:{...} instead of [components] for pre-1.20.5, or split by version.", note: "Item component format changed in 24w09a" },
  { id: "item_command", type: "command", scope: "datapack", match: "item", since: "1.20.5", description: "The /item command (replace/modify) overhaul requires 1.20.5+", guidance: "Use /replaceitem (pre-1.20.5) — note /item is the new preferred form in 1.20.5+.", note: "Item component rework in 24w09a" },
  { id: "execute_if_items", type: "command_pattern", scope: "datapack", match: "^/?(?:execute\\b.*\\b)(?:if|unless)\\s+items\\b", since: "1.20.5", description: "/execute (if|unless) items requires 1.20.5+", guidance: "Use /execute if data with NBT checks for item detection in older versions.", note: "Added with component rework" },
  { id: "attribute", type: "command", scope: "datapack", match: "attribute", since: "1.16", description: "The /attribute command was added in 1.16.", guidance: "Use /data merge for attribute modifiers in pre-1.16 versions.", note: "Added in 20w17a (1.16)" },
  { id: "bossbar_players", type: "command_pattern", scope: "datapack", match: "^/?(?:bossbar\\b.*\\b)players\\b", since: "1.20.5", description: "/bossbar set players subcommand requires 1.20.5+", guidance: "Add players via /bossbar add then /bossbar set players in 1.20.5+.", note: "bossbar players added 24w09a" },
  { id: "schedule", type: "command", scope: "datapack", match: "schedule", since: "1.14", description: "The /schedule command was added in 1.14.", guidance: "Use a ticking function with /scoreboard timers in pre-1.14.", note: "Added in 18w43a (1.14)" },
  { id: "execute_if_unless", type: "command_pattern", scope: "datapack", match: "^/?(?:execute\\b.*\\b)(?:if|unless)\\s+", since: "1.14", description: "/execute (if|unless) subconditions require 1.14+", guidance: "Pre-1.14 /execute cannot conditionally test; use /testfor + /stats.", note: "execute if/unless added in 1.14" },
  { id: "namespaced_ids", type: "command_pattern", scope: "datapack", match: "^/?(?:give|clear|replaceitem)\\s+\\S+\\s+minecraft:", since: "1.13", description: "Namespaced IDs (minecraft:stone) and new /give syntax require 1.13+", guidance: "Pre-1.13 uses numeric item IDs. Use a legacy datapack for old versions.", note: "1.13 Aquatic command overhaul" },
  { id: "execute_store", type: "command_pattern", scope: "datapack", match: "^/?(?:execute\\b.*\\b)store\\s+", since: "1.13", description: "/execute store syntax was added in 1.13", guidance: "Use /stats for score tracking in pre-1.13.", note: "execute store replaced /stats in 1.13" },
  { id: "wolf_variant", type: "registry", scope: "datapack", match: "wolf_variant", since: "1.21.5", description: "minecraft:wolf_variant registry added in 1.21.5", guidance: "Remove wolf_variant references for pre-1.21.5.", note: "Added in 1.21.5" },
  { id: "pig_variant", type: "registry", scope: "datapack", match: "pig_variant", since: "1.21.5", description: "minecraft:pig_variant registry added in 1.21.5", guidance: "Remove pig_variant references for pre-1.21.5.", note: "Added in 1.21.5" },
  { id: "cow_variant", type: "registry", scope: "datapack", match: "cow_variant", since: "1.21.5", description: "minecraft:cow_variant registry added in 1.21.5", guidance: "Remove cow_variant references for pre-1.21.5.", note: "Added in 1.21.5" },
  { id: "chicken_variant", type: "registry", scope: "datapack", match: "chicken_variant", since: "1.21.5", description: "minecraft:chicken_variant registry added in 1.21.5", guidance: "Remove chicken_variant references for pre-1.21.5.", note: "Added in 1.21.5" },
  { id: "instrument", type: "registry", scope: "datapack", match: "instrument", since: "1.21.2", description: "minecraft:instrument registry (goat horns) added in 1.21.2", guidance: "Goat horn instruments are 1.21.2+ only.", note: "Added in 1.21.2 (Bundles of Bravery)" },
  { id: "enchantment_registry", type: "registry", scope: "datapack", match: "enchantment", since: "1.21", description: "minecraft:enchantment registry (custom enchantments) requires 1.21+", guidance: "Custom enchantments are 1.21+ only.", note: "Added in 1.21 (Tricky Trials)" },
  { id: "enchantment_ref", type: "registry", scope: "datapack", match: "enchantment/", since: "1.21", description: "Referencing a custom enchantment registry entry (enchantment/foo) requires 1.21+", guidance: "Custom enchantments are 1.21+ only.", note: "Added in 1.21 (Tricky Trials)" },
  { id: "jukebox_song", type: "registry", scope: "datapack", match: "jukebox_song", since: "1.21", description: "minecraft:jukebox_song registry requires 1.21+", guidance: "Custom jukebox songs are 1.21+ only.", note: "Added in 1.21" },
  { id: "painting_variant", type: "registry", scope: "datapack", match: "painting_variant", since: "1.21", description: "minecraft:painting_variant registry (data-driven paintings) requires 1.21+", guidance: "Custom painting variants are 1.21+ only.", note: "Added in 1.21 (Tricky Trials)" },
  { id: "painting_variant_ref", type: "registry", scope: "datapack", match: "painting_variant/", since: "1.21", description: "Referencing painting_variant registry entries requires 1.21+", guidance: "Custom painting variants are 1.21+ only.", note: "Added in 1.21 (Tricky Trials)" },
  { id: "trim_pattern", type: "registry", scope: "datapack", match: "trim_pattern", since: "1.20", description: "minecraft:trim_pattern registry (armor trim patterns) requires 1.20+", guidance: "Custom trim patterns are 1.20+ only.", note: "Added in 1.20 (Trails & Tales)" },
  { id: "trim_material", type: "registry", scope: "datapack", match: "trim_material", since: "1.20", description: "minecraft:trim_material registry (armor trim materials) requires 1.20+", guidance: "Custom trim materials are 1.20+ only.", note: "Added in 1.20 (Trails & Tales)" },
  { id: "banner_pattern", type: "registry", scope: "datapack", match: "banner_pattern", since: "1.20", description: "minecraft:banner_pattern registry requires 1.20+", guidance: "Custom banner patterns are 1.20+ only.", note: "Added in 1.20 (Trails & Tales)" },
  { id: "chat_type", type: "registry", scope: "datapack", match: "chat_type", since: "1.19", description: "minecraft:chat_type registry (chat formatting) requires 1.19+", guidance: "Custom chat types are 1.19+ only.", note: "Added in 1.19 (The Wild Update)" },
  { id: "damage_type", type: "registry", scope: "datapack", match: "damage_type", since: "1.19.4", description: "minecraft:damage_type registry requires 1.19.4+", guidance: "Custom damage types are 1.19.4+ only.", note: "Added in 1.19.4 (damage predicates overhauled)" },
  { id: "damage_type_ref", type: "registry", scope: "datapack", match: "damage_type/", since: "1.19.4", description: "Referencing damage_type entries (damage_type/foo) requires 1.19.4+", guidance: "Custom damage type references are 1.19.4+ only.", note: "Added in 1.19.4" },
  { id: "worldgen_biome", type: "registry", scope: "datapack", match: "worldgen/biome", since: "1.16", description: "Custom worldgen biomes require 1.16+", guidance: "Custom biomes are 1.16+ only.", note: "Worldgen system introduced in 1.16" },
  { id: "worldgen_configured_feature", type: "registry", scope: "datapack", match: "worldgen/configured_feature", since: "1.16", description: "Custom configured features require 1.16+", guidance: "Custom configured features are 1.16+ only.", note: "Worldgen system introduced in 1.16" },
  { id: "worldgen_placed_feature", type: "registry", scope: "datapack", match: "worldgen/placed_feature", since: "1.18", description: "Custom placed features require 1.18+", guidance: "Custom placed features are 1.18+ only.", note: "Placed features split from configured features in 1.18" },
  { id: "worldgen_structure", type: "registry", scope: "datapack", match: "worldgen/structure", since: "1.19", description: "Custom structure definitions require 1.19+", guidance: "Custom structures are 1.19+ only.", note: "Structure system reworked in 1.19" },
  { id: "worldgen_structure_set", type: "registry", scope: "datapack", match: "worldgen/structure_set", since: "1.19", description: "Custom structure sets require 1.19+", guidance: "Custom structure sets are 1.19+ only.", note: "Structure sets added in 1.19" },
  { id: "worldgen_template_pool", type: "registry", scope: "datapack", match: "worldgen/template_pool", since: "1.16", description: "Custom template pools require 1.16+", guidance: "Custom template pools are 1.16+ only.", note: "Added with jigsaw structure system in 1.16" },
  { id: "worldgen_noise_settings", type: "registry", scope: "datapack", match: "worldgen/noise_settings", since: "1.18", description: "Custom noise settings require 1.18+", guidance: "Custom noise settings are 1.18+ only.", note: "World generation completely restructured in 1.18" },
  { id: "worldgen_density_function", type: "registry", scope: "datapack", match: "worldgen/density_function", since: "1.19", description: "Custom density functions require 1.19+", guidance: "Custom density functions are 1.19+ only.", note: "Added in 1.19" },
  { id: "worldgen_world_preset", type: "registry", scope: "datapack", match: "worldgen/world_preset", since: "1.19", description: "Custom world presets require 1.19+", guidance: "Custom world presets are 1.19+ only.", note: "Added in 1.19" },
  { id: "worldgen_noise_router", type: "registry", scope: "datapack", match: "worldgen/noise_router", since: "1.19", description: "Custom noise routers require 1.19+", guidance: "Custom noise routers are 1.19+ only.", note: "Added in 1.19" },
  { id: "dimension_type", type: "registry", scope: "datapack", match: "dimension_type", since: "1.16", description: "Custom dimension types require 1.16+", guidance: "Custom dimension types are 1.16+ only.", note: "Custom dimensions introduced in 1.16" },
  { id: "test_command", type: "command", scope: "datapack", match: "test", since: "1.21.4", description: "The /test command (game test framework) requires 1.21.4+", guidance: "Game test commands are 1.21.4+ only.", note: "Added in 1.21.4" },
  { id: "return_run", type: "command_pattern", scope: "datapack", match: "^/?(?:return\\s+run)", since: "1.20.4", description: "/return run requires 1.20.4+", guidance: "Use /return (no run) or restructure for pre-1.20.4.", note: "Added in 1.20.4" },
  { id: "rotate", type: "command", scope: "datapack", match: "rotate", since: "1.21.2", description: "The /rotate command (rotate entities) was added.", guidance: "Rotate is 1.21.2+ only; use /data merge to set Rotation NBT in older versions.", note: "Added in 24w40a (1.21.2)" },
  { id: "version_cmd", type: "command", scope: "datapack", match: "version", since: "1.21.6", description: "The /version command was added.", guidance: "Version is 1.21.6+ only.", note: "Added in 25w15a (1.21.6)" },
  { id: "waypoint", type: "command", scope: "datapack", match: "waypoint", since: "1.21.6", description: "The /waypoint command (Locator Bar) was added.", guidance: "Waypoints are 1.21.6+ only (Locator Bar feature).", note: "Added in 25w15a/25w17a (1.21.6)" },
  { id: "dialog", type: "command", scope: "datapack", match: "dialog", since: "1.21.6", description: "The /dialog command (NPC dialog) was added.", guidance: "Dialog is 1.21.6+ only.", note: "Added in 25w20a (1.21.6)" },
  { id: "fetchprofile", type: "command", scope: "datapack", match: "fetchprofile", since: "1.21.9", description: "The /fetchprofile command was added.", guidance: "Fetchprofile is 1.21.9+ only.", note: "Added in 25w34a (1.21.9)" },
  { id: "swing", type: "command", scope: "datapack", match: "swing", since: "26.1", description: "The /swing command (animate arm swing) was added.", guidance: "Swing is 26.1+ only.", note: "Added in 26.1 snapshot 1" },
  { id: "unpublish", type: "command", scope: "datapack", match: "unpublish", since: "26.2", description: "The /unpublish command (LanServerProperties) was added.", guidance: "Unpublish is 26.2+ only.", note: "Added in 26.2 snapshot 8" },
  { id: "posteffect", type: "command", scope: "datapack", match: "posteffect", since: "26.3", description: "The /posteffect command was added.", guidance: "Posteffect is 26.3+ only.", note: "Added in 26.3 snapshot 3" },
  { id: "item_model_component", type: "command_pattern", scope: "datapack", match: "^/?(?:give|item|clear|loot)\\b[^\\n]*minecraft:item_model\\b", since: "1.21.4", description: "minecraft:item_model component requires 1.21.4+", guidance: "item_model component is 1.21.4+; use numeric CustomModelData or resource-pack overrides for older versions.", note: "item_model added 1.21.4 (DataComponents)" },
  { id: "custom_model_data_compound", type: "command_pattern", scope: "datapack", match: "^/?(?:give|item|clear|loot)\\b[^\\n]*custom_model_data=\\{[^}]*(?:floats|flags|strings|colors)\\b", since: "1.21.4", description: "custom_model_data with floats/flags/strings/colors fields requires 1.21.4+", guidance: "The rich custom_model_data format (floats/flags/strings/colors) is 1.21.4+; use a single integer value (custom_model_data=<n>) for 1.20.5-1.21.3.", note: "custom_model_data extended format added 1.21.4" },
  { id: "consumable_component", type: "command_pattern", scope: "datapack", match: "^/?(?:give|item|clear|loot)\\b[^\\n]*minecraft:consumable\\b", since: "1.21.2", description: "minecraft:consumable component requires 1.21.2+", guidance: "consumable component is 1.21.2+; the food component alone no longer triggers consumption in 1.21.2+ (add consumable={}).", note: "consumable component added 1.21.2; food no longer auto-consumes" },
  { id: "execute_if_function", type: "command_pattern", scope: "datapack", match: "^/?(?:execute\\b.*\\b)(?:if|unless)\\s+function\\b", since: "1.20", description: "/execute if function requires 1.20+", guidance: "Use /function with /scoreboard return values for pre-1.20.", note: "execute if function added in 1.20 with /return" },
  { id: "execute_if_predicate", type: "command_pattern", scope: "datapack", match: "^/?(?:execute\\b.*\\b)(?:if|unless)\\s+predicate\\b", since: "1.15", description: "/execute if predicate requires 1.15+", guidance: "Use /execute if block/data checks for pre-1.15.", note: "execute if predicate added in 1.15" },
  { id: "execute_on", type: "command_pattern", scope: "datapack", match: "^/?(?:execute\\b.*\\b)on\\s+", since: "1.19.4", description: "/execute on requires 1.19.4+", guidance: "Use /execute as/at with selectors for pre-1.19.4.", note: "execute on (origin/attacker/target/vehicle/mount/passengers/controller) added 1.19.4" },
  { id: "execute_rotated", type: "command_pattern", scope: "datapack", match: "^/?(?:execute\\b.*\\b)rotated\\s+(?:as|over)\\b", since: "1.20", description: "/execute rotated requires 1.20+", guidance: "Use /execute at with rotation modifiers for pre-1.20.", note: "execute rotated as/over added in 1.20" },
  { id: "execute_in", type: "command_pattern", scope: "datapack", match: "^/?(?:execute\\b.*\\b)in\\s+", since: "1.16", description: "/execute in requires 1.16+", guidance: "Use /execute in via dimension teleportation for pre-1.16.", note: "execute in (dimension) added in 1.16" },
  { id: "scoreboard_numberformat", type: "command_pattern", scope: "datapack", match: "^/?(?:scoreboard\\b.*\\b)(?:numberformat|displayname|rendertype)\\b", since: "1.20.3", description: "Scoreboard numberformat/displayname modifications require 1.20.3+", guidance: "Number format and display name modifications are 1.20.3+ only.", note: "Added in 1.20.3" },
  { id: "loot_command", type: "command_pattern", scope: "datapack", match: "^/?(?:loot\\b)", since: "1.14", description: "/loot command requires 1.14+", guidance: "Use /give or /data for item distribution in pre-1.14.", note: "Loot command added in 1.14" },
  { id: "dialog_registry", type: "registry", scope: "datapack", match: "dialog", since: "1.21.6", description: "minecraft:dialog registry requires 1.21.6+", guidance: "Dialog system is 1.21.6+ only.", note: "Added in 1.21.6 (experimental)" },
  { id: "predicate_dir", type: "registry", scope: "datapack", match: "predicates/", since: "1.15", description: "The predicates/ directory structure was formalized in 1.15+", guidance: "Predicates directory structure changed in 1.15.", note: "Custom predicates formalized in 1.15" },
  // ---- 1.21.11/26.1 era command and command_pattern rules (verified expansion) ----
  { id: "stopwatch_cmd", type: "command", scope: "datapack", match: "stopwatch", since: "1.21.11", description: "The /stopwatch command (real-time stopwatches) was added.", guidance: "Stopwatch is 1.21.11+ only; use /tick or scoreboard timers in older versions.", note: "Added 25w41a; id argument moved after subcommand in 25w42a" },
  { id: "execute_if_stopwatch", type: "command_pattern", scope: "datapack", match: "^/?(?:execute\\b.*\\b)(?:if|unless)\\s+stopwatch\\b", since: "1.21.11", description: "/execute (if|unless) stopwatch <id> <range> requires 1.21.11+", guidance: "Compare elapsed stopwatch time with a float range; unavailable before 1.21.11.", note: "Added 25w41a with the /stopwatch command" },
  { id: "time_preset_removed", type: "command_pattern", scope: "datapack", match: "^/?(?:time\\s+(?:set|query)\\s+(?:day|daytime|noon|midnight|night)\\b)", since: "1.13", until: "26.1", description: "/time set day|noon|night|midnight and /time query day|daytime removed in 26.1", guidance: "Use /time set <ticks> or /time query time (26.1+); preset names replaced by World Clock Time Markers.", note: "Removed in 26.1 snapshot 3 (World Clocks)" },
  { id: "time_world_clock", type: "command_pattern", scope: "datapack", match: "^/?(?:time\\s+(?:of|pause|rate|resume|query\\s+time)\\b)", since: "26.1", description: "/time of <clock> and /time pause|rate|resume require 26.1+", guidance: "/time now operates on World Clocks; of/query take a clock resource, presets like day/night no longer exist.", note: "Added 26.1 snapshot 3; /time query time replaces query day" },
  { id: "gamerule_camelcase_removed", type: "command_pattern", scope: "datapack", match: "^/?(?:gamerule\\s+)[A-Za-z]+\\b", since: "1.13", until: "1.21.11", description: "CamelCase gamerule names (doDaylightCycle etc.) removed in 1.21.11", guidance: "Use snake_case names (e.g. advance_time) or minecraft:advance_time in 1.21.11+; gamerules became a registry.", note: "Renamed 25w44a; see REGISTRY_RENAMES game_rule entries" },
  { id: "gamerule_snakecase", type: "command_pattern", scope: "datapack", match: "^/?(?:gamerule\\s+)[a-z_]+\\b", since: "1.21.11", description: "Snake_case gamerule names require 1.21.11+", guidance: "Pre-1.21.11 gamerules use camelCase names only (doDaylightCycle, mobGriefing, ...).", note: "Game rules moved to registry and renamed in 1.21.11 (25w44a)" },
  { id: "locate_subcommands", type: "command_pattern", scope: "datapack", match: "^/?(?:locate\\s+(?:biome|poi|structure)\\b)", since: "1.19", description: "/locate biome|poi|structure requires 1.19+", guidance: "Pre-1.19: /locate <structureId> (1.16-1.18.2) or /locatebiome for biomes.", note: "locatebiome merged into /locate in 1.19 (22w19a)" },
  { id: "locate_lowercase", type: "command_pattern", scope: "datapack", match: "^/?(?:locate\\s+[a-z][a-z_0-9]*\\b)", since: "1.16", description: "/locate with lowercase structure names requires 1.16+", guidance: "Pre-1.16 /locate used capitalized names (Buried_Treasure, Village).", note: "Lowercase names since 20w21a (1.16)" },
  { id: "function_with_macro", type: "command_pattern", scope: "datapack", match: "^/?(?:function\\b[^\\n]*\\bwith\\s+(?:block|entity|storage)\\b)", since: "1.20.2", description: "/function <id> with block|entity|storage requires 1.20.2+", guidance: "Macro calls (with <source> [<path>], or <id> {compound}) are 1.20.2+ only; older versions call functions without arguments.", note: "Added 23w31a with the macro system" },
  { id: "effect_infinite", type: "command_pattern", scope: "datapack", match: "^/?(?:effect\\s+give\\b[^\\n]*\\binfinite\\b)", since: "1.19.4", description: "/effect give <target> <effect> infinite requires 1.19.4+", guidance: "Pre-1.19.4 use a very large duration (e.g. 999999) or re-apply periodically.", note: "infinite duration option added 23w05a" },
  { id: "block_command_strict", type: "command_pattern", scope: "datapack", match: "^/?(?:fill|clone|setblock)\\b[^\\n]*\\bstrict\\b", since: "1.21.5", description: "The strict option on /fill, /clone, /setblock (and /place template) requires 1.21.5+", guidance: "strict places blocks without block updates; unavailable before 1.21.5.", note: "Added 25w02a (1.21.5)" },
  { id: "clone_from_to", type: "command_pattern", scope: "datapack", match: "^/?(?:clone\\b[^\\n]*\\b(?:from|to)\\b)", since: "1.19.4", description: "/clone from/to (cross-dimension cloning) requires 1.19.4+", guidance: "Pre-1.19.4: /clone <begin> <end> <destination>; from/to with dimensions added in 1.19.4.", note: "Added 23w03a" },
  { id: "datapack_create", type: "command_pattern", scope: "datapack", match: "^/?(?:datapack\\s+create\\b)", since: "1.21.6", description: "/datapack create requires 1.21.6+", guidance: "Create datapacks at runtime only in 1.21.6+; older versions use enable/disable/list.", note: "Added 25w15a" },
  { id: "debug_function", type: "command_pattern", scope: "datapack", match: "^/?(?:debug\\s+function\\b)", since: "1.17", description: "/debug function (function tracing) requires 1.17+", guidance: "Trace datapack function execution in 1.17+; older versions use /debug report (1.14.4-1.16.x).", note: "Added 21w15a" },
  { id: "debug_report", type: "command_pattern", scope: "datapack", match: "^/?(?:debug\\s+report\\b)", since: "1.14.4", until: "1.17", description: "/debug report removed in 1.17", guidance: "Use F3+L or /perf instead of /debug report in 1.17+.", note: "Added 1.14.4-pre1, removed 1.17-pre1" },
  { id: "playsound_ui", type: "command_pattern", scope: "datapack", match: "^/?(?:(?:playsound|stopsound)\\s+\\S+\\s+)ui\\b", since: "1.21.6", description: "The ui sound source in /playsound and /stopsound requires 1.21.6+", guidance: "Use master (or another pre-1.21.6 source) when targeting older versions.", note: "Added 1.21.6-pre3" },
  { id: "spreadplayers_under", type: "command_pattern", scope: "datapack", match: "^/?(?:spreadplayers\\b[^\\n]*\\bunder\\b)", since: "1.16", description: "/spreadplayers ... under <maxHeight> requires 1.16+", guidance: "Control spread height only in 1.16+; pre-1.16 positions land at y=0.", note: "Added in 1.16" },
  // =============================================================================
  // 2. Resource-pack feature rules — was resource-knowledge.ts RESOURCE_FEATURE_RULES (28 rules)
  // =============================================================================
  { id: "item_model_type", type: "resource_path", scope: "resource_pack", match: "model.*type", since: "1.21.5", description: "Item models use the \"model\" type field (added 1.21.5)", guidance: "Omit the type field for pre-1.21.5 item models.", note: "Item model type field added in 1.21.5" },
  { id: "gui_font_variants", type: "resource_path", scope: "resource_pack", match: "font/", since: "1.20.5", description: "Font provider \"space\" variant with advancements field", guidance: "Remove advancements field from space font providers for pre-1.20.5.", note: "Font advancements field added 1.20.5" },
  { id: "equipment_model_asset_id", type: "resource_path", scope: "resource_pack", match: "asset_id", since: "1.21.5", description: "Equipment model field renamed from \"model\" to \"asset_id\" (1.21.5)", guidance: "Use \"model\" instead of \"asset_id\" for pre-1.21.5.", note: "Renamed in 1.21.5" },
  { id: "trim_material_item_model", type: "resource_path", scope: "resource_pack", match: "item_model_index", since: "1.21.5", description: "Trim material \"item_model_index\" field removed (1.21.5)", guidance: "Remove item_model_index for 1.21.5+.", note: "Removed in 1.21.5" },
  { id: "item_model_definition", type: "resource_path", scope: "resource_pack", match: "items/.*\\.json", since: "1.21.4", description: "Item model definition files (assets/<ns>/items/<id>.json) require 1.21.4+", guidance: "Item model definition system is 1.21.4+; use model overrides for older versions.", note: "New item rendering pipeline added in 1.21.4" },
  { id: "item_model_selector", type: "resource_path", scope: "resource_pack", match: "(?:selectors|model_selectors|condition)", since: "1.21.4", description: "Model selectors (select/condition/rotate) require 1.21.4+", guidance: "Model selector system is 1.21.4+ only.", note: "Item model selectors added in 1.21.4" },
  { id: "spawn_egg_individual_textures", type: "resource_path", scope: "resource_pack", match: "spawn_egg_", since: "1.21.5", description: "Individual spawn egg textures (spawn_egg_<entity>.png) require 1.21.5+", guidance: "Spawn egg coloring system was replaced with individual textures in 1.21.5.", note: "All spawn egg textures split into individual files in 1.21.5" },
  { id: "shader_core_format", type: "resource_path", scope: "resource_pack", match: "shaders/", since: "1.21.6", description: "Core shader format changes in 1.21.6+", guidance: "Shader format was updated in 1.21.6; check compatibility with target version.", note: "Shader system updated in 1.21.6 (Chase the Skies)" },
  { id: "dialog_registry_rp", type: "resource_path", scope: "resource_pack", match: "dialog/", since: "1.21.6", description: "Dialog registry files in resource packs require 1.21.6+", guidance: "Dialog system is 1.21.6+ only.", note: "Dialog system added in 1.21.6" },
  { id: "model_render_type", type: "resource_path", scope: "resource_pack", match: "render_type", since: "1.17", description: "Block model \"render_type\" field requires 1.17+", guidance: "Omit render_type for pre-1.17 resource packs (cutout, translucent, etc).", note: "render_type field added in 1.17" },
  { id: "model_element_rotation", type: "resource_path", scope: "resource_pack", match: "model.*rotation", since: "1.16", description: "Model elements with rotation require 1.16+ format", guidance: "Omit rotation for pre-1.16 models.", note: "Model element rotation added in 1.16" },
  { id: "model_ambientocclusion", type: "resource_path", scope: "resource_pack", match: "ambientocclusion", since: "1.10", description: "Model \"ambientocclusion\" field available since 1.10", guidance: "Omit ambientocclusion for pre-1.10 resource packs.", note: "Added in 1.10" },
  { id: "model_guilight", type: "resource_path", scope: "resource_pack", match: "gui_light", since: "1.11", description: "Model \"gui_light\" field available since 1.11", guidance: "Omit gui_light for pre-1.11 resource packs.", note: "Added in 1.11" },
  { id: "sound_replace", type: "resource_path", scope: "resource_pack", match: "sounds.*replace", since: "1.16.2", description: "Sound \"replace\" field requires 1.16.2+", guidance: "Remove replace field for pre-1.16.2.", note: "Added in 1.16.2" },
  { id: "atlas_source", type: "resource_path", scope: "resource_pack", match: "atlases/", since: "1.19", description: "Atlas \"sources\" field requires 1.19+", guidance: "Atlases directory is 1.19+. Use resource-pack-only atlas for older.", note: "Atlas system added in 1.19" },
  { id: "atlas_palette", type: "resource_path", scope: "resource_pack", match: "palette", since: "1.19.4", description: "Atlas \"palette\" source type requires 1.19.4+", guidance: "Remove palette source for pre-1.19.4.", note: "Palette source added 1.19.4" },
  { id: "atlas_paletted_permutations", type: "resource_path", scope: "resource_pack", match: "paletted_permutations", since: "1.20", description: "Atlas \"paletted_permutations\" source type requires 1.20+", guidance: "paletted_permutations is 1.20+; use individual texture files for older versions.", note: "Added in 1.20 (Trails & Tales)" },
  { id: "particle_texture", type: "resource_path", scope: "resource_pack", match: "particle.*textures", since: "1.13", description: "Particle \"textures\" field requires 1.13+", guidance: "Pre-1.13 particles use a different file format.", note: "Particle system overhauled in 1.13" },
  { id: "particle_type_json", type: "resource_path", scope: "resource_pack", match: "particles/.*\\.json", since: "1.20.5", description: "Particle type JSON definitions require 1.20.5+", guidance: "Particle JSON format changed in 1.20.5.", note: "Particle format updated with item component system" },
  { id: "blockstate_multipart", type: "resource_path", scope: "resource_pack", match: "multipart", since: "1.14", description: "Blockstate \"multipart\" variant requires 1.14+", guidance: "Use variants instead of multipart for pre-1.14.", note: "Multipart blockstates added in 1.14" },
  { id: "lang_unicode", type: "resource_path", scope: "resource_pack", match: "lang/", since: "1.13", description: "Language files with Unicode escapes have been standard since 1.13", guidance: "Language files work across all versions >= 1.13.", note: "JSON lang files introduced in 1.13" },
  { id: "entity_model_overrides", type: "resource_path", scope: "resource_pack", match: "entity.*render_type", since: "1.19.4", description: "Entity model render_type overrides require 1.19.4+", guidance: "Entity render type overrides are 1.19.4+ only.", note: "Display entity render types added in 1.19.4" },
  { id: "font_shift_provider", type: "resource_path", scope: "resource_pack", match: "font.*shift", since: "1.20.5", description: "Font \"shift\" provider (horizontal offset) requires 1.20.5+", guidance: "Font shift provider is 1.20.5+ only.", note: "Font shift provider added in 1.20.5" },
  { id: "model_tint_source", type: "resource_path", scope: "resource_pack", match: "tint_source", since: "1.21.4", description: "Block model \"tint_source\" field requires 1.21.4+", guidance: "tint_source is 1.21.4+ only.", note: "Added in 1.21.4" },
  { id: "painting_inline_variant", type: "resource_path", scope: "resource_pack", match: "painting.*variant", since: "1.21", until: "1.21.5", description: "Inline painting variants require pre-1.21.6", guidance: "Inline painting variants removed in 1.21.6; use registry references instead.", note: "Painting variants changed to registry-only in 1.21.6" },
  { id: "dimension_type_fields", type: "resource_path", scope: "resource_pack", match: "dimension_type", since: "1.16", description: "Dimension type definitions expanded in 1.21.6+", guidance: "Dimension type format changed across versions; check compatibility.", note: "Dimension system introduced 1.16, expanded 1.21.6" },
  { id: "cow_variant_textures", type: "resource_path", scope: "resource_pack", match: "entity/cow.*(?:cold|warm|temperate)", since: "1.21.5", description: "Cow variant textures (cow_cold.png, cow_warm.png) require 1.21.5+", guidance: "Cow variant textures are 1.21.5+ only.", note: "Cow variants added in 1.21.5" },
  { id: "armor_trim_models", type: "resource_path", scope: "resource_pack", match: "armor_trim", since: "1.20", description: "Armor trim model system changed in 1.21.5+", guidance: "Armor trim format changed significantly in 1.21.5.", note: "Trim format updated in 1.21.5" },
  // =============================================================================
  // 3. Command rewrite strategies — was fixer.ts CMD_REWRITES (38 rules)
  // =============================================================================
  { id: "item_to_replaceitem", type: "command", scope: "datapack", match: "item", description: "/item replace -> /replaceitem", fix: { kind: 'rewrite', pattern: /^\/item\s+replace\s+(entity|block)\s+(\S+)\s+(\S+)\s+with\s+(\S+)\s*(.*)$/, replacement: "/replaceitem $1 $2 $3 $4 $5", sourceSince: "1.20.5", targetUntil: "1.20.4" } },
  { id: "item_modify_to_replaceitem", type: "command", scope: "datapack", match: "item", description: "/item modify commented out (no pre-1.20.5 equivalent)", fix: { kind: 'rewrite', pattern: /^\/item\s+modify\s+(entity|block)\s+(\S+)\s+(\S+)\s+(.*)$/, replacement: "## FIXED(/item modify -> not available in pre-1.20.5): $0", sourceSince: "1.20.5", targetUntil: "1.20.4" } },
  { id: "replaceitem_to_item", type: "command", scope: "datapack", match: "replaceitem", description: "/replaceitem -> /item replace (1.20.5+ syntax)", fix: { kind: 'rewrite', pattern: /^\/replaceitem\s+(entity|block)\s+(\S+)\s+(\S+)\s+(\S+)\s*(.*)$/, replacement: "/item replace $1 $2 $3 with $4 $5", sourceSince: "1.13", targetSince: "1.20.5" } },
  { id: "placefeature_to_place", type: "command", scope: "datapack", match: "placefeature", description: "/placefeature -> /place feature", fix: { kind: 'rewrite', pattern: /^\/placefeature\s+(.*)$/, replacement: "/place feature $1", sourceSince: "1.18", targetSince: "1.19" } },
  { id: "place_to_placefeature", type: "command", scope: "datapack", match: "place", description: "/place feature -> /placefeature", fix: { kind: 'rewrite', pattern: /^\/place\s+feature\s+(.*)$/, replacement: "/placefeature $1", sourceSince: "1.19", targetUntil: "1.18.2" } },
  { id: "execute_items_to_data", type: "command", scope: "datapack", match: "execute", description: "/execute items -> /execute data (pre-1.20.5)", fix: { kind: 'rewrite', pattern: /^(\/execute\s+(?:if|unless)\s+)items\s+(entity|block)\s+(\S+)\s+(\S+)\s+(.*)$/, replacement: "$1data $2 $3 $4", sourceSince: "1.20.5", targetUntil: "1.20.4" } },
  { id: "damage_comment", type: "command", scope: "datapack", match: "damage", description: "/damage commented out (use /effect instant_damage pre-1.19.4)", fix: { kind: 'rewrite', pattern: /^\/damage\s/, replacement: "## FIXED(/damage not available pre-1.19.4): $0", sourceSince: "1.19.4", targetUntil: "1.19.3" } },
  { id: "ride_comment", type: "command", scope: "datapack", match: "ride", description: "/ride commented out (use /tp + /data merge pre-1.19.4)", fix: { kind: 'rewrite', pattern: /^\/ride\s/, replacement: "## FIXED(/ride not available pre-1.19.4): $0", sourceSince: "1.19.4", targetUntil: "1.19.3" } },
  { id: "return_run_strip", type: "command", scope: "datapack", match: "return", description: "/return run -> inner command only (pre-1.20.4)", fix: { kind: 'rewrite', pattern: /^\/return\s+run\s+(.*)$/, replacement: "$1 ## FIXED(return run stripped, pre-1.20.4)", sourceSince: "1.20.4", targetUntil: "1.20.3" } },
  { id: "return_comment", type: "command", scope: "datapack", match: "return", description: "/return commented out (pre-1.20)", fix: { kind: 'rewrite', pattern: /^\/return\s/, replacement: "## FIXED(/return not available pre-1.20): $0", sourceSince: "1.20", targetUntil: "1.19.4" } },
  { id: "schedule_comment", type: "command", scope: "datapack", match: "schedule", description: "/schedule commented out (use ticking function pre-1.14)", fix: { kind: 'rewrite', pattern: /^\/schedule\s/, replacement: "## FIXED(/schedule not available pre-1.14): $0", sourceSince: "1.14", targetUntil: "1.13.2" } },
  { id: "attribute_comment", type: "command", scope: "datapack", match: "attribute", description: "/attribute commented out (use /data merge pre-1.16)", fix: { kind: 'rewrite', pattern: /^\/attribute\s/, replacement: "## FIXED(/attribute not available pre-1.16): $0", sourceSince: "1.16", targetUntil: "1.15.2" } },
  { id: "random_comment", type: "command", scope: "datapack", match: "random", description: "/random commented out (use /scoreboard random pre-1.20.2)", fix: { kind: 'rewrite', pattern: /^\/random\s/, replacement: "## FIXED(/random not available pre-1.20.2): $0", sourceSince: "1.20.2", targetUntil: "1.20.1" } },
  { id: "fillbiome_comment", type: "command", scope: "datapack", match: "fillbiome", description: "/fillbiome commented out", fix: { kind: 'rewrite', pattern: /^\/fillbiome\s/, replacement: "## FIXED(/fillbiome not available pre-1.19.3): $0", sourceSince: "1.19.3", targetUntil: "1.19.2" } },
  { id: "tick_comment", type: "command", scope: "datapack", match: "tick", description: "/tick commented out (admin command)", fix: { kind: 'rewrite', pattern: /^\/tick\s/, replacement: "## FIXED(/tick not available pre-1.20.3): $0", sourceSince: "1.20.3", targetUntil: "1.20.2" } },
  { id: "transfer_comment", type: "command", scope: "datapack", match: "transfer", description: "/transfer commented out", fix: { kind: 'rewrite', pattern: /^\/transfer\s/, replacement: "## FIXED(/transfer not available pre-1.20.5): $0", sourceSince: "1.20.5", targetUntil: "1.20.4" } },
  { id: "dialog_comment", type: "command", scope: "datapack", match: "dialog", description: "/dialog commented out", fix: { kind: 'rewrite', pattern: /^\/dialog\s/, replacement: "## FIXED(/dialog not available pre-1.21.6): $0", sourceSince: "1.21.6", targetUntil: "1.21.5" } },
  { id: "waypoint_comment", type: "command", scope: "datapack", match: "waypoint", description: "/waypoint commented out", fix: { kind: 'rewrite', pattern: /^\/waypoint\s/, replacement: "## FIXED(/waypoint not available pre-1.21.6): $0", sourceSince: "1.21.6", targetUntil: "1.21.5" } },
  { id: "version_cmd_comment", type: "command", scope: "datapack", match: "version", description: "/version command commented out", fix: { kind: 'rewrite', pattern: /^\/version\s/, replacement: "## FIXED(/version not available pre-1.21.6): $0", sourceSince: "1.21.6", targetUntil: "1.21.5" } },
  { id: "rotate_comment", type: "command", scope: "datapack", match: "rotate", description: "/rotate commented out (use /data merge pre-1.21.2)", fix: { kind: 'rewrite', pattern: /^\/rotate\s/, replacement: "## FIXED(/rotate not available pre-1.21.2): $0", sourceSince: "1.21.2", targetUntil: "1.21.1" } },
  { id: "test_comment", type: "command", scope: "datapack", match: "test", description: "/test commented out (game test framework)", fix: { kind: 'rewrite', pattern: /^\/test\s/, replacement: "## FIXED(/test not available pre-1.21.4): $0", sourceSince: "1.21.4", targetUntil: "1.21.3" } },
  { id: "fetchprofile_comment", type: "command", scope: "datapack", match: "fetchprofile", description: "/fetchprofile commented out", fix: { kind: 'rewrite', pattern: /^\/fetchprofile\s/, replacement: "## FIXED(/fetchprofile not available pre-1.21.9): $0", sourceSince: "1.21.9", targetUntil: "1.21.8" } },
  { id: "swing_comment", type: "command", scope: "datapack", match: "swing", description: "/swing commented out", fix: { kind: 'rewrite', pattern: /^\/swing\s/, replacement: "## FIXED(/swing not available pre-26.1): $0", sourceSince: "26.1", targetUntil: "26.0" } },
  { id: "unpublish_comment", type: "command", scope: "datapack", match: "unpublish", description: "/unpublish commented out", fix: { kind: 'rewrite', pattern: /^\/unpublish\s/, replacement: "## FIXED(/unpublish not available pre-26.2): $0", sourceSince: "26.2", targetUntil: "26.1" } },
  { id: "posteffect_comment", type: "command", scope: "datapack", match: "posteffect", description: "/posteffect commented out", fix: { kind: 'rewrite', pattern: /^\/posteffect\s/, replacement: "## FIXED(/posteffect not available pre-26.3): $0", sourceSince: "26.3", targetUntil: "26.2" } },
  { id: "bossbar_players_comment", type: "command", scope: "datapack", match: "bossbar", description: "/bossbar set players commented out", fix: { kind: 'rewrite', pattern: /^\/bossbar\s+set\s+\S+\s+players\s/, replacement: "## FIXED(/bossbar set players not available pre-1.20.5): $0", sourceSince: "1.20.5", targetUntil: "1.20.4" } },
  { id: "components_to_nbt", type: "command", scope: "datapack", match: "give", description: "Item component [syntax] stripped (use NBT tag pre-1.20.5)", fix: { kind: 'rewrite', pattern: /^(\/give\s+\S+)\s+([\w:.-]+)\[(.*?)\]\s*(.*)$/, replacement: "$1 $2$4 ## FIXED: removed [components] syntax (not available pre-1.20.5)", sourceSince: "1.20.5", targetUntil: "1.20.4" } },
  { id: "components_to_nbt_clear", type: "command", scope: "datapack", match: "clear", description: "Item component [syntax] stripped (use NBT tag pre-1.20.5)", fix: { kind: 'rewrite', pattern: /^(\/clear\s+\S+)\s+([\w:.-]+)\[(.*?)\]\s*(.*)$/, replacement: "$1 $2$4 ## FIXED: removed [components] syntax (not available pre-1.20.5)", sourceSince: "1.20.5", targetUntil: "1.20.4" } },
  { id: "macro_comment", type: "command", scope: "datapack", match: "", description: "Macro $() syntax commented out (pre-1.20.4)", fix: { kind: 'rewrite', pattern: /\$\w*\([^)]*\)/, replacement: "## FIXED: $(macro) syntax not available pre-1.20.4 — original: $0", sourceSince: "1.20.4", targetUntil: "1.20.3" } },
  { id: "execute_in_comment", type: "command", scope: "datapack", match: "execute", description: "/execute in (dimension) commented out (pre-1.16)", fix: { kind: 'rewrite', pattern: /^\/execute\s+.*\s+in\s+\S+\s/, replacement: "## FIXED(/execute in requires 1.16+): $0", sourceSince: "1.16", targetUntil: "1.15.2" } },
  { id: "execute_if_predicate_comment", type: "command", scope: "datapack", match: "execute", description: "/execute if predicate commented out (pre-1.15)", fix: { kind: 'rewrite', pattern: /^\/execute\s+.*\s+(?:if|unless)\s+predicate\s/, replacement: "## FIXED(/execute if predicate requires 1.15+): $0", sourceSince: "1.15", targetUntil: "1.14.4" } },
  { id: "execute_if_function_comment", type: "command", scope: "datapack", match: "execute", description: "/execute if function commented out (pre-1.20)", fix: { kind: 'rewrite', pattern: /^\/execute\s+.*\s+(?:if|unless)\s+function\s/, replacement: "## FIXED(/execute if function requires 1.20+): $0", sourceSince: "1.20", targetUntil: "1.19.4" } },
  { id: "execute_on_comment", type: "command", scope: "datapack", match: "execute", description: "/execute on (relations) commented out (pre-1.19.4)", fix: { kind: 'rewrite', pattern: /^\/execute\s+.*\s+on\s+(?:origin|attacker|target|vehicle|mount|passengers|controller)\b/, replacement: "## FIXED(/execute on requires 1.19.4+): $0", sourceSince: "1.19.4", targetUntil: "1.19.3" } },
  { id: "execute_rotated_comment", type: "command", scope: "datapack", match: "execute", description: "/execute rotated as/over commented out (pre-1.20)", fix: { kind: 'rewrite', pattern: /^\/execute\s+.*\s+rotated\s+(?:as|over)\s/, replacement: "## FIXED(/execute rotated requires 1.20+): $0", sourceSince: "1.20", targetUntil: "1.19.4" } },
  { id: "scoreboard_numberformat_comment", type: "command", scope: "datapack", match: "scoreboard", description: "/scoreboard numberformat commented out (pre-1.20.3)", fix: { kind: 'rewrite', pattern: /^\/scoreboard\s+.*\s+numberformat\s/, replacement: "## FIXED(/scoreboard numberformat requires 1.20.3+): $0", sourceSince: "1.20.3", targetUntil: "1.20.2" } },
  { id: "scoreboard_displayname_comment", type: "command", scope: "datapack", match: "scoreboard", description: "/scoreboard displayname commented out (pre-1.20.3)", fix: { kind: 'rewrite', pattern: /^\/scoreboard\s+.*\s+displayname\s/, replacement: "## FIXED(/scoreboard displayname requires 1.20.3+): $0", sourceSince: "1.20.3", targetUntil: "1.20.2" } },
  { id: "give_item_model_comment", type: "command", scope: "datapack", match: "give", description: "/give with item_model component commented out (pre-1.21.4)", fix: { kind: 'rewrite', pattern: /^\/give\s+\S+\s+\S+\s*.*minecraft:item_model\b/, replacement: "## FIXED(minecraft:item_model requires 1.21.4+): $0", sourceSince: "1.21.4", targetUntil: "1.21.3" } },
  { id: "give_consumable_comment", type: "command", scope: "datapack", match: "give", description: "/give with consumable component commented out (pre-1.21.2)", fix: { kind: 'rewrite', pattern: /^\/give\s+\S+\s+\S+\s*.*minecraft:consumable\b/, replacement: "## FIXED(minecraft:consumable requires 1.21.2+): $0", sourceSince: "1.21.2", targetUntil: "1.21.1" } },
  // =============================================================================
  // 4. JSON field rename rules — was json-format-check.ts local rename tables
  // =============================================================================
  { id: 'predicate_alternative_to_any_of', type: 'json_field', jsonKind: 'predicate', match: 'alternative', since: '1.20', description: "Predicate field 'alternative' renamed to 'any_of' in 1.20", fix: { kind: 'rename_field', from: 'alternative', to: 'any_of', since: '1.20' } },
  { id: 'predicate_requirements_to_all_of', type: 'json_field', jsonKind: 'predicate', match: 'requirements', since: '1.20', description: "Predicate field 'requirements' renamed to 'all_of' in 1.20", fix: { kind: 'rename_field', from: 'requirements', to: 'all_of', since: '1.20' } },
  { id: 'recipe_result_item_to_id', type: 'json_field', jsonKind: 'recipe', match: 'item', since: '1.20.5', description: "Recipe result key 'item' renamed to 'id' in 1.20.5", fix: { kind: 'rename_field', from: 'item', to: 'id', since: '1.20.5' } },
  { id: "trade_registry", type: "registry", scope: "datapack", match: "trade/", since: "26.1", description: "Data-driven villager trades (data/<ns>/trade/) require 26.1+", guidance: "Villager trades became data-driven in 26.1; use data/<namespace>/trade/ files.", note: "Trades data-driven since 26.1" },
  { id: "worldgen_material_rule", type: "registry", scope: "datapack", match: "worldgen/material_rule", since: "26.3", description: "worldgen/material_rule registry added in 26.3", guidance: "material_rule entries are 26.3+ only.", note: "Added in 26.3" },
  { id: "worldgen_material_condition", type: "registry", scope: "datapack", match: "worldgen/material_condition", since: "26.3", description: "worldgen/material_condition registry added in 26.3", guidance: "material_condition entries are 26.3+ only.", note: "Added in 26.3" },
  { id: 'predicate_durability_removed', type: 'json_field', jsonKind: 'predicate', match: 'durability', since: '1.20.5', description: "Item predicate field 'durability' removed in 1.20.5 (use component sub-predicates)", guidance: "Replace 'durability' with component-based sub-predicates (minecraft:durability).", fix: { kind: 'remove_field', field: 'durability' } },
  { id: 'predicate_potions_removed', type: 'json_field', jsonKind: 'predicate', match: 'potions', since: '1.20.5', description: "Item predicate field 'potions' removed in 1.20.5 (use component sub-predicates)", guidance: "Replace 'potions' with component-based sub-predicates (minecraft:potion_contents).", fix: { kind: 'remove_field', field: 'potions' } },
]

export interface RegistryRename {
  from: string
  to: string
  since: string
  registry?: string
}

export const REGISTRY_RENAMES: RegistryRename[] = [
  // Curated renames — verified against Minecraft release notes.
  { from: 'minecraft:grass', to: 'minecraft:short_grass', since: '1.20.3', registry: 'block' },
  { from: 'minecraft:sweeping', to: 'minecraft:sweeping_edge', since: '1.20.5', registry: 'enchantment' },
  // Game-rule renames, verified from Minecraft release notes (snapshot 25w44a shipped 1.21.11).
  { from: 'useLocatorBar', to: 'locatorBar', since: '1.21.6', registry: 'game_rule' },
  { from: 'enableCommandBlocks', to: 'commandBlocksEnabled', since: '1.21.9', registry: 'game_rule' },
  { from: 'doDaylightCycle', to: 'minecraft:advance_time', since: '1.21.11', registry: 'game_rule' },
  { from: 'doMobSpawning', to: 'minecraft:spawn_mobs', since: '1.21.11', registry: 'game_rule' },
  { from: 'mobGriefing', to: 'minecraft:mob_griefing', since: '1.21.11', registry: 'game_rule' },
  { from: 'spawnMonsters', to: 'minecraft:spawn_monsters', since: '1.21.11', registry: 'game_rule' },
  { from: 'commandBlocksEnabled', to: 'minecraft:command_blocks_work', since: '1.21.11', registry: 'game_rule' },
  { from: 'spawnerBlocksEnabled', to: 'minecraft:spawner_blocks_work', since: '1.21.11', registry: 'game_rule' },
  { from: 'disableElytraMovementCheck', to: 'minecraft:elytra_movement_check', since: '1.21.11', registry: 'game_rule' },
]

// =============================================================================
// Backward-compatible derived views
// =============================================================================

/** Datapack-only rule type union (was knowledge.ts FeatureType). */
export type FeatureType = Exclude<PortRuleType, 'resource_path'>

/** Historical FeatureRule shape (was knowledge.ts). */
export interface FeatureRule {
  id: string
  description: string
  type: FeatureType
  /** Root command name, regex, registry name, or json field to match */
  match: string
  /** Minimum MC version that supports this feature (e.g. "1.20.5") */
  minVersion: string
  /** If set, feature was removed/changed after this version */
  maxVersion?: string
  fix?: string
  /** Community source / confidence note */
  note?: string
}

/** Historical ResourceFeatureRule shape (was resource-knowledge.ts). */
export interface ResourceFeatureRule {
  id: string
  description: string
  /** Regex pattern or root key to match in resource paths */
  match: string
  minVersion: string
  /** If set, feature was removed/changed after this version */
  maxVersion?: string
  fix?: string
  note?: string
}

/** Historical CmdRewrite shape (was fixer.ts). */
export interface CmdRewrite {
  id: string
  /** Match command root (e.g. 'item', 'place') */
  matchRoot: string
  /** Pattern to match the full command line */
  pattern: RegExp
  /** Replacement template (use $1, $2 etc from pattern groups) */
  replacement: string
  /** Human description of what this fix does */
  description: string
  /** Minimum source version for this pattern to apply (e.g. '1.20.5' means "only rewrite if source >= 1.20.5") */
  sourceSince?: string
  /** Maximum target version (e.g. '1.20.4' means "only rewrite if target <= 1.20.4") */
  targetUntil?: string
  /** Minimum target version (e.g. '1.20.5' means "only rewrite if target >= 1.20.5") */
  targetSince?: string
}

/**
 * Historical FEATURE_RULES view — exactly the datapack knowledge rules, in
 * original order. Rewrite strategies and json_field rename rules are NOT part
 * of the historical array; they are exposed via CMD_REWRITES / jsonFieldRenames.
 */
export const FEATURE_RULES: FeatureRule[] = PORT_RULES
  .filter(r => r.scope !== 'resource_pack' && r.fix?.kind !== 'rewrite' && r.type !== 'json_field')
  .map(r => ({
    id: r.id,
    description: r.description,
    type: r.type as FeatureType,
    match: String(r.match),
    minVersion: r.since!,
    maxVersion: r.until,
    fix: r.guidance,
    note: r.note,
  }))

/** Historical RESOURCE_FEATURE_RULES view — all resource-pack rules, original order. */
export const RESOURCE_FEATURE_RULES: ResourceFeatureRule[] = PORT_RULES
  .filter(r => r.scope === 'resource_pack')
  .map(r => ({
    id: r.id,
    description: r.description,
    match: String(r.match),
    minVersion: r.since!,
    maxVersion: r.until,
    fix: r.guidance,
    note: r.note,
  }))

/** Historical CMD_REWRITES view — all rewrite strategies, original order. */
export const CMD_REWRITES: CmdRewrite[] = PORT_RULES
  .filter((r): r is PortRule & { fix: RewriteFix } => r.fix?.kind === 'rewrite')
  .map(r => ({
    id: r.id,
    matchRoot: String(r.match),
    pattern: r.fix.pattern,
    replacement: r.fix.replacement,
    description: r.description,
    sourceSince: r.fix.sourceSince,
    targetUntil: r.fix.targetUntil,
    targetSince: r.fix.targetSince,
  }))

/**
 * JSON field renames for a given JSON file kind, as [oldName, newName, since]
 * tuples — was the PREDICATE_RENAMES table in json-format-check.ts.
 */
export function jsonFieldRenames(kind: 'predicate' | 'recipe'): [string, string, string][] {
  return PORT_RULES
    .filter(r => r.jsonKind === kind && r.fix?.kind === 'rename_field')
    .map(r => [String(r.match), (r.fix as RenameFieldFix).to, (r.fix as RenameFieldFix).since])
}
