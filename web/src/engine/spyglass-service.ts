import { Service, Logger, FileNode, CheckerContext } from '@spyglassmc/core'
import { initialize as jeInitialize } from '@spyglassmc/java-edition'
import { initialize as mcdocInitialize, runtime as mcdocRuntime } from '@spyglassmc/mcdoc'
import type { McdocType } from '@spyglassmc/mcdoc'
import type { JsonFileNode, JsonNode } from '@spyglassmc/json'
import type { TextDocument } from 'vscode-languageserver-textdocument'
import type { SimplifiedMcdocType } from '../ide/mcdoc-edit'
import { createBrowserExternals, type CacheLike } from './browser-externals'
import { createIdbCache } from './idb-cache'
import { resolveDynamicTypes, spyglassTypeToEngine } from './type-bridge'

const { McdocCheckerContext } = mcdocRuntime.checker
type SimplifyContext = mcdocRuntime.checker.SimplifyContext<never>

const PACK_ROOT = 'file:///pack/'
const CACHE_DB = 'ide-spyglass-cache'
export const IDE_DEPENDENCIES = ['@vanilla-datapack', '@vanilla-resourcepack', '@vanilla-mcdoc'] as const

export type LogLevel = 'info' | 'warn' | 'error'
export type LogCallback = (level: LogLevel, message: string) => void

const SPAM_FILTER = [
  'Tried to access unknown dispatcher',
]

/** Forward Spyglass log output to a UI callback (Output panel) instead of dropping it. */
function createForwardingLogger(onLog: LogCallback): Logger {
  const fmt = (args: unknown[]) =>
    args.map(a => a instanceof Error ? a.message : typeof a === 'string' ? a : JSON.stringify(a)).join(' ')
  const isSpam = (msg: string) => SPAM_FILTER.some(s => msg.includes(s))
  return {
    error: (...args) => onLog('error', fmt(args)),
    warn: (...args) => onLog('warn', fmt(args)),
    info: (...args) => {
      const m = fmt(args)
      if (!isSpam(m)) onLog('info', m)
    },
    log: (...args) => {
      const m = fmt(args)
      if (!isSpam(m)) onLog('info', m)
    },
  }
}

export interface IdeFile {
  uri: string
  path: string
  doc: TextDocument
  node: FileNode<any>
}

export interface IdeMarker {
  severity: 'error' | 'warning' | 'info' | 'hint'
  message: string
  startLineNumber: number
  startColumn: number
  endLineNumber: number
  endColumn: number
}

export interface IdeCompletionItem {
  label: string
  kind?: number
  detail?: string
  documentation?: string
  insertText?: string
  range?: { start: number; end: number }
}

export interface IdeHover {
  range: { start: number; end: number }
  markdown: string
}

export interface IdeDefinition {
  uri: string
  range: { start: number; end: number }
}

function guessLanguage(path: string): string {
  const ext = path.split('.').pop()?.toLowerCase()
  if (ext === 'json' || path.endsWith('.mcmeta')) return 'json'
  if (ext === 'mcfunction') return 'mcfunction'
  if (ext === 'nbt' || ext === 'snbt') return 'snbt'
  return ''
}

function severityName(severity: number): IdeMarker['severity'] {
  if (severity >= 3) return 'error'
  if (severity === 2) return 'warning'
  if (severity === 1) return 'info'
  return 'hint'
}

function createSpikeCache(): Cache & CacheLike {
  const store = new Map<string, Response>()
  const toUrl = (input: RequestInfo): string =>
    typeof input === 'string' ? input : input instanceof Request ? input.url : String(input)

  return {
    async get(url: string) { return store.get(url)?.clone() ?? null },
    async put(input: string | Request, response: Response) {
      store.set(toUrl(input as RequestInfo), response.clone())
    },
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
      return store.has(toUrl(request)) ? [new Request(toUrl(request))] : []
    },
  } as unknown as Cache & CacheLike
}

export class SpyglassService {
  private service: Service | null = null
  private versions = new Map<string, number>()
  private readonly idbCacheDb: string
  private readonly onLog: LogCallback
  /** Chain of in-flight parse operations. Feature getters await it so they
   *  never read a stale node right after an edit (completions were racing
   *  the reparse and silently returning []). */
  private parseChain: Promise<unknown> = Promise.resolve()

  constructor(idbCacheDb = CACHE_DB, onLog?: LogCallback) {
    this.idbCacheDb = idbCacheDb
    this.onLog = onLog ?? (() => {})
  }

  get ready(): boolean {
    return this.service !== null
  }

  private queueParse(p: Promise<unknown>): Promise<void> {
    const next = this.parseChain.then(() => p).then(() => undefined, () => undefined)
    this.parseChain = next
    return next
  }

