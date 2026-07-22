export interface ResourceFeatureRule {
  id: string
  description: string
  match: string
  minVersion: string
  fix?: string
  note?: string
}

export const RESOURCE_FEATURE_RULES: ResourceFeatureRule[] = [
  {
    id: 'item_model_type',
    description: 'Item models use the "model" type field (added 1.21.5)',
    match: 'model.*type',
    minVersion: '1.21.5',
    fix: 'Omit the type field for pre-1.21.5 item models.',
    note: 'Item model type field added in 1.21.5',
  },
  {
    id: 'gui_font_variants',
    description: 'Font provider "space" variant with advancements field',
    match: 'font/',
    minVersion: '1.20.5',
    fix: 'Remove advancements field from space font providers for pre-1.20.5.',
    note: 'Font advancements field added 1.20.5',
  },
  {
    id: 'equipment_model_asset_id',
    description: 'Equipment model field renamed from "model" to "asset_id" (1.21.5)',
    match: 'asset_id',
    minVersion: '1.21.5',
    fix: 'Use "model" instead of "asset_id" for pre-1.21.5.',
    note: 'Renamed in 1.21.5',
  },
  {
    id: 'trim_material_item_model',
    description: 'Trim material "item_model_index" field removed (1.21.5)',
    match: 'item_model_index',
    minVersion: '1.21.5',
    fix: 'Remove item_model_index for 1.21.5+.',
    note: 'Removed in 1.21.5',
  },
  {
    id: 'model_element_rotation',
    description: 'Model elements with rotation require 1.16+ format',
    match: 'model.*rotation',
    minVersion: '1.16',
    fix: 'Omit rotation for pre-1.16 models.',
    note: 'Model element rotation added in 1.16',
  },
  {
    id: 'model_ambientocclusion',
    description: 'Model "ambientocclusion" field available since 1.10',
    match: 'ambientocclusion',
    minVersion: '1.10',
    fix: 'Omit ambientocclusion for pre-1.10 resource packs.',
    note: 'Added in 1.10',
  },
  {
    id: 'model_guilight',
    description: 'Model "gui_light" field available since 1.11',
    match: 'gui_light',
    minVersion: '1.11',
    fix: 'Omit gui_light for pre-1.11 resource packs.',
    note: 'Added in 1.11',
  },
  {
    id: 'sound_replace',
    description: 'Sound "replace" field requires 1.16.2+',
    match: 'sounds.*replace',
    minVersion: '1.16.2',
    fix: 'Remove replace field for pre-1.16.2.',
    note: 'Added in 1.16.2',
  },
  {
    id: 'atlas_source',
    description: 'Atlas "sources" field requires 1.19+',
    match: 'atlases/',
    minVersion: '1.19',
    fix: 'Atlases directory is 1.19+. Use resource-pack-only atlas for older.',
    note: 'Atlas system added in 1.19',
  },
  {
    id: 'atlas_palette',
    description: 'Atlas "palette" source type requires 1.19.4+',
    match: 'palette',
    minVersion: '1.19.4',
    fix: 'Remove palette source for pre-1.19.4.',
    note: 'Palette source added 1.19.4',
  },
  {
    id: 'particle_texture',
    description: 'Particle "textures" field requires 1.13+',
    match: 'particle.*textures',
    minVersion: '1.13',
    fix: 'Pre-1.13 particles use a different file format.',
    note: 'Particle system overhauled in 1.13',
  },
  {
    id: 'blockstate_multipart',
    description: 'Blockstate "multipart" variant requires 1.14+',
    match: 'multipart',
    minVersion: '1.14',
    fix: 'Use variants instead of multipart for pre-1.14.',
    note: 'Multipart blockstates added in 1.14',
  },
  {
    id: 'lang_unicode',
    description: 'Language files with Unicode escapes have been standard since 1.13',
    match: 'lang/',
    minVersion: '1.13',
    fix: 'Language files work across all versions >= 1.13.',
    note: 'JSON lang files introduced in 1.13',
  },
]
