#!/usr/bin/env node
import { existsSync, readFileSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { checkCompatibilityContentBased, checkResourcePack } from './engine.js'
import { fixDatapack, fixResourcePack, type FixPlan, type FixJsonFixEntry } from './fixer.js'
import { clearCache } from './cache.js'
import { setLogLevel, getLogger } from './logger.js'
import type { VersionCompatibility, McfunctionIssue, RegistryIssue, RegistryDeprecation } from './types.js'


const C = {
  r: '\x1b[31m', g: '\x1b[32m', y: '\x1b[33m', b: '\x1b[34m',
  c: '\x1b[36m', m: '\x1b[35m', d: '\x1b[2m', bd: '\x1b[1m',
  R: '\x1b[0m',
}

function ansiHighlightCmd(cmd: string): string {
  let result = ''
  let i = 0
  const tokens: string[] = []
  let buf = ''
  for (const ch of cmd) {
    if (ch === ' ' || ch === '\t') { if (buf) { tokens.push(buf); buf = '' } tokens.push(ch); continue }
    if (ch === '[' || ch === ']' || ch === '{' || ch === '}' || ch === '(' || ch === ')' || ch === '-' || ch === ':') { if (buf) { tokens.push(buf); buf = '' } tokens.push(ch); continue }
    buf += ch
  }
  if (buf) tokens.push(buf)
  for (const t of tokens) {
    if (t.startsWith('/') || t.startsWith('$')) result += `${C.c}${t}${C.R}`
    else if (/^(?:@[pares]|@s|@e\[.*\]|@p\[.*\]|@a\[.*\]|@r\[.*\]|@initiator)/.test(t)) result += `${C.y}${t}${C.R}`
    else if (/^(?:true|false|\d+)$/.test(t)) result += `${C.m}${t}${C.R}`
    else if (/^[a-z_]+:[a-z_/]+$/.test(t)) result += `${C.g}${t}${C.R}`
    else if (/^{.+}$/.test(t)) result += `${C.d}${t}${C.R}`
    else result += t
  }
  return result
}

function showFixDiff(srcDir: string, outDir: string, file: string, details: string[]) {
  const srcPath = join(srcDir, file)
  const outPath = join(outDir, file)
  if (!existsSync(srcPath) || !existsSync(outPath)) return
  const srcLines = readFileSync(srcPath, 'utf-8').split('\n')
  const outLines = readFileSync(outPath, 'utf-8').split('\n')
  const maxLen = Math.max(srcLines.length, outLines.length)

  const changedLines = new Map<number, string>()
  for (const d of details) {
    const m = d.match(/^(.+?):(\d+):/)
    if (m) changedLines.set(parseInt(m[2]), d)
  }

  const width = String(maxLen).length
  let diffOutput = ''
  for (let i = 0; i < maxLen; i++) {
    const lineNum = i + 1
    const s = srcLines[i] ?? ''
    const o = outLines[i] ?? ''
    if (s !== o) {
      const detail = changedLines.get(lineNum)
      diffOutput += `  ${C.y}${String(lineNum).padStart(width)}${C.R} ${C.r}-${C.R} ${ansiHighlightCmd(s)}\n`
      diffOutput += `  ${C.y}${String(lineNum).padStart(width)}${C.R} ${C.g}+${C.R} ${ansiHighlightCmd(o)}`
      if (detail) diffOutput += ` ${C.d}${detail.replace(/^.*?:\d+:/, '').trim()}${C.R}`
      diffOutput += '\n'
    }
  }
  if (diffOutput) {
    console.log(`  ${C.bd}${C.c}Changes in: ${file}${C.R}`)
    console.log(diffOutput)
  }
}

type Mode = 'datapack' | 'resourcepack' | 'auto'

interface CliOptions {
  dir: string
  all: boolean
  json: boolean
  strict: boolean
  refresh: boolean
  verbose: boolean
  debug: boolean
  fix?: string
  fromVersion?: string
  outputDir?: string
  mode: Mode
  versions?: string[]
  serve?: boolean
  diff?: boolean
  summary?: boolean
}

function printHelp() {
  console.log(`
  minex-datapack-checker — Minecraft Datapack Version Checker (content-based)

  Determines compatibility from ACTUAL datapack content (commands, JSON) +
  community knowledge of version changes — NOT from pack.mcmeta (which is
  often wrong). Can also auto-fix/port datapacks between versions.

  USAGE:
    minex-datapack-checker                        Check current directory
    minex-datapack-checker --dir <path>                 Check a specific datapack directory
    minex-datapack-checker --versions "1.21,1.20.4"     Check specific versions
    minex-datapack-checker --all                        Check all versions including snapshots
    minex-datapack-checker --json                       Output as JSON (for scripting)
    minex-datapack-checker --refresh                    Re-download all cached version data
    minex-datapack-checker --fix <target>               Port datapack to target version
    minex-datapack-checker --fix <target> --from <ver>  Specify source version explicitly
    minex-datapack-checker --fix <target> --output <dir>  Custom output directory
    minex-datapack-checker --version                    Show version
    minex-datapack-checker --help                       Show this help
    minex-datapack-checker --dir <path> --mode resourcepack  Check a resource pack
    minex-datapack-checker --mode auto                  Auto-detect pack type
    minex-datapack-checker --verbose                    Show detailed progress and timing
    minex-datapack-checker --diff                       Show before/after code diff for each fix
    minex-datapack-checker --summary                    Separate content issues from outside-load-range
    minex-datapack-checker --debug                      Show all debug messages (very verbose)
    minex-datapack-checker serve                        Start GUI web server on localhost:3001

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
    7. RESOURCE PACK MODE: scan assets/ for models, textures, sounds, blockstates,
       particles, fonts, shaders, atlases, and language files

  EXAMPLES:
    minex-datapack-checker --dir ./my-datapack
    minex-datapack-checker --versions "1.20.4,1.21,1.21.1"
    minex-datapack-checker --all --json > report.json
    minex-datapack-checker --dir ./my-datapack --fix 1.21
    minex-datapack-checker --dir ./my-datapack --fix 1.20.4 --from-version 1.21 --output ./ported
    minex-datapack-checker --dir ./my-resource-pack --mode resourcepack
`)
}

function parseArgs(): CliOptions {
  const args = process.argv.slice(2)
  const result: CliOptions = { dir: process.cwd(), all: false, json: false, strict: false, refresh: false, verbose: false, debug: false, mode: 'auto' }
  let dirSet = false

  if (args.includes('--help') || args.includes('-h')) {
    printHelp()
    process.exit(0)
  }

  if (args.includes('--version') || args.includes('-V')) {
    console.log('minex-datapack-checker v0.5.0')
    process.exit(0)
  }

  if (args[0] === 'serve') {
    result.serve = true
    return result
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
    } else if (arg === '--mode') {
      const val = args[++i]
      if (val === 'datapack' || val === 'resourcepack' || val === 'auto') result.mode = val
      else { console.error(`Error: Invalid mode "${val}". Use datapack, resourcepack, or auto.`); process.exit(1) }
    } else if (arg === '--json') result.json = true
    else if (arg === '--all') result.all = true
    else if (arg === '--strict') result.strict = true
    else if (arg === '--refresh') result.refresh = true
    else if (arg === '--verbose') result.verbose = true
    else if (arg === '--debug') result.debug = true
    else if (arg === '--diff') result.diff = true
    else if (arg === '--summary') result.summary = true
    else if (!arg.startsWith('-') && !dirSet) result.dir = resolve(arg)
  }
  return result
}

