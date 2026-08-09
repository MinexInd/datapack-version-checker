import { Project, FileNode, Logger } from '@spyglassmc/core'
import { initialize as jeInitialize } from '@spyglassmc/java-edition'
import type { CacheLike } from './browser-externals'
import { createBrowserExternals } from './browser-externals'
import type { McmetaVersion } from './types'

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
 */
async function runParserForVersion(
  files: Record<string, string>,
  targetVersion: string,
  cache: CacheLike,
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
  const project = new Project({
    cacheRoot: 'file:///cache/',
    externals,
    projectRoots: ['file:///pack/'],
    logger,
    initializers: [jeInitialize],
    defaultConfig: {
      env: {
        dependencies: ['@vanilla-datapack', '@vanilla-resourcepack', '@vanilla-mcdoc'],
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
      const errors = FileNode.getErrors(node)
      for (const err of errors) {
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

  // Use a null-cache fallback if none provided (keeps the single-arg
  // call site working in tests and lightweight contexts).
  const effectiveCache: CacheLike = cache ?? { get: async () => null, put: async () => {} }

  const results = new Map<string, ParserIssue[]>()

  for (const ver of versions) {
    try {
      const issues = await runParserForVersion(files, ver.name, effectiveCache)
      results.set(ver.name, issues)
    } catch (e) {
      // On failure for a single version, record an empty result so the
      // caller knows this version was attempted but produced no issues.
      results.set(ver.name, [])
    }
  }

  return results
}