  /** Wait for the latest open/change parse to settle before reading features. */
  private async settled(): Promise<void> {
    await this.parseChain
  }

  async init(
    files: Record<string, string>,
    gameVersion = 'Auto',
    dependencies: readonly string[] = IDE_DEPENDENCIES,
  ): Promise<void> {
    await this.close()

    const hasMcmeta = Object.keys(files).some(p => p === 'pack.mcmeta' || p.endsWith('/pack.mcmeta'))

    const cache = await createIdbCache(this.idbCacheDb)
    // Spyglass's fetcher always calls match/put with a Request object, never a
    // bare string — normalize to URL strings so the IDB cache actually
    // persists across inits (otherwise every load re-downloads the vanilla
    // tarballs and risks blowing the fetcher's hard 15s timeout).
    const toUrl = (input: RequestInfo | string): string =>
      typeof input === 'string' ? input : input instanceof Request ? input.url : String(input)
    const spikeCache = Object.assign(createSpikeCache(), {
      async match(input: RequestInfo) { return cache.get(toUrl(input)) },
      async put(input: RequestInfo | string, response: Response) { return cache.put(toUrl(input), response) },
    })

    const externals = createBrowserExternals(spikeCache)
    const logger = createForwardingLogger(this.onLog)

    for (const [path, content] of Object.entries(files)) {
      await externals.fs.writeFile(PACK_ROOT + path, content)
    }

    // When there is no pack.mcmeta, 'Auto' version detection inside
    // jeInitialize will fail. Write a minimal spyglass.json so the config
    // service can override gameVersion to a safe default. When pack.mcmeta
    // is present, VanillaConfig's 'Auto' resolves correctly and this file
    // is ignored.
    if (!hasMcmeta) {
      await externals.fs.writeFile(PACK_ROOT + 'spyglass.json', JSON.stringify({
        env: { gameVersion: '1.21' },
      }))
    }

    // Omit defaultConfig entirely — VanillaConfig (used when undefined)
    // includes the correct lint, format, and env defaults. Passing a
    // partial config replaces VanillaConfig wholesale, which drops the
    // lint block and causes every lint/complete call to throw.
    const service = new Service({
      logger,
      project: {
        cacheRoot: 'file:///cache/',
        externals,
        projectRoots: [PACK_ROOT],
        logger,
        // jeInitialize alone never registers the mcdoc language, so the
        // vanilla-mcdoc dependency's .mcdoc files are not bound and every
        // JSON file's dispatcher lookup fails (checker falls back to `any`).
        // mcdocInitialize must be listed explicitly.
        initializers: [jeInitialize, mcdocInitialize],
      },
    })

    // Assign before init so close() can always clean up (Issue 3 fix)
    this.service = service
    try {
      await this.queueParse(service.project.init())
      await this.queueParse(service.project.ready())
    } catch (e) {
      // Init failed — clean up the assigned service to avoid stale state
      this.service = null
      try { await service.project.close() } catch { /* noop */ }
      throw e
    }
  }

  async close(): Promise<void> {
    if (this.service) {
      try { await this.service.project.close() } catch { /* noop */ }
    }
    this.service = null
    this.versions.clear()
  }

  getFile(path: string): IdeFile | undefined {
    if (!this.service) return undefined
    const uri = PACK_ROOT + path
    const managed = this.service.project.getClientManaged(uri)
    if (!managed) return undefined
    return {
      uri,
      path,
      doc: managed.doc,
      node: managed.node,
    }
  }

  async openFile(path: string, content: string): Promise<void> {
    if (!this.service) return
    const uri = PACK_ROOT + path
    const version = (this.versions.get(uri) ?? 0) + 1
    this.versions.set(uri, version)
    const lang = guessLanguage(path)
    await this.queueParse(this.service.project.onDidOpen(uri, lang, version, content))
  }

  async updateFile(path: string, content: string): Promise<void> {
    if (!this.service) return
    const uri = PACK_ROOT + path
    // If no TextDocument exists yet (openFile hasn't completed), open first
    if (!this.service.project.getClientManaged(uri)) {
      await this.openFile(path, content)
      return
    }
    const version = (this.versions.get(uri) ?? 0) + 1
    this.versions.set(uri, version)
    await this.queueParse(this.service.project.onDidChange(uri, [{ text: content }], version))
  }

  /** Bring the Spyglass doc in sync with the Monaco model text, so offsets
   *  computed from Monaco map cleanly onto the parsed node. No-op when the
   *  doc already matches (fast path for every keystroke). */
  async ensureFileSynced(path: string, content: string): Promise<void> {
    if (!this.service) return
    const managed = this.service.project.getClientManaged(PACK_ROOT + path)
    if (managed && managed.doc.getText() === content) {
      await this.settled()
      return
    }
    if (managed) await this.updateFile(path, content)
    else await this.openFile(path, content)
  }

