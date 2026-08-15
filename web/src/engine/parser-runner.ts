import { Project, FileNode, Logger } from '@spyglassmc/core'
import { initialize as jeInitialize } from '@spyglassmc/java-edition'
import type { CacheLike } from './browser-externals'
import { createBrowserExternals } from './browser-externals'
import { createIdbCache } from './idb-cache'
import type { McmetaVersion } from './types'

/**
 * Deterministic, order-independent hash of pack contents.
 * Sorts entries by path so file order doesn't affect the hash.
 * Uses djb2 for speed — collision resistance isn't critical here,
 * just avoiding re-parsing identical packs.
 */
export function hashPack(files: Record<string, string>): string {
  const entries = Object.entries(files).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
  let hash = 5381
  for (const [path, content] of entries) {
    // Mix path then content into the hash
    for (let i = 0; i < path.length; i++) {
      hash = ((hash << 5) + hash + path.charCodeAt(i)) | 0
    }
    // null separator
    hash = ((hash << 5) + hash) | 0
    for (let i = 0; i < content.length; i++) {
      hash = ((hash << 5) + hash + content.charCodeAt(i)) | 0
    }
  }
  // Convert to unsigned hex
  return (hash >>> 0).toString(16)
}

const PARSER_CACHE_DB = 'parser-result-cache'

export interface ParserIssue {
  file: string
  line: number
  message: string
  severity: 'error' | 'warning' | 'info' | 'hint'
  source: string
}

// --- Cache bridge ---
// createBrowserExternals takes CacheLike (get/put by string URL) but the
// spyglass fetcher expects the standard Cache API (match/put by RequestInfo).
// This wrapper satisfies both interfaces so the `as unknown as Cache` cast
// inside browser-externals actually works at runtime.

function createSpikeCache(): Cache & CacheLike {
  const store = new Map<string, Response>()

  function toUrl(input: RequestInfo): string {
    if (typeof input === 'string') return input
    if (input instanceof Request) return input.url
    return String(input)
  }

  return {
    // CacheLike methods
    async get(url: string) { return store.get(url)?.clone() ?? null },
    // The fetcher calls put(Request, Response) — normalize the key to URL string.
    async put(input: string | Request, response: Response) {
      store.set(toUrl(input as RequestInfo), response.clone())
    },
    // Standard Cache API methods (used by spyglass fetcher)
    async match(request: RequestInfo) { return store.get(toUrl(request))?.clone() ?? undefined },
    async matchAll(request?: RequestInfo) {
      if (!request) return [...store.values()].map(r => r.clone())
      const r = store.get(toUrl(request))
      return r ? [r.clone()] : []
    },
    async add(): Promise<Response> { return undefined as unknown as Response },
    async addAll(): Promise<Response[]> { return [] },
    async delete(request: RequestInfo) { return store.delete(toUrl(request)) },
    async keys(request?: RequestInfo) {
      if (!request) return [...store.keys()].map(k => new Request(k))
      const url = toUrl(request)
      return store.has(url) ? [new Request(url)] : []
    },
  } as unknown as Cache & CacheLike
}

// --- Helpers ---

/**
 * Check if the pack has cross-file references that benefit from
 * vanilla datapack validation (function calls, loot table refs, etc.).
 * When none exist, the parser can skip the expensive tarball fetch.
 */
export function hasCrossFileReferences(files: Record<string, string>): boolean {
  for (const path of Object.keys(files)) {
    if (path.startsWith('data/') && (
      path.endsWith('.mcfunction') ||
      path.includes('/loot_tables/') ||
      path.includes('/advancements/')
    )) {
      return true
    }
  }
  return false
}

function guessLanguage(path: string): string {
  if (path.endsWith('.mcfunction')) return 'mcfunction'
  if (path.endsWith('.json')) return 'json'
  if (path.endsWith('.nbt')) return 'nbt'
  if (path.endsWith('.snbt')) return 'snbt'
  // Default: let Spyglass guess from extension
  return ''
}

const SeverityNames: Record<number, ParserIssue['severity']> = {
  0: 'hint',
  1: 'info',
  2: 'warning',
  3: 'error',
}

// --- Single-version helper (internal) ---

/**
 * Run the Spyglass parser against a single game version.
 * Returns raw ParserIssue[] for that version.
 *
 * When `needsVanillaData` is false the `@vanilla-datapack` dependency is
 * dropped so the expensive tarball fetch is skipped, but mcdoc structural
 * validation and command syntax checks still run against the pack files.
 */
