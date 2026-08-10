#!/usr/bin/env node
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod/v4'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { checkCompatibilityContentBased, checkResourcePack } from './engine.js'
import { fixDatapack, fixResourcePack } from './fixer.js'
import { fetchVersions } from './api.js'
import { analyzePack } from './analyzer.js'
import { setLogLevel } from './logger.js'

setLogLevel('warn')

const server = new McpServer({
  name: 'dpcheck',
  version: '0.5.0',
})

// ---------------------------------------------------------------------------
// Tool: dpcheck_versions
// ---------------------------------------------------------------------------
server.tool(
  'dpcheck_versions',
  'List all available Minecraft Java Edition versions with pack format numbers. Use to find valid version strings for other dpcheck tools.',
  {},
  async () => {
    try {
      const versions = await fetchVersions()
      const list = versions.map(v => ({
        id: v.id,
        name: v.name,
        type: v.type,
        stable: v.stable,
        data_pack_version: v.data_pack_version,
        resource_pack_version: v.resource_pack_version,
        data_version: v.data_version,
      }))
      return {
        content: [{ type: 'text' as const, text: JSON.stringify({ total: list.length, versions: list }, null, 2) }],
      }
    } catch (err: any) {
      return { content: [{ type: 'text' as const, text: `Error fetching versions: ${err.message}` }], isError: true }
    }
  },
)

// ---------------------------------------------------------------------------
// Tool: dpcheck_check
// ---------------------------------------------------------------------------
server.tool(
  'dpcheck_check',
  'Validate a Minecraft datapack or resource pack across versions. Checks commands against real Brigadier trees, validates JSON registries, structural validation via mcdoc, and reports breaking changes. Returns compatible/incompatible versions with detailed issues.',
  {
    path: z.string().describe('Path to the datapack or resource pack directory (must contain pack.mcmeta)'),
    versions: z.array(z.string()).optional().describe('Specific versions to check (e.g. ["1.20.4","1.21"]). Omit to auto-detect relevant versions from pack.mcmeta.'),
    all: z.boolean().optional().describe('Check all versions including snapshots (default: false)'),
    strict: z.boolean().optional().describe('Stricter command checking (default: false)'),
    mode: z.enum(['auto', 'datapack', 'resourcepack']).optional().describe('Pack type. Auto-detects by default.'),
  },
  async ({ path, versions, all, strict, mode }) => {
    try {
      const dir = resolve(path)
      if (!existsSync(dir)) {
        return { content: [{ type: 'text' as const, text: `Error: Directory not found: ${dir}` }], isError: true }
      }
      if (!existsSync(`${dir}/pack.mcmeta`)) {
        return { content: [{ type: 'text' as const, text: `Error: No pack.mcmeta found in ${dir}` }], isError: true }
      }

      const hasData = existsSync(`${dir}/data`)
      const hasAssets = existsSync(`${dir}/assets`)
      let resolvedMode = mode ?? 'auto'
      if (resolvedMode === 'auto') {
        resolvedMode = hasData && !hasAssets ? 'datapack' : hasAssets && !hasData ? 'resourcepack' : 'datapack'
      }

      const result = resolvedMode === 'resourcepack'
        ? await checkResourcePack(dir, versions, all)
        : await checkCompatibilityContentBased(dir, versions, all, strict)

      const compatible = result.compatible.map(v => ({
        version: v.version.name,
        pack_format: v.version.data_pack_version,
      }))

      const incompatible = result.incompatible.map(v => ({
        version: v.version.name,
        status: v.status,
        mcfunction_issues: v.mcfunction_issues.map(i => ({
          file: i.file, line: i.line, command: i.command, issue: i.issue,
          suggestion: i.suggestion, autoFixable: i.autoFixable,
        })),
        registry_issues: v.registry_issues.map(i => ({
          file: i.file, registry: i.registry, entry: i.entry, issue: i.issue,
          suggestion: i.suggestion, autoFixable: i.autoFixable,
        })),
        structural_issues: (v.structural_issues ?? []).map(i => ({
          file: i.file, issue: i.issue, suggestion: i.suggestion, autoFixable: i.autoFixable,
        })),
        deprecation_issues: (v.deprecation_issues ?? []).map(i => ({
          file: i.file, registry: i.registry, entry: i.entry, issue: i.issue,
          suggestion: i.suggestion, autoFixable: i.autoFixable,
        })),
        breaking_changes: v.breaking_changes ?? [],
      }))

      const summary = {
        mode: resolvedMode,
        versions_checked: result.versions_checked,
        compatible_count: compatible.length,
        incompatible_count: incompatible.length,
        min_version: (result as any).min_version ?? null,
        load_range: (result as any).load_range ?? null,
      }

      return {
        content: [{ type: 'text' as const, text: JSON.stringify({ summary, compatible, incompatible }, null, 2) }],
      }
    } catch (err: any) {
      return { content: [{ type: 'text' as const, text: `Error checking pack: ${err.message}` }], isError: true }
    }
  },
)

