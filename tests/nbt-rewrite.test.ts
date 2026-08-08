import { describe, it, expect } from 'vitest'
import { rewriteNbtInLine } from '../src/nbt-rewrite.js'

// ===========================================================================
// T1 — Equipment: HandItems/ArmorItems -> equipment
// ===========================================================================
describe('T1: HandItems/ArmorItems -> equipment', () => {
  it('converts HandItems + ArmorItems with all slots', () => {
    const input = 'summon minecraft:wither_skeleton ~1 ~ ~ {HandItems:[{id:"minecraft:stone_sword",count:1},{}],ArmorItems:[{id:"minecraft:iron_boots",count:1},{},{},{}]}'
    const expected = 'summon minecraft:wither_skeleton ~1 ~ ~ {equipment:{mainhand:{id:"minecraft:stone_sword",count:1},feet:{id:"minecraft:iron_boots",count:1}}}'
    const { line, changed } = rewriteNbtInLine(input)
    expect(changed).toBe(true)
    expect(line).toBe(expected)
  })

  it('converts HandItems with offhand slot', () => {
    const input = 'summon armor_stand ~ ~1.2 ~ {HandItems:[{id:"minecraft:netherite_sword",count:1},{}]}'
    const expected = 'summon armor_stand ~ ~1.2 ~ {equipment:{mainhand:{id:"minecraft:netherite_sword",count:1}}}'
    const { line, changed } = rewriteNbtInLine(input)
    expect(changed).toBe(true)
    expect(line).toBe(expected)
  })

  it('converts ArmorItems only (no HandItems)', () => {
    const input = 'execute rotated 0 0 run summon armor_stand ^4 ^ ^ {Tags:["wither_decoy"],ArmorItems:[{},{},{id:"minecraft:netherite_chestplate",count:1},{id:"minecraft:wither_skeleton_skull",count:1}]}'
    const expected = 'execute rotated 0 0 run summon armor_stand ^4 ^ ^ {Tags:["wither_decoy"],equipment:{head:{id:"minecraft:wither_skeleton_skull",count:1},chest:{id:"minecraft:netherite_chestplate",count:1}}}'
    const { line, changed } = rewriteNbtInLine(input)
    expect(changed).toBe(true)
    expect(line).toBe(expected)
  })

  it('preserves canonical order: mainhand, offhand, head, chest, legs, feet', () => {
    const input = 'summon zombie ~ ~ ~ {ArmorItems:[{id:"a",count:1},{id:"b",count:1},{id:"c",count:1},{id:"d",count:1}],HandItems:[{id:"e",count:1},{id:"f",count:1}]}'
    const { line, changed } = rewriteNbtInLine(input)
    expect(changed).toBe(true)
    expect(line).toContain('mainhand:{id:"e"')
    expect(line).toContain('offhand:{id:"f"')
    expect(line).toContain('head:{id:"d"')
    expect(line).toContain('chest:{id:"c"')
    expect(line).toContain('legs:{id:"b"')
    expect(line).toContain('feet:{id:"a"')
    // verify order
    const mainIdx = line.indexOf('mainhand')
    const offIdx = line.indexOf('offhand')
    const headIdx = line.indexOf('head')
    const chestIdx = line.indexOf('chest')
    const legsIdx = line.indexOf('legs')
    const feetIdx = line.indexOf('feet')
    expect(mainIdx).toBeLessThan(offIdx)
    expect(offIdx).toBeLessThan(headIdx)
    expect(headIdx).toBeLessThan(chestIdx)
    expect(chestIdx).toBeLessThan(legsIdx)
    expect(legsIdx).toBeLessThan(feetIdx)
  })

  it('drops all-empty equipment and does not produce empty equipment', () => {
    const input = 'summon zombie ~ ~ ~ {HandItems:[{},{}],ArmorItems:[{},{},{},{}]}'
    const { changed } = rewriteNbtInLine(input)
    expect(changed).toBe(false)
  })

  it('converts HandItems whose item has deeply nested components (bane_throw corpus)', () => {
    const input = 'summon armor_stand ~ ~1.2 ~ {Marker:1b,Invisible:1b,NoGravity:1b,Invulnerable:1b,Tags:["wither_bane_proj","wither_bane_fresh"],Pose:{RightArm:[350f,0f,0f]},HandItems:[{id:"minecraft:netherite_sword",count:1,components:{"minecraft:custom_data":{wither_bane:1b},"minecraft:enchantment_glint_override":true,"minecraft:food":{nutrition:0,saturation:0,eat_seconds:10000.0,can_always_eat:1b},"minecraft:item_name":{"text":"Wither-Bane Blade","color":"aqua","bold":true,"italic":false},"minecraft:lore":[{"text":"Forged from a Withered Core.","color":"gray","italic":true},{"text":"Soul-Anchors the Wither on hit.","color":"dark_aqua"},{"text":"Right-click to hurl it.","color":"blue"},{"text":"Dodge Disabled for 8s.","color":"blue"}]}},{}]}'
    const expected = 'summon armor_stand ~ ~1.2 ~ {Marker:1b,Invisible:1b,NoGravity:1b,Invulnerable:1b,Tags:["wither_bane_proj","wither_bane_fresh"],Pose:{RightArm:[350f,0f,0f]},equipment:{mainhand:{id:"minecraft:netherite_sword",count:1,components:{"minecraft:custom_data":{wither_bane:1b},"minecraft:enchantment_glint_override":true,"minecraft:food":{nutrition:0,saturation:0,eat_seconds:10000.0,can_always_eat:1b},"minecraft:item_name":{"text":"Wither-Bane Blade","color":"aqua","bold":true,"italic":false},"minecraft:lore":[{"text":"Forged from a Withered Core.","color":"gray","italic":true},{"text":"Soul-Anchors the Wither on hit.","color":"dark_aqua"},{"text":"Right-click to hurl it.","color":"blue"},{"text":"Dodge Disabled for 8s.","color":"blue"}]}}}}'
    const { line, changed } = rewriteNbtInLine(input)
    expect(changed).toBe(true)
    expect(line).toBe(expected)
  })

  it('complex minion with CustomName + HandItems + ArmorItems + active_effects', () => {
    const input = `execute if score #e temp matches 1..25 run summon minecraft:wither_skeleton ~ ~ ~ {Tags:["soul_knight"],CustomName:'{"text":"Soul Knight","color":"dark_purple","bold":true}',HandItems:[{id:"minecraft:netherite_sword",count:1,components:{"minecraft:enchantments":{"minecraft:sharpness":3}}},{}],ArmorItems:[{id:"minecraft:netherite_boots"},{},{id:"minecraft:netherite_chestplate"},{}],active_effects:[{id:"minecraft:strength",amplifier:1,duration:999999,show_particles:1b}]}`
    const { line, changed } = rewriteNbtInLine(input)
    expect(changed).toBe(true)
    // Should have equipment instead of HandItems/ArmorItems
    expect(line).not.toContain('HandItems')
    expect(line).not.toContain('ArmorItems')
    expect(line).toContain('equipment:{')
    expect(line).toContain('mainhand:')
    expect(line).toContain('chest:')
    expect(line).toContain('feet:')
    // Should keep CustomName (T3 will handle separately)
    expect(line).toContain('CustomName:')
    expect(line).toContain('active_effects:')
  })
})