function printTable(versions: VersionCompatibility[], label: string) {
  if (versions.length === 0) return
  console.log(`\n  ${C.r}${C.bd}${label}${C.R}`)
  console.log(`  ${C.d}${'─'.repeat(68)}${C.R}`)
  console.log(`  ${C.d}${'Version'.padEnd(22)}${C.R} ${C.d}${'Issues'.padEnd(40)}${C.R}`)
  console.log(`  ${C.d}${'─'.repeat(68)}${C.R}`)
  for (const v of versions) {
    const ver = v.version
    const name = `${C.y}${ver.name}${C.R}`.padEnd(28)
    const funcIssues = v.mcfunction_issues.length
    const regIssues = v.registry_issues.length
    const structIssues = v.structural_issues?.length ?? 0
    const depIssues = v.deprecation_issues?.length ?? 0
    const issues = funcIssues + regIssues + structIssues + depIssues > 0
      ? `${funcIssues > 0 ? `${C.r}${funcIssues} cmd${C.R}` : `0 cmd`}, ${regIssues > 0 ? `${C.m}${regIssues} reg${C.R}` : `0 reg`}, ${structIssues > 0 ? `${C.c}${structIssues} struct${C.R}` : `0 struct`}, ${depIssues > 0 ? `${C.y}${depIssues} deprec${C.R}` : `0 deprec`}`
      : `${C.g}none${C.R}`
    console.log(`  ${name} ${issues}`)
  }
}

