#!/usr/bin/env node
import { existsSync } from 'node:fs'
import { relative, resolve } from 'node:path'
import { checkCompatibilityContentBased } from './engine.js'
import { fixDatapack } from './fixer.js'
import { clearCache } from './cache.js'
import type { VersionCompatibility, McfunctionIssue, RegistryIssue } from './types.js'

interface CliOptions {
  dir: string
  all: boolean
  json: boolean
  strict: boolean
  refresh: boolean
  fix?: string
  fromVersion?: string
  outputDir?: string
  versions?: string[]
}

function printHelp() {
  console.log(`
  dpcheck - Minecraft Datapack Version Checker (content-based)

  Determines compatibility from ACTUAL datapack content (commands, JSON) +
  community knowledge of version changes — NOT from pack.mcmeta (which is
  often wrong). Can also auto-fix/port datapacks between versions.

  USAGE:
    dpcheck                              Check current directory
    dpcheck --dir <path>                 Check a specific datapack directory
    dpcheck --versions "1.21,1.20.4"     Check specific versions
    dpcheck --all                        Check all versions including snapshots
    dpcheck --json                       Output as JSON (for scripting)
    dpcheck --refresh                    Re-download all cached version data
    dpcheck --fix <target>               Port datapack to target version
    dpcheck --fix <target> --from <ver>  Specify source version explicitly
    dpcheck --fix <target> --output <dir>  Custom output directory
    dpcheck --help                       Show this help

  WHAT IT DOES:
    1. Scans all .mcfunction files and validates every command against each
       version's real command tree (from Spyglass API)
    2. Validates all JSON files against each version's registries
    3. Cross-references community knowledge of version changes (e.g. item
       components need 1.20.5, /random needs 1.20.2)
    4. Validates JSON structure against vanilla-mcdoc (field names, dispatch
       type values, and since/until version gating) for recipe,
       loot_table, advancement, predicate and item_modifier files
    5. Shows community-curated breaking changes per version (misode/technical-changes)
    6. AUTO-FIX: port datapack to a target version by rewriting commands,
       fixing JSON structure, updating advancement icons, and updating pack.mcmeta

  EXAMPLES:
    dpcheck --dir ./my-datapack
    dpcheck --versions "1.20.4,1.21,1.21.1"
    dpcheck --all --json > report.json
    dpcheck --dir ./my-datapack --fix 1.21
    dpcheck --dir ./my-datapack --fix 1.20.4 --from-version 1.21 --output ./ported
`)
}

function parseArgs(): CliOptions {
  const args = process.argv.slice(2)
  const result: CliOptions = { dir: process.cwd(), all: false, json: false, strict: false, refresh: false }
  let dirSet = false

  if (args.includes('--help') || args.includes('-h')) {
    printHelp()
    process.exit(0)
  }

  for (let i = 0; i < args.length; i++) {
    const arg = args[i]
    if (arg === '--dir' || arg === '-d') {
      result.dir = resolve(args[++i])
      dirSet = true
    } else if (arg === '--versions' || arg === '-v') {
      const versions: string[] = []
      const first = args[++i]
      if (first !== undefined) {
        if (first.includes(',')) versions.push(...first.split(',').map(s => s.trim()))
        else versions.push(first.trim())
        while (i + 1 < args.length && !args[i + 1].startsWith('-')) {
          versions.push(args[++i].trim())
        }
      }
      result.versions = versions
    } else if (arg === '--fix') {
      result.fix = args[++i]
    } else if (arg === '--from-version' || arg === '--from') {
      result.fromVersion = args[++i]
    } else if (arg === '--output' || arg === '--output-dir' || arg === '-o') {
      result.outputDir = resolve(args[++i])
    } else if (arg === '--json') result.json = true
    else if (arg === '--all') result.all = true
    else if (arg === '--strict') result.strict = true
    else if (arg === '--refresh') result.refresh = true
    else if (!arg.startsWith('-') && !dirSet) result.dir = resolve(arg)
  }
  return result
}