// ===========================================================================
// T2 — Attribute prefix normalization
// ===========================================================================
describe('T2: Attribute prefix normalization', () => {
  it('converts player.X to minecraft:X', () => {
    const input = 'summon item ~ ~1 ~ {components:{"minecraft:attribute_modifiers":[{type:"player.entity_interaction_range",amount:5,id:"wither:reach",operation:add_value}]}}'
    const { line, changed } = rewriteNbtInLine(input)
    expect(changed).toBe(true)
    expect(line).toContain('type:"minecraft:entity_interaction_range"')
    expect(line).not.toContain('player.')
  })

  it('converts generic.X to X', () => {
    const input = 'summon item ~ ~1 ~ {components:{"minecraft:attribute_modifiers":[{type:generic.attack_damage,amount:3,id:"wither:damage",operation:add_value}]}}'
    const { line, changed } = rewriteNbtInLine(input)
    expect(changed).toBe(true)
    expect(line).toContain('type:"attack_damage"')
    expect(line).not.toContain('generic.')
  })

  it('handles AttributeName key (legacy format)', () => {
    const input = 'give @s diamond_sword{AttributeModifiers:[{Slot:"mainhand",AttributeName:"generic.attack_damage",Amount:6}]}'
    const { line, changed } = rewriteNbtInLine(input)
    expect(changed).toBe(true)
    expect(line).toContain('AttributeName:"attack_damage"')
  })

  it('does not touch generic. in non-attribute contexts', () => {
    // generic.explode in playsound should NOT be modified
    const input = 'playsound minecraft:entity.generic.explode master @a ~ ~ ~ 1 0.9'
    const { changed } = rewriteNbtInLine(input)
    expect(changed).toBe(false)
  })

  it('handles both player and generic in same compound', () => {
    const input = 'summon item ~ ~1 ~ {components:{"minecraft:attribute_modifiers":[{type:"player.entity_interaction_range",amount:5},{type:generic.attack_damage,amount:3}]}}'
    const { line, changed } = rewriteNbtInLine(input)
    expect(changed).toBe(true)
    expect(line).toContain('type:"minecraft:entity_interaction_range"')
    expect(line).toContain('type:"attack_damage"')
  })
})