// ---------------------------------------------------------------------------
// Tool: dpcheck_fix_preview
// ---------------------------------------------------------------------------
server.tool(
  'dpcheck_fix_preview',
  'Preview what auto-fix/porting would do to a datapack or resource pack without writing any files. Shows command rewrites, JSON fixes, and items needing manual attention.',
  {
    path: z.string().describe('Path to the datapack or resource pack directory'),
    targetVersion: z.string().describe('Target version to port to (e.g. "1.21.4")'),
    sourceVersion: z.string().optional().describe('Override source version (auto-detected from pack.mcmeta if omitted)'),
  },
  async ({ path, targetVersion, sourceVersion }) => {
    try {
      const dir = resolve(path)
      if (!existsSync(dir)) {
        return { content: [{ type: 'text' as const, text: `Error: Directory not found: ${dir}` }], isError: true }
      }
      if (!existsSync(`${dir}/pack.mcmeta`)) {
        return { content: [{ type: 'text' as const, text: `Error: No pack.mcmeta found in ${dir}` }], isError: true }
      }

      const isRp = existsSync(`${dir}/assets`) && !existsSync(`${dir}/data`)
      const tmpOut = `${dir}_preview_tmp`

      const fixResult = isRp
        ? await fixResourcePack({ packDir: dir, outputDir: tmpOut, targetVersion, sourceVersion })
        : await fixDatapack({ datapackDir: dir, outputDir: tmpOut, targetVersion, sourceVersion })

      const plan = fixResult.plan
      const preview = {
        sourceVersion: plan?.sourceVersion ?? null,
        targetVersion: plan?.targetVersion ?? null,
        direction: plan?.direction ?? null,
        summary: fixResult.summary,
        command_rewrites: plan?.rewrites ?? [],
        json_fixes: plan?.jsonFixes?.map(j => ({ type: j.type, file_count: j.files.length, files: j.files })) ?? [],
        manual_attention: plan?.manualAttention ?? [],
        cascade_effects: plan?.cascadeEffects ?? [],
        skipped_files: plan?.skippedFiles ?? [],
        results: fixResult.results.map(r => ({
          file: r.file, patches: r.patches, details: r.details,
        })),
      }

      return {
        content: [{ type: 'text' as const, text: JSON.stringify(preview, null, 2) }],
      }
    } catch (err: any) {
      return { content: [{ type: 'text' as const, text: `Error previewing fix: ${err.message}` }], isError: true }
    }
  },
)

