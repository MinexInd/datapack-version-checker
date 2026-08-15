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

/** Check if a symbol data entry has a non-null typeDef suitable for resolution. */
function hasValidTypeDef(data: unknown): data is { typeDef: mcdoc.McdocType } {
  return (
    !!data
    && typeof data === 'object'
    && 'typeDef' in data
    && typeof (data as any).typeDef === 'object'
    && (data as any).typeDef !== null
  )
}

/**
 * Custom dispatcher resolution that bypasses the mcdoc runtime's buggy
 * `resolveIndices` path. The runtime's `pushValue` calls
 * `simplify(data.typeDef, context)` where `data.typeDef` can be null —
 * `TypeDefSymbolData.is` passes because `typeof null === 'object'` in JS.
 *
 * This implementation mirrors the runtime's lookup logic:
 * - Query symbols for the dispatcher by registry name
 * - Iterate `parallelIndices`: static indices look up members directly
 *   (stripping `minecraft:` prefix), `%fallback` iterates all members
 * - Dynamic indices (runtime node accessors) are skipped since we don't
 *   have the parsed JSON node context here; instead we iterate all members
 *   to produce a union of all possible variants
 * - Members with null/missing typeDef contribute `unknown` degradation
 */
function resolveDispatcher(
  typeDef: Extract<mcdoc.McdocType, { kind: 'dispatcher' }>,
  ctx: mcdoc.runtime.checker.SimplifyContext<never>,
  depth: number,
  visited: Set<string>,
  budget: NodeBudget = { remaining: NODE_BUDGET },
): SpyglassType {
  const registry = typeDef.registry
  const dispatcherQuery = ctx.ctx.symbols.query(ctx.ctx.doc, 'mcdoc/dispatcher', registry)
  const members = dispatcherQuery.symbol?.members as Record<string, { data: unknown }> | undefined

  if (!members) {
    console.warn(`[type-bridge] Unknown dispatcher: ${registry}`)
    return { kind: 'union', members: [] } as SpyglassType
  }

  const resolvedMembers: SpyglassType[] = []

  for (const index of typeDef.parallelIndices) {
    if (index.kind === 'static') {
      if (index.value === '%fallback') {
        // %fallback: iterate all members in the dispatcher's symbol map
        for (const [, value] of Object.entries(members)) {
          if (hasValidTypeDef(value.data)) {
            resolvedMembers.push(resolveDynamicTypes(value.data.typeDef, ctx, depth + 1, visited, budget))
          }
        }
        break // %fallback is terminal per the runtime's resolveIndices
      }
      // Static index: strip minecraft: prefix, look up member
      const lookupKey = index.value.startsWith('minecraft:')
        ? index.value.substring(10)
        : index.value
      const member = members[lookupKey]
      if (member && hasValidTypeDef(member.data)) {
        resolvedMembers.push(resolveDynamicTypes(member.data.typeDef, ctx, depth + 1, visited, budget))
      } else {
        // Member missing or typeDef is null — contribute unknown
        resolvedMembers.push({ kind: 'any' } as SpyglassType)
      }
    } else {
      // Dynamic index: we cannot resolve runtime node accessors here (no
      // parsed JSON node context). Fall back to iterating ALL members to
      // produce a union of all possible variants — this gives the form
      // editor the full set of options to branch on.
      for (const [, value] of Object.entries(members)) {
        if (hasValidTypeDef(value.data)) {
          resolvedMembers.push(resolveDynamicTypes(value.data.typeDef, ctx, depth + 1, visited, budget))
        }
      }
      break // one round of all-variants is sufficient
    }
  }

  if (resolvedMembers.length === 0) {
    return { kind: 'union', members: [] } as SpyglassType
  }
  if (resolvedMembers.length === 1) {
    return resolvedMembers[0]
  }
  return { kind: 'union', members: resolvedMembers } as SpyglassType
}

/**
 * Stable identity key for the dynamic kinds that can participate in cycles.
 * Returns `undefined` for kinds that can't cycle (struct/union/list/etc.).
 */
function dynamicKindKey(typeDef: mcdoc.McdocType): string | undefined {
  switch (typeDef.kind) {
    case 'reference':
      return typeDef.path ? `ref:${typeDef.path}` : undefined
    case 'dispatcher':
      return typeDef.registry ? `disp:${typeDef.registry}` : undefined
    case 'indexed':
      return 'idx'
    case 'template':
      return 'tpl'
    case 'mapped':
      return 'map'
    default:
      return undefined
  }
}