// ===========================================================================
// T3 — Stringified JSON -> structured
// ===========================================================================
describe('T3: Stringified JSON -> structured', () => {
  it('converts double-quoted stringified item_name', () => {
    const input = `summon item ~ ~1 ~ {Item:{id:"minecraft:netherite_sword",components:{"minecraft:item_name":"{\\"text\\":\\"Wither-Bane Blade\\",\\"color\\":\\"aqua\\"}"}}}`
    const { line, changed } = rewriteNbtInLine(input)
    expect(changed).toBe(true)
    expect(line).toContain('"minecraft:item_name":{"text":"Wither-Bane Blade","color":"aqua"}')
    // Should not have escaped quotes around the JSON
    expect(line).not.toContain('\\"text\\"')
  })

  it('converts single-quoted CustomName', () => {
    const input = `summon wither_skeleton ~ ~ ~ {CustomName:'{"text":"Soul Knight","color":"dark_purple","bold":true}'}`
    const { line, changed } = rewriteNbtInLine(input)
    expect(changed).toBe(true)
    expect(line).toContain(`CustomName:{"text":"Soul Knight","color":"dark_purple","bold":true}`)
  })

  it('converts lore array with stringified JSON elements', () => {
    const input = 'summon item ~ ~1 ~ {Item:{"minecraft:lore":["{\\"text\\":\\"Line 1\\",\\"color\\":\\"gray\\"}","{\\"text\\":\\"Line 2\\"}"]}}'
    const { line, changed } = rewriteNbtInLine(input)
    expect(changed).toBe(true)
    expect(line).toContain('{"text":"Line 1","color":"gray"}')
    expect(line).toContain('{"text":"Line 2"}')
    expect(line).not.toContain('\\"text\\"')
  })

  it('does not convert non-JSON string values', () => {
    const input = 'summon armor_stand ~ ~ ~ {CustomName:"My Stand"}'
    const { changed } = rewriteNbtInLine(input)
    // "My Stand" is not JSON object/array, should stay as-is
    expect(changed).toBe(false)
  })

  it('preserves existing structured JSON', () => {
    const input = 'summon item ~ ~1 ~ {Item:{"minecraft:item_name":{"text":"Already structured"}}}'
    const { changed } = rewriteNbtInLine(input)
    expect(changed).toBe(false)
  })
})

// ===========================================================================
// T4 — Count:1b -> count:1
// ===========================================================================
describe('T4: Count:1b -> count:1', () => {
  it('renames Count to count and strips b suffix', () => {
    const input = 'give @s diamond_sword{Count:1b,id:"minecraft:diamond_sword"}'
    const { line, changed } = rewriteNbtInLine(input)
    expect(changed).toBe(true)
    expect(line).toContain('count:1')
    expect(line).not.toContain('Count')
    expect(line).not.toContain('1b')
  })

  it('does not touch lowercase count without suffix', () => {
    const input = 'summon item ~ ~ ~ {Item:{id:"minecraft:netherite_sword",count:1}}'
    const { changed } = rewriteNbtInLine(input)
    expect(changed).toBe(false)
  })

  it('does not modify Count without an id key (non-item-stack)', () => {
    const input = 'data modify entity @s Count set value 5b'
    const { changed } = rewriteNbtInLine(input)
    expect(changed).toBe(false)
  })
})

