import { describe, it, expect } from 'vitest'
import {
  PORT_RULES,
  FEATURE_RULES,
  RESOURCE_FEATURE_RULES,
  CMD_REWRITES,
  jsonFieldRenames,
  REGISTRY_RENAMES,
} from '../src/rules'
import type { PortRule, RewriteFix } from '../src/rules'

describe('PORT_RULES consistency', () => {
  it('has unique ids', () => {
    const ids = PORT_RULES.map(r => r.id)
    const dupes = ids.filter((id, i) => ids.indexOf(id) !== i)
    expect(dupes).toEqual([])
  })

  it('every rule has a non-empty description', () => {
    for (const r of PORT_RULES) {
      expect(r.description.length).toBeGreaterThan(0)
    }
  })

  it('match is either string or RegExp', () => {
    for (const r of PORT_RULES) {
      const t = typeof r.match
      expect(t === 'string' || r.match instanceof RegExp).toBe(true)
    }
  })

  it('RegExp matches compile without throwing', () => {
    for (const r of PORT_RULES) {
      if (r.match instanceof RegExp) {
        expect(() => new RegExp(r.match.source, r.match.flags)).not.toThrow()
      }
    }
  })

  it('version windows are sane: since <= until when both present', () => {
    for (const r of PORT_RULES) {
      if (r.since && r.until) {
        const parse = (v: string) => v.split('.').map(Number)
        const sv = parse(r.since)
        const uv = parse(r.until)
        const cmp = sv[0] !== uv[0] ? sv[0] - uv[0] : (sv[1] ?? 0) - (uv[1] ?? 0)
        expect(cmp).toBeLessThanOrEqual(0)
      }
    }
  })

  it('150 total PORT_RULES (81 knowledge + 28 resource + 38 rewrite + 3 json_field)', () => {
    expect(PORT_RULES.length).toBe(150)
  })

  it('json_field rules have jsonKind set', () => {
    const jsonRules = PORT_RULES.filter(r => r.type === 'json_field')
    expect(jsonRules.length).toBe(3)
    for (const r of jsonRules) {
      expect(r.jsonKind).toBeDefined()
    }
  })

  it('resource_path rules have scope resource_pack', () => {
    const resourceRules = PORT_RULES.filter(r => r.type === 'resource_path')
    for (const r of resourceRules) {
      expect(r.scope).toBe('resource_pack')
    }
  })
})

describe('derived views partition PORT_RULES', () => {
  it('FEATURE_RULES: 81 datapack knowledge rules', () => {
    expect(FEATURE_RULES.length).toBe(81)
    for (const r of FEATURE_RULES) {
      expect(r.minVersion).toBeDefined()
      expect(typeof r.match).toBe('string')
    }
  })

  it('RESOURCE_FEATURE_RULES: 28 resource-pack rules', () => {
    expect(RESOURCE_FEATURE_RULES.length).toBe(28)
    for (const r of RESOURCE_FEATURE_RULES) {
      expect(r.minVersion).toBeDefined()
    }
  })

  it('CMD_REWRITES: 38 command rewrite strategies', () => {
    expect(CMD_REWRITES.length).toBe(38)
    for (const r of CMD_REWRITES) {
      expect(r.pattern).toBeInstanceOf(RegExp)
      expect(typeof r.replacement).toBe('string')
    }
  })

  it('partition completeness: FEATURE + RESOURCE + CMD_REWRITES + json_field = PORT_RULES', () => {
    const knowledgeCount = PORT_RULES.filter(
      r => r.scope !== 'resource_pack' && r.fix?.kind !== 'rewrite' && r.type !== 'json_field'
    ).length
    const resourceCount = PORT_RULES.filter(r => r.scope === 'resource_pack').length
    const rewriteCount = PORT_RULES.filter(r => r.fix?.kind === 'rewrite').length
    const jsonCount = PORT_RULES.filter(r => r.type === 'json_field').length
    expect(knowledgeCount).toBe(FEATURE_RULES.length)
    expect(resourceCount).toBe(RESOURCE_FEATURE_RULES.length)
    expect(rewriteCount).toBe(CMD_REWRITES.length)
    expect(knowledgeCount + resourceCount + rewriteCount + jsonCount).toBe(PORT_RULES.length)
  })

  it('derived views preserve original ids from PORT_RULES', () => {
    const portIds = new Set(PORT_RULES.map(r => r.id))
    for (const r of FEATURE_RULES) expect(portIds.has(r.id)).toBe(true)
    for (const r of RESOURCE_FEATURE_RULES) expect(portIds.has(r.id)).toBe(true)
    for (const r of CMD_REWRITES) expect(portIds.has(r.id)).toBe(true)
  })

  it('FEATURE_RULES excludes rewrite rules', () => {
    const rewriteIds = PORT_RULES.filter(r => r.fix?.kind === 'rewrite').map(r => r.id)
    const featureIds = new Set(FEATURE_RULES.map(r => r.id))
    for (const id of rewriteIds) {
      expect(featureIds.has(id)).toBe(false)
    }
  })
})

describe('jsonFieldRenames', () => {
  it('returns [old, new, since] tuples', () => {
    const renames = jsonFieldRenames('predicate')
    expect(renames.length).toBe(2)
    for (const [old, since, ver] of renames) {
      expect(typeof old).toBe('string')
      expect(typeof since).toBe('string')
      expect(typeof ver).toBe('string')
    }
  })

  it('recipe renames return 1 entry', () => {
    expect(jsonFieldRenames('recipe').length).toBe(1)
  })

  it('returns empty for unknown kind', () => {
    // @ts-expect-error testing invalid input
    expect(jsonFieldRenames('unknown')).toEqual([])
  })
})

describe('REGISTRY_RENAMES', () => {
  it('is an array', () => {
    expect(Array.isArray(REGISTRY_RENAMES)).toBe(true)
  })
})