function printDetailedIssues(versions: VersionCompatibility[]) {
  let hasIssues = false
  for (const v of versions) {
    const issues: (McfunctionIssue | RegistryIssue | RegistryDeprecation | { file: string; issue: string; suggestion?: string; autoFixable?: boolean })[] = [
      ...v.mcfunction_issues,
      ...v.registry_issues,
      ...(v.structural_issues ?? []),
      ...(v.deprecation_issues ?? []),
    ]
    if (issues.length === 0 && !(v.breaking_changes && v.breaking_changes.length)) continue
    hasIssues = true
    console.log(`\n  ${C.bd}${C.r}▶ ${v.version.name}${C.R}`)
    console.log(`  ${C.d}${'─'.repeat(60)}${C.R}`)
    for (const issue of issues.slice(0, 15)) {
      if ('command' in issue && issue.command) {
        console.log(`    ${C.d}${issue.file}:${issue.line}${C.R}`)
        console.log(`      ${C.r}✗${C.R} ${issue.issue}`)
      } else if ('registry' in issue && issue.registry) {
        const icon = issue.issue.includes('REMOVED') ? `${C.y}⚠${C.R}` : `${C.r}✗${C.R}`
        console.log(`    ${C.d}${issue.file}${C.R}`)
        console.log(`      ${icon} ${issue.issue}`)
      } else {
        console.log(`    ${C.d}${issue.file}${C.R}`)
        console.log(`      ${C.r}✗${C.R} ${issue.issue}`)
      }
      if ('suggestion' in issue && issue.suggestion) {
        console.log(`      ${C.d}→${C.R} ${issue.suggestion}${issue.autoFixable ? ` ${C.g}[auto-fixable]${C.R}` : ''}`)
      }
    }
    if (issues.length > 15) console.log(`    ${C.d}... and ${issues.length - 15} more${C.R}`)
  }
  if (!hasIssues) console.log(`\n  ${C.g}✓${C.R} No issues found across any version.`)
}

function printPortingGuide(hits: { rule: { id: string; description: string; minVersion: string; fix?: string }; file?: string; line?: number; text?: string }[]) {
  if (hits.length === 0) return
  console.log(`\n  ${C.bd}${C.c}WHY THIS VERSION RANGE (community knowledge)${C.R}`)
  console.log(`  ${C.d}${'═'.repeat(68)}${C.R}`)
  const seen = new Set<string>()
  for (const hit of hits) {
    if (seen.has(hit.rule.id)) continue
    seen.add(hit.rule.id)
    console.log(`\n  ${C.bd}•${C.R} ${hit.rule.description}`)
    console.log(`    ${C.d}Requires:${C.R} ${C.y}>= ${hit.rule.minVersion}${C.R}`)
    if (hit.rule.fix) console.log(`    ${C.g}Fix:${C.R} ${hit.rule.fix}`)
    const locs = hits.filter(h => h.rule.id === hit.rule.id).slice(0, 3)
    for (const loc of locs) {
      if (loc.file) console.log(`    ${C.d}Found:${C.R} ${C.d}${loc.file}${loc.line ? ':' + loc.line : ''}${C.R}`)
    }
  }
}

function printBreakingChanges(versions: VersionCompatibility[]) {
  const withChanges = versions.filter(v => v.breaking_changes && v.breaking_changes.length > 0)
  if (withChanges.length === 0) return
  console.log(`\n  ${C.bd}${C.m}KNOWN BREAKING CHANGES BY VERSION (misode/technical-changes)${C.R}`)
  console.log(`  ${C.d}${'═'.repeat(68)}${C.R}`)
  console.log(`  ${C.d}(Informational — what changes when updating TO each version)${C.R}`)
  for (const v of withChanges) {
    console.log(`\n  ${C.bd}▶ ${v.version.name}${C.R}`)
    for (const b of v.breaking_changes!.slice(0, 12)) {
      console.log(`      ${C.y}⚠${C.R} ${b}`)
    }
  }
}

