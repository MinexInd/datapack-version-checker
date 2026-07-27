export type FeatureType = 'command' | 'command_pattern' | 'registry' | 'json_field' | 'function_macro'

export interface FeatureRule {
  id: string
  description: string
  type: FeatureType
  match: string
  minVersion: string
  maxVersion?: string
  fix?: string
  note?: string
}

export const FEATURE_RULES: FeatureRule[] = [
  // Commands added in 1.13
  {
    id: 'tag',
    description: 'The /tag command (entity tags) was added.',
    type: 'command',
    match: 'tag',
    minVersion: '1.13',
    fix: 'Use /scoreboard players tag in pre-1.13.',
    note: 'Replaced /scoreboard players tag in 1.13',
  },
  {
    id: 'team',
    description: 'The /team command (teams) was added.',
    type: 'command',
    match: 'team',
    minVersion: '1.13',
    fix: 'Use /scoreboard teams in pre-1.13.',
    note: 'Split from /scoreboard in 1.13',
  },
  {
    id: 'data_cmd',
    description: 'The /data command (get/merge/modify/remove) was added.',
    type: 'command',
    match: 'data',
    minVersion: '1.13',
    fix: 'Use /entitydata or /blockdata in pre-1.13.',
    note: 'Replaced /entitydata and /blockdata in 1.13',
  },
  {
    id: 'datapack_cmd',
    description: 'The /datapack command (enable/disable/list) was added.',
    type: 'command',
    match: 'datapack',
    minVersion: '1.13',
    fix: 'Datapacks do not exist in pre-1.13.',
    note: 'Added with data pack system in 1.13',
  },
  {
    id: 'bossbar_cmd',
    description: 'The /bossbar command was added.',
    type: 'command',
    match: 'bossbar',
    minVersion: '1.13',
    fix: 'Boss bars cannot be created via commands in pre-1.13.',
    note: 'Added in 1.13',
  },
  {
    id: 'forceload',
    description: 'The /forceload command was added.',
    type: 'command',
    match: 'forceload',
    minVersion: '1.13',
    fix: 'Use /chunk in pre-1.13 or manual chunk loading.',
    note: 'Renamed from /chunk in 1.13.1',
  },
  {
    id: 'experience',
    description: 'The /experience command (alias of /xp) was added.',
    type: 'command',
    match: 'experience',
    minVersion: '1.13',
    fix: 'Use /xp in pre-1.13.',
    note: 'Alias added in 1.13',
  },

  // Commands added in 1.14
  {
    id: 'loot',
    description: 'The /loot command was added.',
    type: 'command',
    match: 'loot',
    minVersion: '1.14',
    fix: 'Use /give or /data with loot tables in older versions.',
    note: 'Added in 18w43a (1.14)',
  },

  // Commands added in 1.15
  {
    id: 'spectate',
    description: 'The /spectate command was added.',
    type: 'command',
    match: 'spectate',
    minVersion: '1.15',
    fix: 'Spectate is 1.15+ only; use /tp in older versions.',
    note: 'Added in 19w40a (1.15)',
  },

  // Commands added in 1.16
  {
    id: 'locatebiome',
    description: 'The /locatebiome command was added.',
    type: 'command',
    match: 'locatebiome',
    minVersion: '1.16',
    fix: 'Use /locate biome (1.19+) or external tools for pre-1.16.',
    note: 'Added in 20w11a (1.16); merged into /locate in 1.19',
  },

  // Commands added in 1.17
  {
    id: 'item_cmd',
    description: 'The /item command (replace/modify) was added, replacing /replaceitem.',
    type: 'command',
    match: 'item',
    minVersion: '1.17',
    fix: 'Use /replaceitem in pre-1.17.',
    note: 'Added in 21w05a (1.17); /replaceitem deprecated',
  },
  {
    id: 'perf',
    description: 'The /perf command was added.',
    type: 'command',
    match: 'perf',
    minVersion: '1.17',
    fix: 'Perf is 1.17+ only.',
    note: 'Added in 21w11a (1.17)',
  },

  // Commands added in 1.18
  {
    id: 'jfr',
    description: 'The /jfr command (Java Flight Recorder) was added.',
    type: 'command',
    match: 'jfr',
    minVersion: '1.18',
    fix: 'JFR profiling is 1.18+ only.',
    note: 'Added in 21w37a (1.18)',
  },

  // Commands added in 1.18.2
  {
    id: 'placefeature',
    description: 'The /placefeature command was added.',
    type: 'command',
    match: 'placefeature',
    minVersion: '1.18.2',
    fix: 'Use /place feature (1.19+) or /setblock for older versions.',
    note: 'Added in 1.18.2; replaced by /place in 1.19',
  },

  // Commands added in 1.19
  {
    id: 'place',
    description: 'The /place command (feature/structure/jigsaw/template) replaced /placefeature.',
    type: 'command',
    match: 'place',
    minVersion: '1.19',
    fix: 'Pre-1.19 uses /placefeature (1.18) or /locate + manual building.',
    note: 'Added in 22w11a (1.19)',
  },

  // Commands added in 1.19.3
  {
    id: 'fillbiome',
    description: 'The /fillbiome command was added.',
    type: 'command',
    match: 'fillbiome',
    minVersion: '1.19.3',
    fix: 'Use /fill with biome NBT or world editing tools in older versions.',
    note: 'Added in 22w46a (1.19.3)',
  },

  // Commands added in 1.19.4
  {
    id: 'damage',
    description: 'The /damage command was added.',
    type: 'command',
    match: 'damage',
    minVersion: '1.19.4',
    fix: 'Use /effect with instant damage, /attribute, or /data to apply damage in older versions.',
    note: 'Added in 23w06a (1.19.4)',
  },
  {
    id: 'ride',
    description: 'The /ride command was added.',
    type: 'command',
    match: 'ride',
    minVersion: '1.19.4',
    fix: 'Use /tp or /data merge for entity mounting in older versions.',
    note: 'Added in 23w03a (1.19.4)',
  },

  // Commands added in 1.20
  {
    id: 'return',
    description: 'The /return command for functions was added.',
    type: 'command',
    match: 'return',
    minVersion: '1.20',
    fix: 'Restructure function logic to not early-return.',
    note: 'Added in 23w16a (1.20)',
  },

  // Commands added in 1.20.2
  {
    id: 'random',
    description: 'The /random command (value, roll, reset) was added.',
    type: 'command',
    match: 'random',
    minVersion: '1.20.2',
    fix: 'Replace with /scoreboard random (1.20.4) or a custom RNG via /scoreboard.',
    note: 'Added in 23w31a',
  },

  // Commands added in 1.20.3
  {
    id: 'tick',
    description: 'The /tick command (sprint/step/freeze/rate) was added.',
    type: 'command',
    match: 'tick',
    minVersion: '1.20.3',
    fix: 'Note: /tick is an admin/debug command and is NOT available in command blocks/datapacks by default.',
    note: 'Added in 23w43a (1.20.3); requires elevated permissions',
  },

  // Commands added in 1.20.5
  {
    id: 'transfer',
    description: 'The /transfer command was added.',
    type: 'command',
    match: 'transfer',
    minVersion: '1.20.5',
    fix: 'Transfer is 1.20.5+ only; no direct replacement in older versions.',
    note: 'Added in 24w04a (1.20.5)',
  },

  // Commands added in 1.21.4
  {
    id: 'test_command',
    description: 'The /test command (game test framework) requires 1.21.4+',
    type: 'command',
    match: 'test',
    minVersion: '1.21.4',
    fix: 'Game test commands are 1.21.4+ only.',
    note: 'Added in 1.21.4',
  },

  // Commands added in 1.21.6
  {
    id: 'version_cmd',
    description: 'The /version command was added.',
    type: 'command',
    match: 'version',
    minVersion: '1.21.6',
    fix: 'Version is 1.21.6+ only.',
    note: 'Added in 25w15a (1.21.6)',
  },
  {
    id: 'waypoint',
    description: 'The /waypoint command (Locator Bar) was added.',
    type: 'command',
    match: 'waypoint',
    minVersion: '1.21.6',
    fix: 'Waypoints are 1.21.6+ only (Locator Bar feature).',
    note: 'Added in 25w15a/25w17a (1.21.6)',
  },
  {
    id: 'dialog',
    description: 'The /dialog command (NPC dialog) was added.',
    type: 'command',
    match: 'dialog',
    minVersion: '1.21.6',
    fix: 'Dialog is 1.21.6+ only.',
    note: 'Added in 25w20a (1.21.6)',
  },

  // Commands added in 1.21.9
  {
    id: 'fetchprofile',
    description: 'The /fetchprofile command was added.',
    type: 'command',
    match: 'fetchprofile',
    minVersion: '1.21.9',
    fix: 'Fetchprofile is 1.21.9+ only.',
    note: 'Added in 25w34a (1.21.9)',
  },

  // Commands added in 26.x
  {
    id: 'swing',
    description: 'The /swing command (animate arm swing) was added.',
    type: 'command',
    match: 'swing',
    minVersion: '26.1',
    fix: 'Swing is 26.1+ only.',
    note: 'Added in 26.1 snapshot 1',
  },
  {
    id: 'unpublish',
    description: 'The /unpublish command (LanServerProperties) was added.',
    type: 'command',
    match: 'unpublish',
    minVersion: '26.2',
    fix: 'Unpublish is 26.2+ only.',
    note: 'Added in 26.2 snapshot 8',
  },
  {
    id: 'posteffect',
    description: 'The /posteffect command was added.',
    type: 'command',
    match: 'posteffect',
    minVersion: '26.3',
    fix: 'Posteffect is 26.3+ only.',
    note: 'Added in 26.3 snapshot 3',
  },

  // Function macros (1.20.4)
  {
    id: 'function_macro',
    description: 'Function macros with $(variable) and line continuation require 1.20.4+',
    type: 'function_macro',
    match: '\\$\\(',
    minVersion: '1.20.4',
    fix: 'Macros are 1.20.4+. Use /function with multiple hardcoded functions for older versions.',
    note: 'Macros + line continuation added in 23w45a',
  },

  // Item component patterns
  {
    id: 'item_components_give',
    description: 'Item components [components] syntax in /give requires 1.20.5+',
    type: 'command_pattern',
    match: '^/?(?:give|clear)\\s+\\S+\\s+[\\w.:-]+\\[',
    minVersion: '1.20.5',
    fix: 'Use NBT tag:{...} instead of [components] for pre-1.20.5, or split by version.',
    note: 'Item component format changed in 24w09a',
  },
  {
    id: 'item_command',
    description: 'The /item command (replace/modify) overhaul requires 1.20.5+',
    type: 'command',
    match: 'item',
    minVersion: '1.20.5',
    fix: 'Use /replaceitem (pre-1.20.5) — note /item is the new preferred form in 1.20.5+.',
    note: 'Item component rework in 24w09a',
  },
  {
    id: 'execute_if_items',
    description: '/execute (if|unless) items requires 1.20.5+',
    type: 'command_pattern',
    match: '^/?(?:execute\\b.*\\b)(?:if|unless)\\s+items\\b',
    minVersion: '1.20.5',
    fix: 'Use /execute if data with NBT checks for item detection in older versions.',
    note: 'Added with component rework',
  },

  // Command patterns: registries
  {
    id: 'attribute',
    description: 'The /attribute command was added in 1.16.',
    type: 'command',
    match: 'attribute',
    minVersion: '1.16',
    fix: 'Use /data merge for attribute modifiers in pre-1.16 versions.',
    note: 'Added in 20w17a (1.16)',
  },
  {
    id: 'bossbar_players',
    description: '/bossbar set players subcommand requires 1.20.5+',
    type: 'command_pattern',
    match: '^/?(?:bossbar\\b.*\\b)players\\b',
    minVersion: '1.20.5',
    fix: 'Add players via /bossbar add then /bossbar set players in 1.20.5+.',
    note: 'bossbar players added 24w09a',
  },

  // Commands added in 1.14
  {
    id: 'schedule',
    description: 'The /schedule command was added in 1.14.',
    type: 'command',
    match: 'schedule',
    minVersion: '1.14',
    fix: 'Use a ticking function with /scoreboard timers in pre-1.14.',
    note: 'Added in 18w43a (1.14)',
  },
  {
    id: 'execute_if_unless',
    description: '/execute (if|unless) subconditions require 1.14+',
    type: 'command_pattern',
    match: '^/?(?:execute\\b.*\\b)(?:if|unless)\\s+',
    minVersion: '1.14',
    fix: 'Pre-1.14 /execute cannot conditionally test; use /testfor + /stats.',
    note: 'execute if/unless added in 1.14',
  },

  // The big 1.13 command overhaul
  {
    id: 'namespaced_ids',
    description: 'Namespaced IDs (minecraft:stone) and new /give syntax require 1.13+',
    type: 'command_pattern',
    match: '^/?(?:give|clear|replaceitem)\\s+\\S+\\s+minecraft:',
    minVersion: '1.13',
    fix: 'Pre-1.13 uses numeric item IDs. Use a legacy datapack for old versions.',
    note: '1.13 Aquatic command overhaul',
  },
  {
    id: 'execute_store',
    description: '/execute store syntax was added in 1.13',
    type: 'command_pattern',
    match: '^/?(?:execute\\b.*\\b)store\\s+',
    minVersion: '1.13',
    fix: 'Use /stats for score tracking in pre-1.13.',
    note: 'execute store replaced /stats in 1.13',
  },

  // Registries added in 1.21.5
  {
    id: 'wolf_variant',
    description: 'minecraft:wolf_variant registry added in 1.21.5',
    type: 'registry',
    match: 'wolf_variant',
    minVersion: '1.21.5',
    fix: 'Remove wolf_variant references for pre-1.21.5.',
    note: 'Added in 1.21.5',
  },
  {
    id: 'pig_variant',
    description: 'minecraft:pig_variant registry added in 1.21.5',
    type: 'registry',
    match: 'pig_variant',
    minVersion: '1.21.5',
    fix: 'Remove pig_variant references for pre-1.21.5.',
    note: 'Added in 1.21.5',
  },
  {
    id: 'cow_variant',
    description: 'minecraft:cow_variant registry added in 1.21.5',
    type: 'registry',
    match: 'cow_variant',
    minVersion: '1.21.5',
    fix: 'Remove cow_variant references for pre-1.21.5.',
    note: 'Added in 1.21.5',
  },
  {
    id: 'chicken_variant',
    description: 'minecraft:chicken_variant registry added in 1.21.5',
    type: 'registry',
    match: 'chicken_variant',
    minVersion: '1.21.5',
    fix: 'Remove chicken_variant references for pre-1.21.5.',
    note: 'Added in 1.21.5',
  },

  // Registries added in 1.21.2
  {
    id: 'instrument',
    description: 'minecraft:instrument registry (goat horns) added in 1.21.2',
    type: 'registry',
    match: 'instrument',
    minVersion: '1.21.2',
    fix: 'Goat horn instruments are 1.21.2+ only.',
    note: 'Added in 1.21.2 (Bundles of Bravery)',
  },

  // Registries added in 1.21
  {
    id: 'enchantment_registry',
    description: 'minecraft:enchantment registry (custom enchantments) requires 1.21+',
    type: 'registry',
    match: 'enchantment',
    minVersion: '1.21',
    fix: 'Custom enchantments are 1.21+ only.',
    note: 'Added in 1.21 (Tricky Trials)',
  },
  {
    id: 'enchantment_ref',
    description: 'Referencing a custom enchantment registry entry (enchantment/foo) requires 1.21+',
    type: 'registry',
    match: 'enchantment/',
    minVersion: '1.21',
    fix: 'Custom enchantments are 1.21+ only.',
    note: 'Added in 1.21 (Tricky Trials)',
  },
  {
    id: 'jukebox_song',
    description: 'minecraft:jukebox_song registry requires 1.21+',
    type: 'registry',
    match: 'jukebox_song',
    minVersion: '1.21',
    fix: 'Custom jukebox songs are 1.21+ only.',
    note: 'Added in 1.21',
  },
  {
    id: 'painting_variant',
    description: 'minecraft:painting_variant registry (data-driven paintings) requires 1.21+',
    type: 'registry',
    match: 'painting_variant',
    minVersion: '1.21',
    fix: 'Custom painting variants are 1.21+ only.',
    note: 'Added in 1.21 (Tricky Trials)',
  },
  {
    id: 'painting_variant_ref',
    description: 'Referencing painting_variant registry entries requires 1.21+',
    type: 'registry',
    match: 'painting_variant/',
    minVersion: '1.21',
    fix: 'Custom painting variants are 1.21+ only.',
    note: 'Added in 1.21 (Tricky Trials)',
  },

  // Registries added in 1.20
  {
    id: 'trim_pattern',
    description: 'minecraft:trim_pattern registry (armor trim patterns) requires 1.20+',
    type: 'registry',
    match: 'trim_pattern',
    minVersion: '1.20',
    fix: 'Custom trim patterns are 1.20+ only.',
    note: 'Added in 1.20 (Trails & Tales)',
  },
  {
    id: 'trim_material',
    description: 'minecraft:trim_material registry (armor trim materials) requires 1.20+',
    type: 'registry',
    match: 'trim_material',
    minVersion: '1.20',
    fix: 'Custom trim materials are 1.20+ only.',
    note: 'Added in 1.20 (Trails & Tales)',
  },
  {
    id: 'banner_pattern',
    description: 'minecraft:banner_pattern registry requires 1.20+',
    type: 'registry',
    match: 'banner_pattern',
    minVersion: '1.20',
    fix: 'Custom banner patterns are 1.20+ only.',
    note: 'Added in 1.20 (Trails & Tales)',
  },

  // Registries added in 1.19
  {
    id: 'chat_type',
    description: 'minecraft:chat_type registry (chat formatting) requires 1.19+',
    type: 'registry',
    match: 'chat_type',
    minVersion: '1.19',
    fix: 'Custom chat types are 1.19+ only.',
    note: 'Added in 1.19 (The Wild Update)',
  },

  // Registries added in 1.19.4
  {
    id: 'damage_type',
    description: 'minecraft:damage_type registry requires 1.19.4+',
    type: 'registry',
    match: 'damage_type',
    minVersion: '1.19.4',
    fix: 'Custom damage types are 1.19.4+ only.',
    note: 'Added in 1.19.4 (damage predicates overhauled)',
  },
  {
    id: 'damage_type_ref',
    description: 'Referencing damage_type entries (damage_type/foo) requires 1.19.4+',
    type: 'registry',
    match: 'damage_type/',
    minVersion: '1.19.4',
    fix: 'Custom damage type references are 1.19.4+ only.',
    note: 'Added in 1.19.4',
  },

  // Worldgen directories
  {
    id: 'worldgen_biome',
    description: 'Custom worldgen biomes require 1.16+',
    type: 'registry',
    match: 'worldgen/biome',
    minVersion: '1.16',
    fix: 'Custom biomes are 1.16+ only.',
    note: 'Worldgen system introduced in 1.16',
  },
  {
    id: 'worldgen_configured_feature',
    description: 'Custom configured features require 1.16+',
    type: 'registry',
    match: 'worldgen/configured_feature',
    minVersion: '1.16',
    fix: 'Custom configured features are 1.16+ only.',
    note: 'Worldgen system introduced in 1.16',
  },
  {
    id: 'worldgen_placed_feature',
    description: 'Custom placed features require 1.18+',
    type: 'registry',
    match: 'worldgen/placed_feature',
    minVersion: '1.18',
    fix: 'Custom placed features are 1.18+ only.',
    note: 'Placed features split from configured features in 1.18',
  },
  {
    id: 'worldgen_structure',
    description: 'Custom structure definitions require 1.19+',
    type: 'registry',
    match: 'worldgen/structure',
    minVersion: '1.19',
    fix: 'Custom structures are 1.19+ only.',
    note: 'Structure system reworked in 1.19',
  },
  {
    id: 'worldgen_structure_set',
    description: 'Custom structure sets require 1.19+',
    type: 'registry',
    match: 'worldgen/structure_set',
    minVersion: '1.19',
    fix: 'Custom structure sets are 1.19+ only.',
    note: 'Structure sets added in 1.19',
  },
  {
    id: 'worldgen_template_pool',
    description: 'Custom template pools require 1.16+',
    type: 'registry',
    match: 'worldgen/template_pool',
    minVersion: '1.16',
    fix: 'Custom template pools are 1.16+ only.',
    note: 'Added with jigsaw structure system in 1.16',
  },
  {
    id: 'worldgen_noise_settings',
    description: 'Custom noise settings require 1.18+',
    type: 'registry',
    match: 'worldgen/noise_settings',
    minVersion: '1.18',
    fix: 'Custom noise settings are 1.18+ only.',
    note: 'World generation completely restructured in 1.18',
  },
  {
    id: 'worldgen_density_function',
    description: 'Custom density functions require 1.19+',
    type: 'registry',
    match: 'worldgen/density_function',
    minVersion: '1.19',
    fix: 'Custom density functions are 1.19+ only.',
    note: 'Added in 1.19',
  },
  {
    id: 'worldgen_world_preset',
    description: 'Custom world presets require 1.19+',
    type: 'registry',
    match: 'worldgen/world_preset',
    minVersion: '1.19',
    fix: 'Custom world presets are 1.19+ only.',
    note: 'Added in 1.19',
  },
  {
    id: 'worldgen_noise_router',
    description: 'Custom noise routers require 1.19+',
    type: 'registry',
    match: 'worldgen/noise_router',
    minVersion: '1.19',
    fix: 'Custom noise routers are 1.19+ only.',
    note: 'Added in 1.19',
  },
  {
    id: 'dimension_type',
    description: 'Custom dimension types require 1.16+',
    type: 'registry',
    match: 'dimension_type',
    minVersion: '1.16',
    fix: 'Custom dimension types are 1.16+ only.',
    note: 'Custom dimensions introduced in 1.16',
  },

  // 1.20.4
  {
    id: 'return_run',
    description: '/return run requires 1.20.4+',
    type: 'command_pattern',
    match: '^/?(?:return\\s+run)',
    minVersion: '1.20.4',
    fix: 'Use /return (no run) or restructure for pre-1.20.4.',
    note: 'Added in 1.20.4',
  },

  // Command added in 1.21.2
  {
    id: 'rotate',
    description: 'The /rotate command (rotate entities) was added.',
    type: 'command',
    match: 'rotate',
    minVersion: '1.21.2',
    fix: 'Rotate is 1.21.2+ only; use /data merge to set Rotation NBT in older versions.',
    note: 'Added in 24w40a (1.21.2)',
  },

  // Item component sub-features
  {
    id: 'item_model_component',
    description: 'minecraft:item_model component requires 1.21.4+',
    type: 'command_pattern',
    match: '^/?(?:give|item|clear|loot)\\b[^\\n]*minecraft:item_model\\b',
    minVersion: '1.21.4',
    fix: 'item_model component is 1.21.4+; use numeric CustomModelData or resource-pack overrides for older versions.',
    note: 'item_model added 1.21.4 (DataComponents)',
  },
  {
    id: 'custom_model_data_compound',
    description: 'custom_model_data with floats/flags/strings/colors fields requires 1.21.4+',
    type: 'command_pattern',
    match: '^/?(?:give|item|clear|loot)\\b[^\\n]*custom_model_data=\\{[^}]*(?:floats|flags|strings|colors)\\b',
    minVersion: '1.21.4',
    fix: 'The rich custom_model_data format (floats/flags/strings/colors) is 1.21.4+; use a single integer value (custom_model_data=<n>) for 1.20.5-1.21.3.',
    note: 'custom_model_data extended format added 1.21.4',
  },
  {
    id: 'consumable_component',
    description: 'minecraft:consumable component requires 1.21.2+',
    type: 'command_pattern',
    match: '^/?(?:give|item|clear|loot)\\b[^\\n]*minecraft:consumable\\b',
    minVersion: '1.21.2',
    fix: 'consumable component is 1.21.2+; the food component alone no longer triggers consumption in 1.21.2+ (add consumable={}).',
    note: 'consumable component added 1.21.2; food no longer auto-consumes',
  },

  // Execute subcommand patterns
  {
    id: 'execute_if_function',
    description: '/execute if function requires 1.20+',
    type: 'command_pattern',
    match: '^/?(?:execute\\b.*\\b)(?:if|unless)\\s+function\\b',
    minVersion: '1.20',
    fix: 'Use /function with /scoreboard return values for pre-1.20.',
    note: 'execute if function added in 1.20 with /return',
  },
  {
    id: 'execute_if_predicate',
    description: '/execute if predicate requires 1.15+',
    type: 'command_pattern',
    match: '^/?(?:execute\\b.*\\b)(?:if|unless)\\s+predicate\\b',
    minVersion: '1.15',
    fix: 'Use /execute if block/data checks for pre-1.15.',
    note: 'execute if predicate added in 1.15',
  },
  {
    id: 'execute_on',
    description: '/execute on requires 1.19.4+',
    type: 'command_pattern',
    match: '^/?(?:execute\\b.*\\b)on\\s+',
    minVersion: '1.19.4',
    fix: 'Use /execute as/at with selectors for pre-1.19.4.',
    note: 'execute on (origin/attacker/target/vehicle/mount/passengers/controller) added 1.19.4',
  },
  {
    id: 'execute_rotated',
    description: '/execute rotated requires 1.20+',
    type: 'command_pattern',
    match: '^/?(?:execute\\b.*\\b)rotated\\s+(?:as|over)\\b',
    minVersion: '1.20',
    fix: 'Use /execute at with rotation modifiers for pre-1.20.',
    note: 'execute rotated as/over added in 1.20',
  },
  {
    id: 'execute_in',
    description: '/execute in requires 1.16+',
    type: 'command_pattern',
    match: '^/?(?:execute\\b.*\\b)in\\s+',
    minVersion: '1.16',
    fix: 'Use /execute in via dimension teleportation for pre-1.16.',
    note: 'execute in (dimension) added in 1.16',
  },

  // Scoreboard patterns
  {
    id: 'scoreboard_numberformat',
    description: 'Scoreboard numberformat/displayname modifications require 1.20.3+',
    type: 'command_pattern',
    match: '^/?(?:scoreboard\\b.*\\b)(?:numberformat|displayname|rendertype)\\b',
    minVersion: '1.20.3',
    fix: 'Number format and display name modifications are 1.20.3+ only.',
    note: 'Added in 1.20.3',
  },

  // Predicate/loot patterns
  {
    id: 'loot_command',
    description: '/loot command requires 1.14+',
    type: 'command_pattern',
    match: '^/?(?:loot\\b)',
    minVersion: '1.14',
    fix: 'Use /give or /data for item distribution in pre-1.14.',
    note: 'Loot command added in 1.14',
  },

  // Dialog registry (1.21.6+)
  {
    id: 'dialog_registry',
    description: 'minecraft:dialog registry requires 1.21.6+',
    type: 'registry',
    match: 'dialog',
    minVersion: '1.21.6',
    fix: 'Dialog system is 1.21.6+ only.',
    note: 'Added in 1.21.6 (experimental)',
  },

  // Predicate directory (1.15+)
  {
    id: 'predicate_dir',
    description: 'The predicates/ directory structure was formalized in 1.15+',
    type: 'registry',
    match: 'predicates/',
    minVersion: '1.15',
    fix: 'Predicates directory structure changed in 1.15.',
    note: 'Custom predicates formalized in 1.15',
  },
]
