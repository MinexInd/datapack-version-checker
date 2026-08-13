/**
 * type-bridge — Convert Spyglass's simplified mcdoc types (attached to parsed
 * JSON nodes by the runtime checker) into the engine's SimplifiedMcdocType
 * model used by the visual editor.
 *
 * The checker attaches the FULL schema to each JsonNode's `typeDef` field,
 * but its simplify is shallow: struct pair-field types keep raw
 * `reference`/`dispatcher` kinds, so `resolveDynamicTypes` (below) resolves
 * them first. This module then translates shapes — it does not re-filter
 * anything; since/until version gating is handled by the editor at render
 * time via the attributes carried on each type.
 */

import { runtime as mcdocRuntime } from '@spyglassmc/mcdoc'
import type * as mcdoc from '@spyglassmc/mcdoc'
import type { SimplifiedMcdocField, SimplifiedMcdocType } from '../ide/mcdoc-edit'

type SpyglassType = mcdoc.runtime.checker.SimplifiedMcdocType
type SpyglassTypeNoUnion = mcdoc.runtime.checker.SimplifiedMcdocTypeNoUnion

/**
 * Resolve references, dispatchers, and other dynamic kinds inside an attached
 * typeDef. The checker's simplify is shallow: struct pair-field types keep
 * their raw `reference`/`dispatcher` kinds, so the editor would otherwise see
 * opaque `unknown` inputs for fields like recipe `category`. This walker
 * resolves those via the checker's own simplify (which queries the project
 * symbol table), then recurses into the resolved shape.
 */
export function resolveDynamicTypes(
  typeDef: mcdoc.McdocType,
  ctx: mcdoc.runtime.checker.SimplifyContext<never>,
  depth = 0,
): SpyglassType {
  if (depth > 30) return typeDef as SpyglassType
  switch (typeDef.kind) {
    case 'struct':
      return {
        ...typeDef,
        fields: typeDef.fields.map(f => ({ ...f, type: resolveDynamicTypes(f.type, ctx, depth + 1) })),
      } as SpyglassType
    case 'union':
      return {
        ...typeDef,
        members: typeDef.members.map(m => resolveDynamicTypes(m, ctx, depth + 1)),
      } as SpyglassType
    case 'list':
      return { ...typeDef, item: resolveDynamicTypes(typeDef.item, ctx, depth + 1) } as SpyglassType
    case 'tuple':
      return { ...typeDef, items: typeDef.items.map(i => resolveDynamicTypes(i, ctx, depth + 1)) } as SpyglassType
    case 'reference':
    case 'dispatcher':
    case 'indexed':
    case 'template':
    case 'mapped': {
      const resolved = mcdocRuntime.checker.simplify(typeDef, ctx).typeDef
      return resolveDynamicTypes(resolved, ctx, depth + 1)
    }
    default:
      return typeDef as SpyglassType
  }
}

interface VersionInfo {
  since?: string
  until?: string
  registry?: string
}

/** Pull since/until version gates and the #[id] registry hint off a type or
 *  field's attributes. */
function versionInfo(attrs: mcdoc.Attributes | undefined): VersionInfo {
  const out: VersionInfo = {}
  for (const a of attrs ?? []) {
    if (a.name === 'since') out.since = attrString(a.value)
    else if (a.name === 'until') out.until = attrString(a.value)
    else if (a.name === 'id') out.registry = attrRegistry(a.value)
  }
  return out
}

function attrString(value: mcdoc.AttributeValue | undefined): string | undefined {
  if (!value || typeof value !== 'object' || !('kind' in value)) return undefined
  if (value.kind !== 'literal') return undefined
  const v = value.value
  return typeof v.value === 'string' ? v.value : String(v.value)
}

/** The #[id] attribute names a registry ("minecraft:item"). Strip the
 *  namespace so it matches fetchRegistries' short keys ("item"). */