function printFixSuggestions(
  broken: VersionCompatibility[],
  compatible: VersionCompatibility[],
  isRp: boolean,
  dir: string,
) {
  if (broken.length === 0) return

  // Analyze issue types across all broken versions
  let cmdIssues = 0
  let regIssues = 0
  let structIssues = 0
  let deprecIssues = 0

  for (const v of broken) {
    cmdIssues += v.mcfunction_issues.length
    regIssues += v.registry_issues.length
    structIssues += v.structural_issues?.length ?? 0
    deprecIssues += v.deprecation_issues?.length ?? 0
  }

  const totalIssues = cmdIssues + regIssues + structIssues + deprecIssues
  if (totalIssues === 0) return

  // Determine what can be auto-fixed
  const autoFixable = cmdIssues + structIssues
  const manualNeeded = regIssues + deprecIssues

  // Find best target version (first compatible version that's newer, or latest release)
  let targetVersion = ''
  if (compatible.length > 0) {
    // Prefer the first compatible version
    targetVersion = compatible[0].version.name
  }

  console.log(`\n  ${C.bd}${C.g}💡 AUTO-FIX SUGGESTIONS${C.R}`)
  console.log(`  ${C.d}${'─'.repeat(50)}${C.R}`)
  console.log()

  // Summary of what can be fixed
  if (autoFixable > 0) {
    console.log(`  ${C.g}✓${C.R} ${C.bd}${autoFixable} issues can be auto-fixed${C.R}`)
    if (cmdIssues > 0) {
      console.log(`    ${C.d}•${C.R} ${cmdIssues} command rewrites (${isRp ? 'mcmeta' : 'mcfunction'} files)`)
    }
    if (structIssues > 0) {
      console.log(`    ${C.d}•${C.R} ${structIssues} structural fixes (JSON/mcdoc)`)
    }
  }

  if (manualNeeded > 0) {
    console.log(`  ${C.y}⚠${C.R} ${C.bd}${manualNeeded} issues need manual attention${C.R}`)
    if (regIssues > 0) {
      console.log(`    ${C.d}•${C.R} ${regIssues} registry issues (removed/renamed entries)`)
    }
    if (deprecIssues > 0) {
      console.log(`    ${C.d}•${C.R} ${deprecIssues} deprecation warnings`)
    }
  }

  // Show the suggested command
  if (autoFixable > 0 && targetVersion) {
    console.log()
    console.log(`  ${C.bd}${C.c}To auto-fix, run:${C.R}`)
    const cmd = isRp
      ? `minex-datapack-checker --dir ${dir} --fix ${targetVersion} --mode resourcepack`
      : `minex-datapack-checker --dir ${dir} --fix ${targetVersion}`
    console.log(`    ${C.g}$ ${cmd}${C.R}`)

    // Show what versions would be fixed
    const fixableVersions = broken.filter(v => {
      const hasIssues = v.mcfunction_issues.length > 0 || (v.structural_issues?.length ?? 0) > 0
      return hasIssues
    })

    if (fixableVersions.length > 0) {
      console.log()
      console.log(`  ${C.d}This would fix issues on:${C.R} ${fixableVersions.map(v => `${C.y}${v.version.name}${C.R}`).join(', ')}`)
    }

    // Show which issues need manual work
    if (manualNeeded > 0) {
      console.log()
      console.log(`  ${C.d}Manual attention needed for:${C.R}`)
      for (const v of broken) {
        const manual = v.registry_issues.length + (v.deprecation_issues?.length ?? 0)
        if (manual > 0) {
          console.log(`    ${C.d}•${C.R} ${C.y}${v.version.name}${C.R}: ${manual} issues`)
        }
      }
    }
  } else if (manualNeeded > 0 && autoFixable === 0) {
    console.log()
    console.log(`  ${C.d}All issues require manual fixes. Review the details above.${C.R}`)
  }
}

function detectMode(dir: string): Mode {
  const hasData = existsSync(join(dir, 'data'))
  const hasAssets = existsSync(join(dir, 'assets'))
  if (hasData && !hasAssets) return 'datapack'
  if (hasAssets && !hasData) return 'resourcepack'
  return 'datapack' // default to datapack when both or neither
}