function printTable(versions: VersionCompatibility[], label: string) {
  if (versions.length === 0) return
  console.log(`\n  ${label}:`)
  console.log(`  ${'─'.repeat(68)}`)
  console.log(`  ${'Version'.padEnd(22)} ${'Issues'.padEnd(40)}`)
  console.log(`  ${'─'.repeat(68)}`)
  for (const v of versions) {
    const ver = v.version
    const name = `${ver.name}`.padEnd(22)
    const funcIssues = v.mcfunction_issues.length
    const regIssues = v.registry_issues.length
    const structIssues = v.structural_issues?.length ?? 0
    const issues = funcIssues + regIssues + structIssues > 0
      ? `${funcIssues} cmd, ${regIssues} reg, ${structIssues} struct`
      : 'none'
    console.log(`  ${name} ${issues}`)
  }
}

function printDetailedIssues(versions: VersionCompatibility[]) {
  let hasIssues = false
  for (const v of versions) {
    const issues: (McfunctionIssue | RegistryIssue | { file: string; issue: string })[] = [
      ...v.mcfunction_issues,
      ...v.registry_issues,
      ...(v.structural_issues ?? []),
    ]
    if (issues.length === 0 && !(v.breaking_changes && v.breaking_changes.length)) continue
    hasIssues = true
    console.log(`\n  ▶ ${v.version.name}`)
    console.log(`  ${'─'.repeat(60)}`)
    for (const issue of issues.slice(0, 15)) {
      if ('command' in issue && issue.command) {
        console.log(`    ${issue.file}:${issue.line}`)
        console.log(`      ✗ ${issue.issue}`)
      } else if ('registry' in issue && issue.registry) {
        console.log(`    ${issue.file}`)
        console.log(`      ✗ ${issue.issue}`)
      } else {
        console.log(`    ${issue.file}`)
        console.log(`      ✗ ${issue.issue}`)
      }
    }
    if (issues.length > 15) console.log(`    ... and ${issues.length - 15} more`)
  }
  if (!hasIssues) console.log('\n  ✓ No issues found across any version.')
}

function printPortingGuide(hits: { rule: { id: string; description: string; minVersion: string; fix?: string }; file?: string; line?: number; text?: string }[]) {
  if (hits.length === 0) return
  console.log(`\n\n  WHY THIS VERSION RANGE (community knowledge):`)
  console.log(`  ${'═'.repeat(68)}`)
  const seen = new Set<string>()
  for (const hit of hits) {
    if (seen.has(hit.rule.id)) continue
    seen.add(hit.rule.id)
    console.log(`\n  • ${hit.rule.description}`)
    console.log(`    Requires: >= ${hit.rule.minVersion}`)
    if (hit.rule.fix) console.log(`    Fix: ${hit.rule.fix}`)
    const locs = hits.filter(h => h.rule.id === hit.rule.id).slice(0, 3)
    for (const loc of locs) {
      if (loc.file) console.log(`    Found: ${loc.file}${loc.line ? ':' + loc.line : ''}`)
    }
  }
}

function printBreakingChanges(versions: VersionCompatibility[]) {
  const withChanges = versions.filter(v => v.breaking_changes && v.breaking_changes.length > 0)
  if (withChanges.length === 0) return
  console.log(`\n\n  KNOWN BREAKING CHANGES BY VERSION (misode/technical-changes)`)
  console.log(`  ${'═'.repeat(68)}`)
  console.log(`  (Informational — what changes when updating TO each version)`)
  for (const v of withChanges) {
    console.log(`\n  ▶ ${v.version.name}`)
    for (const b of v.breaking_changes!.slice(0, 12)) {
      console.log(`      ⚠ ${b}`)
    }
  }
}

