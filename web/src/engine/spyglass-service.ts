import { Service, Logger, FileNode } from '@spyglassmc/core'
import { initialize as jeInitialize } from '@spyglassmc/java-edition'
import type { TextDocument } from 'vscode-languageserver-textdocument'
import { createBrowserExternals, type CacheLike } from './browser-externals'
import { createIdbCache } from './idb-cache'

const PACK_ROOT = 'file:///pack/'
const CACHE_DB = 'ide-spyglass-cache'

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

  constructor(idbCacheDb = CACHE_DB) {
    this.idbCacheDb = idbCacheDb
  }

  get ready(): boolean {
    return this.service !== null
  }

  async init(files: Record<string, string>, gameVersion = 'Auto'): Promise<void> {
    await this.close()

    // Resolve gameVersion: if no pack.mcmeta present, 'Auto' will fail, so fall back
    const hasMcmeta = Object.keys(files).some(p => p === 'pack.mcmeta' || p.endsWith('/pack.mcmeta'))
    const resolvedVersion = gameVersion === 'Auto' && !hasMcmeta ? '1.21' : gameVersion

    const cache = await createIdbCache(this.idbCacheDb)
    const spikeCache = Object.assign(createSpikeCache(), {
      async get(url: string) { return cache.get(url) },
      async put(url: string, response: Response) { return cache.put(url, response) },
    })

    const externals = createBrowserExternals(spikeCache)
    const logger = Logger.noop()

    for (const [path, content] of Object.entries(files)) {
      await externals.fs.writeFile(PACK_ROOT + path, content)
    }

    const service = new Service({
      logger,
      project: {
        cacheRoot: 'file:///cache/',
        externals,
        projectRoots: [PACK_ROOT],
        logger,
        initializers: [jeInitialize],
        defaultConfig: {
          env: {
            dependencies: ['@vanilla-datapack', '@vanilla-resourcepack', '@vanilla-mcdoc'],
            exclude: [],
            customResources: {},
            feature: {
              codeActions: false,
              colors: true,
              completions: true,
              documentHighlighting: false,
              documentLinks: false,
              foldingRanges: false,
              formatting: false,
              hover: true,
              inlayHint: false,
              semanticColoring: true,
              selectionRanges: false,
              signatures: false,
            },
            gameVersion: resolvedVersion,
            mcmetaSummaryOverrides: {},
            permissionLevel: 2,
            plugins: [],
            enableMcdocCaching: false,
          },
        } as any,
      },
    })

    // Assign before init so close() can always clean up (Issue 3 fix)
    this.service = service
    try {
      await service.project.init()
      await service.project.ready()
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
    await this.service.project.onDidOpen(uri, lang, version, content)
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
    await this.service.project.onDidChange(uri, [{ text: content }], version)
  }

  getMarkers(path: string): IdeMarker[] {
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

  getSemanticTokens(path: string) {
    const file = this.getFile(path)
    if (!file || !this.service) return []
    return this.service.colorize(file.node, file.doc)
  }

  getCompletions(path: string, offset: number, triggerCharacter?: string): IdeCompletionItem[] {
    const file = this.getFile(path)
    if (!file || !this.service) return []
    return this.service.complete(file.node, file.doc, offset, triggerCharacter)
  }

  getHover(path: string, offset: number): IdeHover | undefined {
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
}