async function runParserForVersion(
  files: Record<string, string>,
  targetVersion: string,
  cache: CacheLike,
  needsVanillaData: boolean,
): Promise<ParserIssue[]> {
  // Bridge: CacheLike (string-keyed get/put) to the standard Cache API
  // (match/put by RequestInfo) expected by the spyglass fetcher.
  const spikeCache = Object.assign(createSpikeCache(), {
    async get(url: string) { return cache.get(url) },
    async put(url: string, response: Response) { return cache.put(url, response) },
  })

  const externals = createBrowserExternals(spikeCache)
  const logger = Logger.noop()

  // defaultConfig REPLACES VanillaConfig entirely, so we must include the
  // full env.dependencies array and other required fields.
  // Drop @vanilla-datapack when we don't need cross-file reference
  // checking — this skips the expensive tarball fetch while still running
  // mcdoc structural validation and command syntax checks.
  const dependencies = needsVanillaData
    ? ['@vanilla-datapack', '@vanilla-resourcepack', '@vanilla-mcdoc']
    : ['@vanilla-resourcepack', '@vanilla-mcdoc']

  const project = new Project({
    cacheRoot: 'file:///cache/',
    externals,
    projectRoots: ['file:///pack/'],
    logger,
    initializers: [jeInitialize],
    defaultConfig: {
      env: {
        dependencies,
        exclude: [],
        customResources: {},
        feature: {
          codeActions: false, colors: false, completions: false,
          documentHighlighting: false, documentLinks: false,
          foldingRanges: false, formatting: false, hover: false,
          inlayHint: false, semanticColoring: false, selectionRanges: false,
          signatures: false,
        },
        gameVersion: targetVersion,
        mcmetaSummaryOverrides: {},
        permissionLevel: 2,
        plugins: [],
        enableMcdocCaching: false,
      },
    } as any,
  })

  try {
    // Write all pack files to the in-memory FS so the Project and the
    // initializer can find pack.mcmeta and other files.
    for (const [path, content] of Object.entries(files)) {
      await externals.fs.writeFile(`file:///pack/${path}`, content)
    }

    await project.init()
    await project.ready()

    const issues: ParserIssue[] = []
    for (const [path, content] of Object.entries(files)) {
      const uri = `file:///pack/${path}`
      const lang = guessLanguage(path)

      await project.onDidOpen(uri, lang, 1, content)

      const managed = project.getClientManaged(uri)
      if (!managed) continue

      const { doc, node } = managed
      // FileNode.getErrors covers checker/linter errors; parser errors are
      // emitted earlier and live on the node directly. Collect both so the
      // caller sees the full parse + check result set.
      const errors = FileNode.getErrors(node)
      const parserErrors = (node as any).parserErrors ?? []
      const allErrors = [...parserErrors, ...errors]
      for (const err of allErrors) {
        const pos = doc.positionAt(err.range.start)
        issues.push({
          file: path,
          line: pos.line + 1, // 1-indexed
          message: err.message,
          severity: SeverityNames[err.severity] ?? 'error',
          source: err.source ?? 'parser',
        })
      }
    }

    return issues
  } finally {
    await project.close()
  }
}

// --- Main entry point ---

/**
 * Run the Spyglass parser against a pack for the given versions.
 *
 * Accepts `allVersions` (the full MC version list) and an optional
 * `targetVersions` filter — mirroring the custom engine's
 * `checkCompatibilityContentBased` interface.  Returns a Map keyed by
 * version name, each entry holding the raw ParserIssue[] for that version.
 *
 * When `targetVersions` is provided, only those versions are checked;
 * otherwise all versions in `allVersions` are processed.
 */
export async function analyzePackWithSpyglass(
  files: Record<string, string>,
  allVersions: McmetaVersion[],
  targetVersions?: string[],
  cache?: CacheLike,
): Promise<Map<string, ParserIssue[]>> {
  // Determine which versions to check — same filtering logic as the
  // custom engine's relevantVersions computation.
  const versions = targetVersions
    ? allVersions.filter(v => targetVersions.includes(v.id) || targetVersions.includes(v.name))
    : allVersions

  // Early exit: if the pack has no parseable files, skip the parser entirely.
  const hasParseable = Object.keys(files).some(p =>
    p.endsWith('.mcfunction') || p.endsWith('.json') || p.endsWith('.nbt') || p.endsWith('.snbt')
  )
  if (!hasParseable) {
    return new Map<string, ParserIssue[]>()
  }

  // Use a null-cache fallback if none provided (keeps the single-arg
  // call site working in tests and lightweight contexts).
  const effectiveCache: CacheLike = cache ?? { get: async () => null, put: async () => {} }

  // Determine whether the pack contains cross-file references (function
  // calls, loot table refs, advancement refs).  When absent, skip the
  // expensive vanilla datapack tarball fetch but still run mcdoc structural
  // validation and command syntax checks against the pack files.
  const needsVanillaData = hasCrossFileReferences(files)

  // Open the parser result cache (IndexedDB-backed). Cache misses are cheap;
  // cache hits skip the entire Spyglass Project creation for that version.
  let resultCache: CacheLike | null = null
  try {
    resultCache = await createIdbCache(PARSER_CACHE_DB)
  } catch {
    // IndexedDB unavailable (private mode, etc.) — proceed without caching.
  }

  const packHash = hashPack(files)
  const results = new Map<string, ParserIssue[]>()

  const CONCURRENCY = 3
  for (let i = 0; i < versions.length; i += CONCURRENCY) {
    const batch = versions.slice(i, i + CONCURRENCY)
    await Promise.all(batch.map(async (ver) => {
      const cacheKey = `parser:${packHash}:${ver.name}`

      // Check the IDB cache first.
      if (resultCache) {
        try {
          const cached = await resultCache.get(cacheKey)
          if (cached) {
            const issues: ParserIssue[] = await cached.json()
            results.set(ver.name, issues)
            return
          }
        } catch {
          // Cache read failure — fall through to parse.
        }
      }

      try {
        const issues = await runParserForVersion(files, ver.name, effectiveCache, needsVanillaData)
        results.set(ver.name, issues)

        // Persist to cache. Write failures are non-fatal.
        if (resultCache) {
          resultCache.put(cacheKey, new Response(JSON.stringify(issues))).catch(() => {})
        }
      } catch (e) {
        // On failure for a single version, record an empty result so the
        // caller knows this version was attempted but produced no issues.
        results.set(ver.name, [])
      }
    }))
  }

  return results
}