async function main() {
  const opts = parseArgs()
  if (opts.refresh) clearCache()
  const dir = opts.dir

  if (!existsSync(dir)) {
    console.error(`Error: Directory '${dir}' does not exist`)
    process.exit(1)
  }
  if (!existsSync(`${dir}/pack.mcmeta`)) {
    console.error(`Error: No pack.mcmeta found in '${dir}' (needed to locate datapack)`)
    process.exit(1)
  }

  // ---- FIX MODE ----
  if (opts.fix) {
    const targetVersion = opts.fix
    const outputDir = opts.outputDir ?? resolve(dir + '_fixed_' + targetVersion.replace(/[^a-zA-Z0-9._-]/g, '_'))
    console.log(`\n  🔧 Datapack Version Checker v0.4.0 — Auto-Fix Mode`)
    console.log(`  ${'═'.repeat(50)}`)
    console.log(`  📂 Source: ${dir}`)
    console.log(`  🎯 Target: ${targetVersion}`)
    console.log(`  📁 Output: ${outputDir}`)
    console.log()

    const fixResult = await fixDatapack({
      datapackDir: dir,
      outputDir,
      targetVersion,
      sourceVersion: opts.fromVersion,
    })

    if (fixResult.summary.errors.length > 0) {
      for (const err of fixResult.summary.errors) {
        console.error(`  ✗ Error: ${err}`)
      }
      if (fixResult.results.length === 0) process.exit(1)
    }

    console.log(`  ✅ Fix complete: ${fixResult.summary.filesFixed} files patched (${fixResult.summary.totalPatches} changes)`)
    for (const r of fixResult.results) {
      console.log(`     • ${r.file} (${r.patches} patches)`)
      for (const d of r.details) {
        console.log(`        ${d}`)
      }
    }
    console.log(`  ${'═'.repeat(50)}`)
    console.log(`  Data from: api.spyglassmc.com/mcje + vanilla-mcdoc + misode/technical-changes + community knowledge`)
    console.log()
    return
  }

  // ---- CHECK MODE ----
  const result = await checkCompatibilityContentBased(dir, opts.versions, opts.all, opts.strict)

  if (opts.json) {
    console.log(JSON.stringify(result, null, 2))
    return
  }

  console.log(`\n  ⚡ Datapack Version Checker v0.4.0 (content + load-range + structural + breaking changes)`)
  console.log(`  ${'═'.repeat(50)}`)
  console.log()
  if (result.load_range) {
    const lr = result.load_range
    console.log(`  📦 Declared load range (pack.mcmeta): ${lr.min_name ?? lr.min} – ${lr.max_name ?? lr.max}`)
  }
  console.log(`  📋 Minimum version from content: ${result.min_version ?? 'any (no version-specific features detected)'}`)
  console.log(`  🔍 Versions checked: ${result.versions_checked}`)
  console.log(`  ✅ Fully compatible: ${result.compatible.length}`)
  console.log(`  ❌ Breaks / outside range: ${result.incompatible.length}`)

  if (result.compatible.length > 0) {
    console.log(`\n  ✅ Compatible versions: ${result.compatible.map(v => v.version.name).join(', ')}`)
  }
  const outside = result.incompatible.filter(v => v.status === 'outside_load_range')
  const broken = result.incompatible.filter(v => v.status !== 'outside_load_range')
  if (outside.length > 0) {
    console.log(`\n  ⛔ Outside declared load range (won't load): ${outside.map(v => v.version.name).join(', ')}`)
  }
  if (broken.length > 0) {
    printTable(broken, '❌ CONTENT BREAKS ON THESE VERSIONS')
    printDetailedIssues(broken)
  }

  printPortingGuide(result.knowledge_hits)
  printBreakingChanges([...result.compatible, ...result.incompatible])

  console.log(`  ${'═'.repeat(50)}`)
  console.log(`  Data from: api.spyglassmc.com/mcje + vanilla-mcdoc + misode/technical-changes + community knowledge`)
  console.log()
}

main().catch(err => {
  console.error('Error:', err.message)
  process.exit(1)
})