// ===========================================================================
// Negative / edge cases
// ===========================================================================
describe('Edge cases', () => {
  it('skips comments', () => {
    const input = '# this is a comment with {HandItems:[{}]}'
    const { changed } = rewriteNbtInLine(input)
    expect(changed).toBe(false)
  })

  it('skips ## FIXED lines', () => {
    const input = '## FIXED(some description): original line'
    const { changed } = rewriteNbtInLine(input)
    expect(changed).toBe(false)
  })

  it('skips empty lines', () => {
    const { changed } = rewriteNbtInLine('')
    expect(changed).toBe(false)
  })

  it('no-op on already-ported file (equipment already present)', () => {
    const input = 'summon minecraft:wither_skeleton ~1 ~ ~ {equipment:{mainhand:{id:"minecraft:stone_sword",count:1},feet:{id:"minecraft:iron_boots",count:1}}}'
    const { changed } = rewriteNbtInLine(input)
    expect(changed).toBe(false)
  })

  it('does not match /data modify paths without colon', () => {
    // HandItems in a /data modify path has no colon and must NOT match T1
    const input = 'data modify entity @s HandItems[0] set value {id:"minecraft:stone_sword"}'
    const { changed } = rewriteNbtInLine(input)
    expect(changed).toBe(false)
  })

  it('handles $() macros with NBT', () => {
    const input = '$summon armor_stand ~ ~ ~ {HandItems:[{id:"minecraft:stone_sword",count:1},{}]}'
    const { line, changed } = rewriteNbtInLine(input)
    expect(changed).toBe(true)
    expect(line).toContain('equipment:')
    expect(line).not.toContain('HandItems')
  })

  it('handles nbt={...} selectors without matching as top-level command', () => {
    // nbt={...} inside @e[...] should still be processed if it has HandItems
    const input = 'kill @e[type=item,nbt={Item:{components:{"minecraft:custom_data":{withered_core:1b}}}}]'
    const { changed } = rewriteNbtInLine(input)
    // No HandItems/ArmorItems, so no T1; no stringified JSON for T3
    expect(changed).toBe(false)
  })

  it('handles escaped quotes in quoted strings', () => {
    const input = `summon item ~ ~1 ~ {Item:{id:"minecraft:heart_of_the_sea",components:{"minecraft:item_name":"{\\"text\\":\\"Test\\",\\"color\\":\\"red\\"}"}}}`
    const { line, changed } = rewriteNbtInLine(input)
    expect(changed).toBe(true)
    expect(line).toContain('"minecraft:item_name":{"text":"Test","color":"red"}')
  })

  it('handles inline /execute run subcommand with HandItems', () => {
    const input = 'execute at @s run summon armor_stand ~ ~ ~ {HandItems:[{id:"minecraft:stone_sword",count:1},{}]}'
    const { line, changed } = rewriteNbtInLine(input)
    expect(changed).toBe(true)
    expect(line).toContain('equipment:')
    expect(line).not.toContain('HandItems')
  })
})

// ===========================================================================
// Idempotency
// ===========================================================================
describe('Idempotency', () => {
  it('running twice produces same result', () => {
    const input = 'summon minecraft:wither_skeleton ~1 ~ ~ {HandItems:[{id:"minecraft:stone_sword",count:1},{}],ArmorItems:[{id:"minecraft:iron_boots",count:1},{},{},{}]}'
    const first = rewriteNbtInLine(input)
    const second = rewriteNbtInLine(first.line)
    expect(second.changed).toBe(false)
    expect(second.line).toBe(first.line)
  })

  it('idempotent on equipment lines', () => {
    const input = 'summon armor_stand ~ ~ ~ {equipment:{mainhand:{id:"minecraft:stone_sword",count:1},feet:{id:"minecraft:iron_boots",count:1}}}'
    const first = rewriteNbtInLine(input)
    expect(first.changed).toBe(false)
  })
})

// ===========================================================================
// Corpus-extracted real-world pairs
// ===========================================================================
describe('Corpus: bane_throw_mainhand (minions T1 + T3)', () => {
  it('transforms HandItems+ArmorItems to equipment', () => {
    const input = 'summon minecraft:wither_skeleton ~1 ~ ~ {HandItems:[{id:"minecraft:stone_sword",count:1},{}],ArmorItems:[{id:"minecraft:iron_boots",count:1},{},{},{}]}'
    const expected = 'summon minecraft:wither_skeleton ~1 ~ ~ {equipment:{mainhand:{id:"minecraft:stone_sword",count:1},feet:{id:"minecraft:iron_boots",count:1}}}'
    const { line, changed } = rewriteNbtInLine(input)
    expect(changed).toBe(true)
    expect(line).toBe(expected)
  })

  it('transforms shadow_clone ArmorItems to equipment', () => {
    const input = 'execute rotated 0 0 run summon armor_stand ^4 ^ ^ {Tags:["wither_decoy"],NoBasePlate:1b,ShowArms:1b,ArmorItems:[{},{},{id:"minecraft:netherite_chestplate",count:1},{id:"minecraft:wither_skeleton_skull",count:1}],Glowing:1b,Invulnerable:1b,Invisible:1b}'
    const expected = 'execute rotated 0 0 run summon armor_stand ^4 ^ ^ {Tags:["wither_decoy"],NoBasePlate:1b,ShowArms:1b,equipment:{head:{id:"minecraft:wither_skeleton_skull",count:1},chest:{id:"minecraft:netherite_chestplate",count:1}},Glowing:1b,Invulnerable:1b,Invisible:1b}'
    const { line, changed } = rewriteNbtInLine(input)
    expect(changed).toBe(true)
    expect(line).toBe(expected)
  })
})