/**
 * Maximum nodes we will expand when resolving + converting a mcdoc type for the
 * visual editor. Loot tables are the largest schema in the game (deeply nested
 * pools → entries → functions/conditions unions with 50+ variants each), and
 * without a hard node budget the resolve + convert produces a 10k+ node object
 * that McdocEditor then tries to render synchronously — freezing the page.
 * Past the budget we degrade the rest of the subtree to `unknown` so the tree
 * stays bounded and the form stays responsive.
 */
const NODE_BUDGET = 8000

export interface NodeBudget {
  remaining: number
}

/**
 * Resolve references, dispatchers, and other dynamic kinds inside an attached
 * typeDef. The checker's simplify is shallow: struct pair-field types keep
 * raw `reference`/`dispatcher` kinds, so the editor would otherwise see
 * opaque `unknown` inputs for fields like recipe `category`. This walker
 * resolves those via the checker's own simplify (which queries the project
 * symbol table), then recurses into the resolved shape.
 *
 * Cycle guard: mcdoc's symbol table contains mutually-recursive references
 * (e.g. `::java::data::number_provider::NumberProvider` ↔
 * `::java::data::number_provider::NumberProviderRef`, both unions with no
 * fields referencing each other but each referencing the other at the type
 * level). Without a visited-set, the reference fallback re-resolves them
 * infinitely, exhausting the depth budget before sibling resolvers (like
 * `LootPoolEntry`) ever get a chance to run. We track active reference
 * paths + dispatcher registries on the current call stack and short-circuit
 * to the raw type when we re-enter one — this preserves structural info for
 * the caller (it can still see it's a union) without recursing. The set is
 * copied per node (call-stack semantics) and threaded through
 * `resolveDispatcher`, so sibling variants resolve shared references fully
 * while structural cycles (e.g. LootPoolEntry → alternatives → children →
 * LootPoolEntry) terminate at the re-entry point.
 *
 * Node budget: `budget.remaining` is decremented on every resolved node. When
 * it hits zero we stop expanding and return `any`, bounding total work.
 */