// ---------------------------------------------------------------------------
// Tool: dpcheck_fix
// ---------------------------------------------------------------------------
server.tool(
  'dpcheck_fix',
  'Auto-port a datapack or resource pack to a target Minecraft version. Rewrites invalid commands, fixes JSON structure, updates pack.mcmeta. Outputs fixed files to a new directory.',
  {
    path: z.string().describe('Path to the datapack or resource pack directory'),
    targetVersion: z.string().describe('Target version to port to (e.g. "1.21.4")'),
    sourceVersion: z.string().optional().describe('Override source version (auto-detected if omitted)'),
    outputPath: z.string().optional().describe('Custom output directory. Defaults to {pack}_fixed_{version}/'),
  },
  async ({ path, targetVersion, sourceVersion, outputPath }) => {
    try {
      const dir = resolve(path)
      if (!existsSync(dir)) {
        return { content: [{ type: 'text' as const, text: `Error: Directory not found: ${dir}` }], isError: true }
      }
      if (!existsSync(`${dir}/pack.mcmeta`)) {
        return { content: [{ type: 'text' as const, text: `Error: No pack.mcmeta found in ${dir}` }], isError: true }
      }

      const isRp = existsSync(`${dir}/assets`) && !existsSync(`${dir}/data`)
      const outDir = outputPath ?? `${dir}_fixed_${targetVersion.replace(/[^a-zA-Z0-9._-]/g, '_')}`

      const fixResult = isRp
        ? await fixResourcePack({ packDir: dir, outputDir: outDir, targetVersion, sourceVersion })
        : await fixDatapack({ datapackDir: dir, outputDir: outDir, targetVersion, sourceVersion })

      const summary = {
        output_directory: outDir,
        files_fixed: fixResult.summary.filesFixed,
        total_patches: fixResult.summary.totalPatches,
        errors: fixResult.summary.errors,
        plan: fixResult.plan ? {
          source: fixResult.plan.sourceVersion,
          target: fixResult.plan.targetVersion,
          command_rewrites: fixResult.plan.summary.commandRewrites,
          json_fixes: fixResult.plan.summary.jsonFixes,
          manual_attention: fixResult.plan.summary.manualAttention,
          skipped_files: fixResult.plan.summary.skippedFiles,
        } : null,
        results: fixResult.results.map(r => ({
          file: r.file, patches: r.patches, details: r.details,
        })),
      }

      return {
        content: [{ type: 'text' as const, text: JSON.stringify(summary, null, 2) }],
      }
    } catch (err: any) {
      return { content: [{ type: 'text' as const, text: `Error fixing pack: ${err.message}` }], isError: true }
    }
  },
)

// ---------------------------------------------------------------------------
// Tool: dpcheck_analyze
// ---------------------------------------------------------------------------
server.tool(
  'dpcheck_analyze',
  'Analyze a datapacks dependency graph. Finds orphans, broken references, circular dependencies, and computes metrics (function count, command count, execute depth, namespace distribution).',
  {
    path: z.string().describe('Path to the datapack directory'),
  },
  async ({ path }) => {
    try {
      const dir = resolve(path)
      if (!existsSync(dir)) {
        return { content: [{ type: 'text' as const, text: `Error: Directory not found: ${dir}` }], isError: true }
      }
      if (!existsSync(`${dir}/pack.mcmeta`)) {
        return { content: [{ type: 'text' as const, text: `Error: No pack.mcmeta found in ${dir}` }], isError: true }
      }

      const analysis = await analyzePack(dir)

      const result = {
        metrics: analysis.metrics,
        orphans: analysis.orphans.map(o => ({
          type: o.type, namespace: o.namespace, name: o.name, file: o.file,
        })),
        broken_refs: analysis.brokenRefs.map(r => ({
          from: r.from, to: r.to, type: r.type, file: r.file, line: r.line,
        })),
        circular_deps: analysis.circularDeps,
        resource_count: analysis.resources.length,
        reference_count: analysis.references.length,
      }

      return {
        content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
      }
    } catch (err: any) {
      return { content: [{ type: 'text' as const, text: `Error analyzing pack: ${err.message}` }], isError: true }
    }
  },
)

// ---------------------------------------------------------------------------
// Start server
// ---------------------------------------------------------------------------
async function main() {
  const transport = new StdioServerTransport()
  await server.connect(transport)
}

main().catch(err => {
  console.error('dpcheck MCP server error:', err)
  process.exit(1)
})