function attrRegistry(value: mcdoc.AttributeValue | undefined): string | undefined {
  if (!value || typeof value !== 'object' || !('kind' in value)) return undefined
  if (value.kind === 'literal') {
    return String(value.value.value).replace(/^minecraft:/, '')
  }
  if (value.kind === 'tree') {
    const reg = value.values['registry']
    if (reg && typeof reg === 'object' && 'kind' in reg && reg.kind === 'literal') {
      return String(reg.value.value).replace(/^minecraft:/, '')
    }
  }
  return undefined
}

export function spyglassTypeToEngine(type: SpyglassType): SimplifiedMcdocType {
  if (type.kind === 'union') {
    const { since, until } = versionInfo(type.attributes)
    // An unresolvable reference/dispatcher simplifies to an empty union.
    if (type.members.length === 0) return { kind: 'primitive', name: 'unknown', since, until }
    return { kind: 'union', options: type.members.map(spyglassTypeToEngine), since, until }
  }
  return spyglassTypeNoUnionToEngine(type)
}

function spyglassTypeNoUnionToEngine(type: SpyglassTypeNoUnion): SimplifiedMcdocType {
  const { since, until, registry } = versionInfo(type.attributes)
  switch (type.kind) {
    case 'struct': {
      // A struct with a single dynamic-key field is how mcdoc expresses maps
      // (e.g. the recipe "key" field) — collapse it to the engine map kind.
      if (type.fields.length === 1 && type.fields[0].key.kind !== 'literal') {
        const f = type.fields[0]
        const fa = versionInfo(f.attributes)
        return {
          kind: 'map',
          value: spyglassTypeToEngine(f.type as SpyglassType),
          since: fa.since ?? since,
          until: fa.until ?? until,
        }
      }
      const fields: SimplifiedMcdocField[] = []
      for (const f of type.fields) {
        const fa = versionInfo(f.attributes)
        if (f.key.kind === 'literal') {
          const v = f.key.value
          const key = typeof v.value === 'string' ? v.value : String(v.value)
          fields.push({
            key,
            type: spyglassTypeToEngine(f.type as SpyglassType),
            required: !f.optional,
            since: fa.since,
            until: fa.until,
          })
        } else {
          // Dynamic key (e.g. the recipe "key" map): the field accepts
          // arbitrary keys, so it becomes a map with the same value type.
          fields.push({
            key: f.desc ?? 'key',
            type: {
              kind: 'map',
              value: spyglassTypeToEngine(f.type as SpyglassType),
              since: fa.since,
              until: fa.until,
            },
            required: !f.optional,
            since: fa.since,
            until: fa.until,
          })
        }
      }
      return { kind: 'struct', fields, since, until }
    }
    case 'enum':
      return { kind: 'enum', values: type.values.map(v => String(v.value)), since, until }
    case 'literal': {
      const v = type.value
      const value =
        v.kind === 'boolean' ? v.value
        : v.kind === 'string' ? v.value
        : v.kind === 'long' ? Number(v.value)
        : v.value
      return { kind: 'literal', value, since, until }
    }
    case 'list':
      return { kind: 'list', item: spyglassTypeToEngine(type.item as SpyglassType), since, until }
    case 'tuple':
      return { kind: 'tuple', items: type.items.map(i => spyglassTypeToEngine(i as SpyglassType)), since, until }
    case 'string':
      return { kind: 'primitive', name: 'string', since, until, registry }
    case 'byte':
    case 'short':
    case 'int':
    case 'float':
    case 'double':
      return { kind: 'primitive', name: type.kind, since, until }
    case 'long':
      return { kind: 'primitive', name: 'long', since, until }
    case 'boolean':
      return { kind: 'primitive', name: 'boolean', since, until }
    case 'any':
    case 'unsafe':
      return { kind: 'primitive', name: 'any', since, until }
    case 'byte_array':
    case 'int_array':
    case 'long_array':
      return { kind: 'primitive', name: type.kind, since, until }
    default:
      return { kind: 'primitive', name: 'unknown' }
  }
}