describe('Corpus: death_effects (T2 + T3)', () => {
  it('handles attribute prefixes + stringified JSON in components', () => {
    const input = `execute at @e[type=marker,tag=wither_death_marker,limit=1] run summon item ~ ~1 ~ {Glowing:1b,Invulnerable:1b,Item:{id:"minecraft:heart_of_the_sea",count:1,components:{"minecraft:item_name":"{\\"text\\":\\"⚔ Wither Trophy\\",\\"color\\":\\"#ff0033\\",\\"bold\\":true,\\"italic\\":false}","minecraft:lore":["{\\"text\\":\\"☠ Boss Defeated\\",\\"color\\":\\"#ff4d4d\\",\\"bold\\":true,\\"italic\\":false}"],"minecraft:attribute_modifiers":[{type:"player.entity_interaction_range",amount:5,id:"wither:reach",operation:add_value},{type:generic.attack_damage,amount:3,id:"wither:damage",operation:add_value}]}}}`
    const { line, changed } = rewriteNbtInLine(input)
    expect(changed).toBe(true)
    // T2: attribute prefixes
    expect(line).toContain('type:"minecraft:entity_interaction_range"')
    expect(line).toContain('type:"attack_damage"')
    expect(line).not.toContain('player.')
    expect(line).not.toContain('generic.')
    // T3: stringified JSON
    expect(line).toContain('"minecraft:item_name":{"text":"⚔ Wither Trophy"')
    expect(line).toContain('{"text":"☠ Boss Defeated"')
  })
})

describe('Corpus: bane_proj_land (T3 in components)', () => {
  it('converts stringified item_name + lore inside Item components', () => {
    const input = 'summon item ~ ~0.2 ~ {PickupDelay:0,Glowing:1b,Invulnerable:1b,Tags:["wither_bane_drop"],Item:{id:"minecraft:netherite_sword",count:1,components:{"minecraft:custom_data":{wither_bane:1b},"minecraft:enchantment_glint_override":true,"minecraft:item_name":"{\\"text\\":\\"Wither-Bane Blade\\",\\"color\\":\\"aqua\\",\\"bold\\":true,\\"italic\\":false}","minecraft:lore":["{\\"text\\":\\"Forged from a Withered Core.\\",\\"color\\":\\"gray\\",\\"italic\\":true}","{\\"text\\":\\"Right-click to hurl it.\\",\\"color\\":\\"blue\\"}"]}}}'
    const { line, changed } = rewriteNbtInLine(input)
    expect(changed).toBe(true)
    expect(line).toContain('"minecraft:item_name":{"text":"Wither-Bane Blade"')
    expect(line).toContain('{"text":"Forged from a Withered Core.","color":"gray","italic":true}')
    expect(line).toContain('{"text":"Right-click to hurl it.","color":"blue"}')
    expect(line).not.toContain('\\"text\\"')
  })
})

// ===========================================================================
// Full-line compound with all transforms
// ===========================================================================
describe('Full-line transforms (T1 + T3 combined)', () => {
  it('handles minions line 10: CustomName + HandItems + ArmorItems + active_effects', () => {
    const input = `execute if score #e temp matches 1..25 run summon minecraft:wither_skeleton ~ ~ ~ {Tags:["soul_knight"],CustomName:'{"text":"Soul Knight","color":"dark_purple","bold":true}',HandItems:[{id:"minecraft:netherite_sword",count:1,components:{"minecraft:enchantments":{"minecraft:sharpness":3}}},{}],ArmorItems:[{id:"minecraft:netherite_boots"},{},{id:"minecraft:netherite_chestplate"},{}],active_effects:[{id:"minecraft:strength",amplifier:1,duration:999999,show_particles:1b}]}`
    const { line, changed } = rewriteNbtInLine(input)
    expect(changed).toBe(true)
    // Should have equipment instead of HandItems/ArmorItems
    expect(line).not.toContain('HandItems')
    expect(line).not.toContain('ArmorItems')
    expect(line).toContain('equipment:{')
    expect(line).toContain('mainhand:')
    expect(line).toContain('chest:')
    expect(line).toContain('feet:')
    // Should keep CustomName (T3 will handle separately)
    expect(line).toContain('CustomName:')
    expect(line).toContain('active_effects:')
  })
})