export function resolveDynamicTypes(
  typeDef: mcdoc.McdocType,
  ctx: mcdoc.runtime.checker.SimplifyContext<never>,
  depth = 0,
  visited: Set<string> = new Set(),
  budget: NodeBudget = { remaining: NODE_BUDGET },
): SpyglassType {
  if (depth > 30) return typeDef as SpyglassType
  if (budget.remaining <= 0) return { kind: 'any' } as SpyglassType
  budget.remaining--

  // Cycle detection: if this exact reference/dispatcher is already being
  // resolved higher in the stack, return the raw type (preserving its kind
  // for structural inspection by the caller) instead of recursing.
  const cycleKey = dynamicKindKey(typeDef)
  if (cycleKey && visited.has(cycleKey)) {
    return typeDef as SpyglassType
  }
  // Copy the set so sibling branches don't poison each other: a reference
  // resolved on one path must still resolve fully on a sibling path, while
  // re-entry on the SAME path (a true cycle) is caught above.
  const nextVisited = new Set(visited)
  if (cycleKey) nextVisited.add(cycleKey)

  switch (typeDef.kind) {
    case 'struct': {
      // Raw mcdoc structs from the symbol table may contain spread fields
      // (e.g. struct loot_table_entry = { type: enum, %union<dispatcher> })
      // that reference dispatchers. The checker's simplify resolves these
      // spreads into a union of variant structs, but our manual resolution
      // path encounters them raw. When we find spread fields whose resolved
      // types are unions (from dispatchers), we return those unions directly —
      // the struct is just a wrapper around the dispatcher.
      const spreads = typeDef.fields.filter(f => f.kind === 'spread')
      if (spreads.length > 0) {
        // Collect pair fields that should be merged into each variant
        const pairFields = typeDef.fields.filter(
          (f): f is Extract<typeof f, { kind: 'pair' }> => f.kind === 'pair',
        )
        // Resolve the discriminator pair fields once, before the spread: the
        // variant subtrees (functions/conditions dispatchers) are far larger
        // and would exhaust the node budget before the merge, degrading the
        // discriminator to `any`.
        const resolvedPairFields = pairFields.map(f => ({
          ...f,
          type: resolveDynamicTypes(f.type, ctx, depth + 1, nextVisited, budget),
        }))
        // Resolve each spread field's type
        for (const spread of spreads) {
          const resolvedSpread = resolveDynamicTypes(spread.type, ctx, depth + 1, nextVisited, budget)
          if (resolvedSpread.kind === 'union') {
            // Union of variant structs from a dispatcher — merge pair fields
            // (like "type" discriminator) into each variant struct, then return
            // the enriched union so the form shows a dropdown.
            const enrichedMembers = resolvedSpread.members.map(member => {
              if (member.kind === 'struct') {
                return { ...member, fields: [...resolvedPairFields, ...member.fields] } as SpyglassType
              }
              return member
            })
            return {
              kind: 'union',
              members: enrichedMembers,
              since: versionInfo(typeDef.attributes).since,
              until: versionInfo(typeDef.attributes).until,
            } as SpyglassType
          }
          if (resolvedSpread.kind === 'struct') {
            // Spread resolved to a single struct — merge and return it
            return { ...resolvedSpread, fields: [...resolvedPairFields, ...resolvedSpread.fields] } as SpyglassType
          }
        }
        // Spreads didn't resolve to useful types — fall through to pair-only
      }
      // No spreads or unresolved spreads — process pair fields normally
      return {
        ...typeDef,
        fields: typeDef.fields
          .filter((f): f is Extract<typeof f, { kind: 'pair' }> => f.kind === 'pair')
          .map(f => ({ ...f, type: resolveDynamicTypes(f.type, ctx, depth + 1, nextVisited, budget) })),
      } as SpyglassType
    }
    case 'union':
      return {
        ...typeDef,
        members: typeDef.members.map(m => resolveDynamicTypes(m, ctx, depth + 1, nextVisited, budget)),
      } as SpyglassType
    case 'list':
      return { ...typeDef, item: resolveDynamicTypes(typeDef.item, ctx, depth + 1, nextVisited, budget) } as SpyglassType
    case 'tuple':
      return { ...typeDef, items: typeDef.items.map(i => resolveDynamicTypes(i, ctx, depth + 1, nextVisited, budget)) } as SpyglassType
    case 'dispatcher': {
      // Try the runtime's simplify first — it has caching that prevents OOM
      // on recipe types. Fall back to our custom walk only when the runtime
      // crashes (null typeDef in resolveIndices — typeof null === 'object').
      try {
        // The overload for non-union typeDefs types the result as NoUnion,
        // but the runtime can return a union (e.g. empty union for unknown
        // dispatchers) — widen the type so the degenerate-result check below
        // compiles.
        const resolved = mcdocRuntime.checker.simplify(typeDef, ctx).typeDef as SpyglassType
        // The runtime's resolveIndices returns `any` when a dynamic parallel
        // index can't be resolved (no parsed JSON node context here) or a
        // static lookup misses, and an empty union for unknown dispatchers.
        // Accepting those would degrade the caller's spread to `any` and
        // collapse loot entries to a map. Our custom resolveDispatcher
        // handles dynamic indices by iterating all members — use it instead.
        if (resolved.kind === 'any' || (resolved.kind === 'union' && resolved.members.length === 0)) {
          return resolveDispatcher(typeDef, ctx, depth, nextVisited, budget)
        }
        return resolveDynamicTypes(resolved, ctx, depth + 1, nextVisited, budget)
      } catch {
        return resolveDispatcher(typeDef, ctx, depth, nextVisited, budget)
      }
    }
    case 'reference':
    case 'indexed':
    case 'template':
    case 'mapped': {
      try {
        const resolved = mcdocRuntime.checker.simplify(typeDef, ctx).typeDef
        return resolveDynamicTypes(resolved, ctx, depth + 1, nextVisited, budget)
      } catch {
        // simplify crashed — the resolved type likely contains a dispatcher
        // whose resolveIndices path hits a null typeDef (typeof null === 'object'
        // bug in TypeDefSymbolData.is). Bypass the runtime and resolve manually:
        // 1. Query the symbol table for the reference's path (category 'mcdoc'
        //    is what simplifyReference uses internally — not 'mcdoc/type').
        // 2. If the resolved typeDef is a dispatcher, use our crash-safe
        //    resolveDispatcher which handles null typeDef members gracefully.
        // 3. Otherwise recurse into the resolved typeDef normally.
        const refDef = typeDef as Extract<mcdoc.McdocType, { kind: 'reference' }>
        if (refDef.kind === 'reference' && refDef.path) {
          try {
            const symbol = ctx.ctx.symbols.query(ctx.ctx.doc, 'mcdoc', refDef.path)
            const data = symbol.getData((d: unknown) => hasValidTypeDef(d))
            if (data?.typeDef) {
              const td = data.typeDef as any
              const fieldInfo = td.fields?.map((f: any) => `${f.kind}:${f.key?.value?.value ?? f.desc ?? '?'}:${f.type?.kind ?? '?'}`)?.join(', ') ?? 'no-fields'
              console.warn(`[type-bridge] ref fallback: path=${refDef.path} kind=${td.kind} fields=[${fieldInfo}]`)
              if (data.typeDef.kind === 'dispatcher') {
                return resolveDispatcher(data.typeDef, ctx, depth, nextVisited, budget)
              }
              return resolveDynamicTypes(data.typeDef, ctx, depth + 1, nextVisited, budget)
            }
            console.warn(`[type-bridge] ref fallback: path=${refDef.path} no typeDef in symbol data`)
          } catch (e: any) {
            console.warn(`[type-bridge] ref fallback: symbol lookup failed: ${e?.message}`)
          }
        }
        return { kind: 'any' } as SpyglassType
      }
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

export function spyglassTypeToEngine(
  type: SpyglassType,
  budget: NodeBudget = { remaining: NODE_BUDGET },
): SimplifiedMcdocType {
  if (budget.remaining <= 0) return { kind: 'primitive', name: 'unknown' }
  budget.remaining--
  if (type.kind === 'union') {
    const { since, until } = versionInfo(type.attributes)
    // An unresolvable reference/dispatcher simplifies to an empty union.
    if (type.members.length === 0) return { kind: 'primitive', name: 'unknown', since, until }
    return { kind: 'union', options: type.members.map(m => spyglassTypeToEngine(m, budget)), since, until }
  }
  return spyglassTypeNoUnionToEngine(type, budget)
}

function spyglassTypeNoUnionToEngine(
  type: SpyglassTypeNoUnion,
  budget: NodeBudget,
): SimplifiedMcdocType {
  if (budget.remaining <= 0) return { kind: 'primitive', name: 'unknown' }
  budget.remaining--
  const { since, until, registry } = versionInfo(type.attributes)
  switch (type.kind) {
    case 'struct': {
      // A struct with a single dynamic-key field is how mcdoc expresses maps
      // (e.g. the recipe "key" field) — collapse it to the engine map kind.
      const pairFields = type.fields.filter(
        (f): f is typeof f & { key: NonNullable<typeof f['key']> } => !!f.key,
      )
      // A struct with a single dynamic-key field is how mcdoc expresses maps
      // (e.g. the recipe "key" field) — collapse it to the engine map kind.
      // Plain-string keys (raw symbol-table structs like LootPoolEntry's
      // "type" discriminator) are literal, not dynamic.
      const singleKey = pairFields[0]?.key
      const singleKeyIsDynamic = typeof singleKey !== 'string' && singleKey?.kind !== 'literal'
      if (pairFields.length === 1 && singleKeyIsDynamic) {
        const f = pairFields[0]
        const fa = versionInfo(f.attributes)
        return {
          kind: 'map',
          value: spyglassTypeToEngine(f.type as SpyglassType, budget),
          since: fa.since ?? since,
          until: fa.until ?? until,
        }
      }
      const fields: SimplifiedMcdocField[] = []
      for (const f of pairFields) {
        const fa = versionInfo(f.attributes)
        if (typeof f.key === 'string') {
          // Raw symbol-table structs carry plain-string keys (e.g. the
          // LootPoolEntry "type" discriminator) — treat them as literal.
          fields.push({
            key: f.key,
            type: spyglassTypeToEngine(f.type as SpyglassType, budget),
            required: !f.optional,
            since: fa.since,
            until: fa.until,
          })
        } else if (f.key.kind === 'literal') {
          const v = f.key.value
          const key = typeof v.value === 'string' ? v.value : String(v.value)
          fields.push({
            key,
            type: spyglassTypeToEngine(f.type as SpyglassType, budget),
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
              value: spyglassTypeToEngine(f.type as SpyglassType, budget),
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
      return { kind: 'list', item: spyglassTypeToEngine(type.item as SpyglassType, budget), since, until }
    case 'tuple':
      return { kind: 'tuple', items: type.items.map(i => spyglassTypeToEngine(i as SpyglassType, budget)), since, until }
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