  async getMarkers(path: string): Promise<IdeMarker[]> {
    await this.settled()
    const file = this.getFile(path)
    if (!file) return []
    const errors = FileNode.getErrors(file.node)
    return errors.map(err => {
      const start = file.doc.positionAt(err.range.start)
      const end = file.doc.positionAt(err.range.end)
      return {
        severity: severityName(err.severity),
        message: err.message,
        startLineNumber: start.line + 1,
        startColumn: start.character + 1,
        endLineNumber: end.line + 1,
        endColumn: end.character + 1,
      }
    })
  }

  async getSemanticTokens(path: string) {
    await this.settled()
    const file = this.getFile(path)
    if (!file || !this.service) return []
    return this.service.colorize(file.node, file.doc)
  }

  async getCompletions(path: string, offset: number, triggerCharacter?: string): Promise<IdeCompletionItem[]> {
    await this.settled()
    const file = this.getFile(path)
    if (!file || !this.service) return []
    return this.service.complete(file.node, file.doc, offset, triggerCharacter)
  }

  async getHover(path: string, offset: number): Promise<IdeHover | undefined> {
    await this.settled()
    const file = this.getFile(path)
    if (!file || !this.service) return undefined
    const hover = this.service.getHover(file.node, file.doc, offset)
    if (!hover) return undefined
    return {
      range: hover.range,
      markdown: hover.markdown,
    }
  }

  async getDefinition(path: string, offset: number): Promise<IdeDefinition[]> {
    await this.settled()
    const file = this.getFile(path)
    if (!file || !this.service) return []
    const result = await this.service.getSymbolLocations(file.node, file.doc, offset, ['definition', 'declaration'])
    if (!result?.locations) return []
    return result.locations
      .filter(loc => loc.uri.startsWith(PACK_ROOT))
      .map(loc => ({
        uri: loc.uri,
        range: loc.range ?? { start: 0, end: 0 },
      }))
  }

  /** Resolve the mcdoc schema for a JSON file's root node. References and
   *  dispatchers are already resolved and since/until filters applied by the
   *  checker for the current game version. Returns null when the file is not
   *  open or carries no type info (e.g. unknown resource category). */
  async getSimplifiedRootType(path: string): Promise<SimplifiedMcdocType | null> {
    await this.settled()
    const file = this.getFile(path)
    if (!file || !this.service) return null
    // Core FileNode wraps the language's file node, which wraps the root
    // JsonNode: file -> json:file -> json:object.
    const jsonFile = file.node.children[0] as JsonFileNode | undefined
    const root = jsonFile?.children[0] as JsonNode | undefined
    if (!root?.typeDef) return null
    // The checker's simplify is shallow: struct pair-field types keep raw
    // references/dispatchers. Resolve them via the checker's own simplify,
    // which queries the project symbol table (needs a checker context).
    const checkerCtx = CheckerContext.create(this.service.project, { doc: file.doc })
    const mcdocCtx = McdocCheckerContext.create<never>(checkerCtx, {})
    const simplifyCtx: SimplifyContext = {
      node: {
        entryNode: { parent: undefined, runtimeKey: undefined },
        node: { originalNode: undefined as never, inferredType: undefined as never },
      },
      ctx: mcdocCtx,
    }
    const resolved = resolveDynamicTypes(root.typeDef as unknown as McdocType, simplifyCtx)
    return spyglassTypeToEngine(resolved)
  }

  /** Open every file in the pack, wait for all parses to settle, then
   *  collect markers from every file. Used by the "Analyze Datapack"
   *  button which needs whole-pack diagnostics in one pass. */
  async analyzeAll(
    files: Record<string, string>,
    onProgress?: (done: number, total: number) => void,
  ): Promise<{ path: string; marker: IdeMarker }[]> {
    if (!this.service) return []

    const paths = Object.keys(files)
    const total = paths.length
    // Fire off opens for every file — they chain through parseChain so
    // they execute in order but we only await once at the end.
    let done = 0
    await Promise.all(
      paths.map((path) =>
        this.openFile(path, files[path]).then(() => {
          done++
          onProgress?.(done, total)
        }),
      ),
    )
    await this.settled()

    const results: { path: string; marker: IdeMarker }[] = []
    for (const path of paths) {
      const file = this.getFile(path)
      if (!file) continue
      const errors = FileNode.getErrors(file.node)
      for (const err of errors) {
        const start = file.doc.positionAt(err.range.start)
        const end = file.doc.positionAt(err.range.end)
        results.push({
          path,
          marker: {
            severity: severityName(err.severity),
            message: err.message,
            startLineNumber: start.line + 1,
            startColumn: start.character + 1,
            endLineNumber: end.line + 1,
            endColumn: end.character + 1,
          },
        })
      }
    }
    return results
  }
}