async function main() {
  const opts = parseArgs()

  if (opts.debug) setLogLevel('debug')
  else if (opts.verbose) setLogLevel('info')
  else setLogLevel('warn')

  const logger = getLogger()
  logger.time('total')

  if (opts.serve) {
    const { startServer } = await import('./server.js')
    startServer()
    return
  }
  if (opts.refresh) clearCache()
  const dir = opts.dir

  if (!existsSync(dir)) {
    console.error(`Error: Directory '${dir}' does not exist`)
    process.exit(1)
  }
  if (!existsSync(`${dir}/pack.mcmeta`)) {
    console.error(`Error: No pack.mcmeta found in '${dir}'`)
    process.exit(1)
  }

  // Resolve mode
  const mode = opts.mode === 'auto' ? detectMode(dir) : (opts.mode || detectMode(dir))
  const isRp = mode === 'resourcepack'

  // ---- FIX MODE ----
  if (opts.fix) {
    const targetVersion = opts.fix
    const outputDir = opts.outputDir ?? resolve(dir + '_fixed_' + targetVersion.replace(/[^a-zA-Z0-9._-]/g, '_'))
    const packType = isRp ? 'Resource Pack' : 'Datapack'
    console.log(`\n  ${C.bd}${C.c}🔧 ${packType} Version Checker — Auto-Fix Mode${C.R}`)
    console.log(`  ${C.d}${'═'.repeat(60)}${C.R}`)
    console.log(`  ${C.d}Source:${C.R} ${dir}`)
    console.log(`  ${C.d}Target:${C.R} ${C.bd}${targetVersion}${C.R}`)
    console.log(`  ${C.d}Output:${C.R} ${outputDir}`)
    console.log()

    let lastProgress = ''
    const onProgress = (msg: string, current?: number, total?: number) => {
      const line = total ? `  [${current}/${total}] ${msg}` : `  ${msg}`
      if (line !== lastProgress) {
        lastProgress = line
        process.stderr.write(`\r${' '.repeat(80)}\r${line}`)
      }
    }

    const fixResult = isRp
      ? await fixResourcePack({ packDir: dir, outputDir, targetVersion, sourceVersion: opts.fromVersion, onProgress })
      : await fixDatapack({ datapackDir: dir, outputDir, targetVersion, sourceVersion: opts.fromVersion, onProgress })
    process.stderr.write('\r' + ' '.repeat(80) + '\r')

    if (fixResult.summary.errors.length > 0) {
      for (const err of fixResult.summary.errors) {
        console.error(`  ${C.r}${C.bd}Error:${C.R} ${err}`)
      }
      if (fixResult.results.length === 0) process.exit(1)
    }

    const plan = fixResult.plan

    // Show porting plan
    if (plan && plan.sourceVersion) {
      console.log(`  ${C.bd}═══ Porting Plan ═══${C.R}`)
      console.log(`  ${C.c}${plan.sourceVersion}${C.R} → ${C.g}${plan.targetVersion}${C.R}  (${plan.direction} port)`)
      console.log()

      if (plan.rewrites.length > 0) {
        console.log(`  ${C.bd}${C.y}Command rewrites:${C.R} ${plan.summary.commandRewrites}`)
        for (const rw of plan.rewrites) {
          console.log(`    ${ansiHighlightCmd(rw.description.padEnd(50))} ${C.c}${rw.count}×${C.R}  (${C.d}${rw.files.length} files${C.R})`)
        }
      }
      if (plan.manualAttention.length > 0) {
        console.log()
        console.log(`  ${C.bd}${C.r}Manual attention:${C.R} ${plan.summary.manualAttention}`)
        for (const m of plan.manualAttention) {
          console.log(`    ${C.y}${m.description}${C.R}`)
          console.log(`      ${C.d}Reason:${C.R} ${m.reason}`)
          console.log(`      ${C.d}Files:${C.R} ${m.files.join(', ')}`)
        }
      }
      if (plan.jsonFixes.some((j: FixJsonFixEntry) => j.files.length > 0)) {
        console.log()
        console.log(`  ${C.bd}JSON fixes:${C.R}`)
        for (const jf of plan.jsonFixes) {
          if (jf.files.length > 0) {
            console.log(`    ${jf.type}: ${C.c}${jf.files.length} file(s)${C.R}`)
          }
        }
      }
      if (plan.cascadeEffects.length > 0) {
        console.log()
        console.log(`  ${C.bd}Cascade effects:${C.R} ${plan.cascadeEffects.length}`)
        for (const ce of plan.cascadeEffects) {
          console.log(`    ${ce.description}`)
          for (const af of ce.affectedFiles) {
            console.log(`      ${C.d}->${C.R} ${af}`)
          }
        }
      }
      if (plan.skippedFiles && plan.skippedFiles.length > 0) {
        console.log()
        console.log(`  ${C.bd}${C.y}Skipped files (registry not in target):${C.R} ${plan.skippedFiles.length}`)
        for (const sf of plan.skippedFiles) {
          console.log(`    ${C.d}${sf.file}${C.R} — ${sf.registry} (${sf.reason})`)
        }
      }
      console.log()
      console.log(`  ${C.d}${'─'.repeat(40)}${C.R}`)
      console.log(`  ${C.d}Files to patch:${C.R} ${C.bd}${plan.summary.totalFilesToPatch}${C.R}`)
      console.log(`  ${C.d}Command rewrites:${C.R} ${plan.summary.commandRewrites}`)
      console.log(`  ${C.d}JSON fixes:${C.R} ${plan.summary.jsonFixes}`)
      console.log(`  ${C.d}Manual attention:${C.R} ${plan.summary.manualAttention}`)
      if (plan.summary.skippedFiles > 0) {
        console.log(`  ${C.d}Skipped (no registry):${C.R} ${C.y}${plan.summary.skippedFiles}${C.R}`)
      }
      if (plan.cascadeEffects.length > 0) {
        console.log(`  ${C.d}Cascade effects:${C.R} ${plan.cascadeEffects.length}`)
      }
      console.log(`  ${C.bd}${'═'.repeat(40)}${C.R}`)
      console.log()
    }

    // Group results by type
    const cmdResults = fixResult.results.filter(r => r.file.endsWith('.mcfunction'))
    const jsonResults = fixResult.results.filter(r => r.file.endsWith('.json'))
    const mcmetaResult = fixResult.results.filter(r => r.file === 'pack.mcmeta')

    if (cmdResults.length > 0) {
      const cmdTotalPatches = cmdResults.reduce((s, r) => s + r.patches, 0)
      console.log(`  ${C.bd}${C.c}┌─ Command rewrites (${cmdResults.length} files, ${cmdTotalPatches} patches)${C.R}`)
      for (const r of cmdResults) {
        console.log(`  ${C.d}│${C.R}`)
        console.log(`  ${C.bd}├ ${r.file}${C.R}`)
        for (const d of r.details) {
          const icon = d.includes('->') ? `${C.g}→${C.R}` : `${C.r}!${C.R}`
          const parts = d.split(': ')
          if (parts.length >= 2) {
            const prefix = parts[0]
            const suffix = parts.slice(1).join(': ')
            const coloredSuffix = d.includes('->')
              ? suffix.replace(/(\/\S+)/g, (m) => `${C.c}${m}${C.R}`)
              : suffix
            console.log(`  ${C.d}│${C.R}  ${icon} ${C.d}${prefix}${C.R}: ${coloredSuffix}`)
          } else {
            console.log(`  ${C.d}│${C.R}  ${icon} ${d}`)
          }
        }
        if (opts.diff) {
          showFixDiff(dir, outputDir, r.file, r.details)
        }
      }
      console.log(`  ${C.d}└${'─'.repeat(55)}${C.R}`)
      console.log()
    }

    if (jsonResults.length > 0) {
      const jsonTotalPatches = jsonResults.reduce((s, r) => s + r.patches, 0)
      console.log(`  ${C.bd}${C.m}┌─ JSON fixes (${jsonResults.length} files, ${jsonTotalPatches} patches)${C.R}`)
      for (const r of jsonResults) {
        console.log(`  ${C.d}│${C.R}`)
        console.log(`  ${C.bd}├ ${r.file}${C.R}`)
        for (const d of r.details) {
          const icon = d.includes('->') ? `${C.g}→${C.R}` : `${C.r}!${C.R}`
          console.log(`  ${C.d}│${C.R}  ${icon} ${d}`)
        }
        if (opts.diff) {
          showFixDiff(dir, outputDir, r.file, r.details)
        }
      }
      console.log(`  ${C.d}└${'─'.repeat(55)}${C.R}`)
      console.log()
    }

    if (mcmetaResult.length > 0) {
      console.log(`  ${C.bd}${C.c}┌─ pack.mcmeta${C.R}`)
      for (const r of mcmetaResult) {
        console.log(`  ${C.d}│${C.R}`)
        console.log(`  ${C.bd}├ ${r.file}${C.R}`)
        for (const d of r.details) {
          console.log(`  ${C.d}│${C.R}  ${C.g}→${C.R} ${d}`)
        }
      }
      console.log(`  ${C.d}└${'─'.repeat(55)}${C.R}`)
      console.log()
    }

    console.log(`  ${C.bd}${'═'.repeat(60)}${C.R}`)
    console.log(`  ${C.g}✓${C.R} ${C.bd}${fixResult.summary.filesFixed} files fixed${C.R}, ${C.c}${fixResult.summary.totalPatches} patches${C.R} applied → ${C.bd}${outputDir}${C.R}`)
    if (fixResult.summary.errors.length > 0) {
      console.log(`  ${C.r}${C.bd}${fixResult.summary.errors.length} error(s)${C.R} — some fixes may be incomplete`)
    }
    console.log()
    return
  }

  // ---- CHECK MODE ----
  const isRpMode = mode === 'resourcepack'
  const banner = isRpMode
    ? `\n  ${C.bd}${C.c}⚡ Resource Pack Checker v0.5.0${C.R} (content + load-range + structural + breaking changes)`
    : `\n  ${C.bd}${C.c}⚡ Datapack Version Checker v0.5.0${C.R} (content + load-range + structural + breaking changes)`

  const result = isRpMode
    ? await checkResourcePack(dir, opts.versions, opts.all)
    : await checkCompatibilityContentBased(dir, opts.versions, opts.all, opts.strict)

  if (opts.json) {
    console.log(JSON.stringify(result, null, 2))
    return
  }

  console.log(banner)
  console.log(`  ${C.d}${'═'.repeat(50)}${C.R}`)
  console.log()
  if ('load_range' in result && result.load_range) {
    const lr = (result as any).load_range
    console.log(`  ${C.d}📦 Declared load range (pack.mcmeta):${C.R} ${C.y}${lr.min_name ?? lr.min} – ${lr.max_name ?? lr.max}${C.R}`)
  }
  if ('min_version' in result && result.min_version !== undefined) {
    const mv = (result as any).min_version ?? 'any (no version-specific features detected)'
    console.log(`  ${C.d}📋 Minimum version from content:${C.R} ${C.bd}${mv}${C.R}`)
  }
  console.log(`  ${C.d}🔍 Versions checked:${C.R} ${C.bd}${result.versions_checked}${C.R}`)
  const compatCount = result.compatible.length
  const outsideRangeCount = result.incompatible.filter(v => v.status === 'outside_load_range').length
  const incompatCount = opts.summary
    ? result.incompatible.length - outsideRangeCount
    : result.incompatible.length
  console.log(`  ${compatCount > 0 ? C.g + '✅' : C.d + '  '} Fully compatible:${C.R} ${compatCount}`)
  console.log(`  ${incompatCount > 0 ? C.r + '❌' : C.d + '  '} Breaks / incompatible:${C.R} ${incompatCount}`)
  if (opts.summary && outsideRangeCount > 0) {
    console.log(`  ${C.d + '  '} Outside declared load range:${C.R} ${outsideRangeCount}`)
  }

  if (result.compatible.length > 0) {
    console.log(`\n  ${C.g}✅${C.R} Compatible versions: ${result.compatible.map(v => `${C.g}${v.version.name}${C.R}`).join(', ')}`)
  }
  const broken = result.incompatible.filter(v => v.status !== 'outside_load_range')
  if (broken.length > 0) {
    printTable(broken, '❌ CONTENT BREAKS ON THESE VERSIONS')
    printDetailedIssues(broken)
  }

  if ('knowledge_hits' in result) {
    printPortingGuide((result as any).knowledge_hits)
  }
  printBreakingChanges([...result.compatible, ...result.incompatible])

  // Show auto-fix suggestions if there are fixable issues
  if (broken.length > 0) {
    printFixSuggestions(broken, result.compatible, isRpMode, dir)
  }

  logger.timeEnd('total', `(${result.versions_checked} versions)`)

  console.log(`  ${C.d}${'═'.repeat(50)}${C.R}`)
  console.log(`  ${C.d}Data from:${C.R} api.spyglassmc.com/mcje + vanilla-mcdoc + misode/technical-changes + community knowledge`)
  console.log()
}

main().catch(err => {
  console.error('Error:', err.message)
  process.exit(1)
})
