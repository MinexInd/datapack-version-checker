import { PORT_RULES, REGISTRY_RENAMES, type PortRule, type RegistryRename } from './rules'
import type { McfunctionIssue, RegistryIssue, StructuralIssue, RegistryDeprecation } from './types'

export interface Suggestion { suggestion?: string; autoFixable?: boolean }

/**
 * Build a Suggestion from a matched rule.
 * suggestion = rule.guidance; if guidance is missing but the rule has a fix,
 * fall back to `Can be auto-fixed: ${rule.description}` so auto-fixable
 * issues ALWAYS carry a suggestion text.
 */
function suggestionFromRule(rule: PortRule): Suggestion {
  if (rule.guidance) return { suggestion: rule.guidance, autoFixable: !!rule.fix }
  if (rule.fix) return { suggestion: `Can be auto-fixed: ${rule.description}`, autoFixable: true }
  return {}
}

/**
 * Suggest a porting hint for a command. Strips a leading '/', takes the first
 * token, and looks up PORT_RULES rules of type 'command' whose match equals
 * the root. Prefers a rule that has a fix (that's the auto-fixable one);
 * otherwise the first match wins.
 */
export function suggestForCommand(command: string): Suggestion {
  const root = command.trim().replace(/^\//, '').split(/\s+/)[0] ?? ''
  if (!root) return {}
  let firstMatch: PortRule | undefined
  for (const rule of PORT_RULES) {
    if (rule.type !== 'command' || String(rule.match) !== root) continue
    if (rule.fix) return suggestionFromRule(rule)
    if (!firstMatch) firstMatch = rule
  }
  return firstMatch ? suggestionFromRule(firstMatch) : {}
}

/** Suggest a porting hint for a registry reference (type==='registry' rules). */
export function suggestForRegistry(registry: string, entry: string): Suggestion {
  const stripNs = (s: string) => s.replace(/^minecraft:/, '')
  const reg = stripNs(registry)
  const ent = stripNs(entry)
  for (const rule of PORT_RULES) {
    if (rule.type !== 'registry') continue
    const match = String(rule.match)
    if (match === ent || match === reg) return suggestionFromRule(rule)
  }
  return {}
}

/**
 * Rename lookup for registry deprecations. Exported so the lookup is testable
 * with an injected table (defaults to the curated REGISTRY_RENAMES).
 */
export function matchRegistryRename(entry: string, table: RegistryRename[] = REGISTRY_RENAMES): RegistryRename | undefined {
  const stripNs = (s: string) => s.replace(/^minecraft:/, '')
  const ent = stripNs(entry)
  return table.find(r => stripNs(r.from) === ent)
}

/**
 * Suggest a porting hint for a registry entry that was removed between the
 * source and target versions. The optional table parameter only exists to
 * make the rename path testable; production callers use REGISTRY_RENAMES.
 */
export function suggestForDeprecation(
  registry: string,
  entry: string,
  table: RegistryRename[] = REGISTRY_RENAMES,
): Suggestion {
  const rename = matchRegistryRename(entry, table)
  if (rename) {
    return { suggestion: `Renamed to '${rename.to}' in ${rename.since}`, autoFixable: true }
  }
  return {
    suggestion: 'Removed in this version — no automatic fix; check for a replacement entry',
    autoFixable: false,
  }
}

/**
 * Suggest a porting hint for a structural (JSON format) issue text.
 * Matches PORT_RULES rules of type 'json_field' whose match appears in the
 * issue text (case-insensitive).
 */
export function suggestForStructural(issueText: string): Suggestion {
  for (const rule of PORT_RULES) {
    if (rule.type !== 'json_field') continue
    if (issueText.toLowerCase().includes(String(rule.match).toLowerCase())) {
      const autoFixable = rule.fix?.kind === 'rename_field'
      const suggestion = rule.guidance ?? (autoFixable ? `Can be auto-fixed: ${rule.description}` : undefined)
      return { suggestion, autoFixable }
    }
  }
  return {}
}
