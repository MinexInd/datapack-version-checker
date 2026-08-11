import type * as Monaco from 'monaco-editor'
import type { SpyglassService } from '../engine/spyglass-service'

const PACK_PREFIX = '/pack/'
const PACK_URI_PREFIX = 'file:///pack/'

function pathFromUri(uri: Monaco.Uri): string {
  const raw = uri.path
  if (!raw.startsWith(PACK_PREFIX)) return raw
  return raw.slice(PACK_PREFIX.length)
}

// Spyglass ColorTokenTypes, in fixed legend order so indices stay stable.
const LEGEND_TYPES = [
  'comment', 'enum', 'enumMember', 'escape', 'function', 'keyword',
  'modifier', 'number', 'property', 'string', 'struct', 'type',
  'variable', 'error', 'literal', 'operator', 'resourceLocation', 'vector',
] as const

// Spyglass ColorTokenModifiers, in fixed legend order.
const LEGEND_MODIFIERS = [
  'declaration', 'defaultLibrary', 'definition', 'deprecated',
  'documentation', 'modification', 'readonly',
] as const

function posToMonaco(doc: SpyglassDoc, offset: number) {
  const p = doc.positionAt(offset)
  return { lineNumber: p.line + 1, column: p.character + 1 }
}

interface SpyglassDoc {
  positionAt(offset: number): { line: number; character: number }
  offsetAt(pos: { line: number; character: number }): number
}

/**
 * Register Monaco providers (semantic tokens, completions, hover,
 * definition) for the `mcfunction` language, backed by the shared
 * SpyglassService instance. The service is resolved lazily via `getService`
 * so providers stay valid before the service is initialized.
 */

// Semantic tokens cache: keyed by path, stores {data, resultId, ts}
const tokenCache = new Map<string, { data: Uint32Array; resultId: string; ts: number }>()
const TOKEN_CACHE_TTL = 400

export function registerSpyglassMonaco(
  monaco: typeof Monaco,
  getService: () => SpyglassService | null,
): void {
  const { languages } = monaco

  languages.setLanguageConfiguration('mcfunction', {
    comments: { lineComment: '#' },
    brackets: [['(', ')']],
    autoClosingPairs: [{ open: '(', close: ')' }],
    surroundingPairs: [{ open: '(', close: ')' }],
  })

  languages.registerDocumentSemanticTokensProvider('mcfunction', {
    getLegend() {
      return {
        tokenTypes: [...LEGEND_TYPES],
        tokenModifiers: [...LEGEND_MODIFIERS],
      }
    },
    async provideDocumentSemanticTokens(model: Monaco.editor.ITextModel, _lastResultId: string | null, token: Monaco.CancellationToken) {
      const service = getService()
      if (!service) return { data: new Uint32Array(0), resultId: '0' }
      const path = pathFromUri(model.uri)

      // Check cache — return if fresh enough
      const cached = tokenCache.get(path)
      const now = Date.now()
      if (cached && (now - cached.ts) < TOKEN_CACHE_TTL) {
        return { data: cached.data, resultId: cached.resultId }
      }

      const file = service.getFile(path)
      if (!file) return { data: new Uint32Array(0), resultId: '0' }

      const tokens = service.getSemanticTokens(path)
      const data: number[] = []
      let prevLine = 0
      let prevStart = 0

      for (const t of tokens) {
        if (token.isCancellationRequested) break
        const start = file.doc.positionAt(t.range.start)
        const end = file.doc.positionAt(t.range.end)
        const deltaLine = start.line - prevLine
        const deltaStart = start.line === prevLine ? start.character - prevStart : start.character
        const length = end.character - start.character
        const typeIndex = LEGEND_TYPES.indexOf(t.type)
        const modifierBits = (t.modifiers ?? []).reduce(
          (bits, m) => bits | (1 << LEGEND_MODIFIERS.indexOf(m)),
          0,
        )

        data.push(deltaLine, deltaStart, length, typeIndex, modifierBits)
        prevLine = start.line
        prevStart = start.character
      }

      const result = { data: new Uint32Array(data), resultId: String(data.length) }
      tokenCache.set(path, { data: result.data, resultId: result.resultId, ts: Date.now() })
      return result
    },
    releaseDocumentSemanticTokens() {},
  })

  languages.registerCompletionItemProvider('mcfunction', {
    triggerCharacters: [
      ' ', '/', '$', '@', '#', '~', '^', '!', '?', '.', ':', ';', '=', '>', '<', '(', '{', '[',
    ],
    async provideCompletionItems(model: Monaco.editor.ITextModel, position: Monaco.Position, context: Monaco.languages.CompletionContext, token: Monaco.CancellationToken) {
      const service = getService()
      if (!service) return { suggestions: [] }
      const path = pathFromUri(model.uri)
      const file = service.getFile(path)
      if (!file) return { suggestions: [] }

      const offset = file.doc.offsetAt({
        line: position.lineNumber - 1,
        character: position.column - 1,
      })

      const items = service.getCompletions(path, offset, context.triggerCharacter)
      return {
        suggestions: items.map(item => {
          const range = item.range
            ? {
                startLineNumber: file.doc.positionAt(item.range.start).line + 1,
                startColumn: file.doc.positionAt(item.range.start).character + 1,
                endLineNumber: file.doc.positionAt(item.range.end).line + 1,
                endColumn: file.doc.positionAt(item.range.end).character + 1,
              }
            : {
                startLineNumber: position.lineNumber,
                startColumn: position.column,
                endLineNumber: position.lineNumber,
                endColumn: position.column,
              }

          return {
            label: item.label,
            kind: (item.kind ?? 1) as Monaco.languages.CompletionItemKind,
            detail: item.detail,
            documentation: item.documentation ? { value: item.documentation } : undefined,
            insertText: item.insertText ?? item.label,
            range,
          }
        }),
      }
    },
  })

  languages.registerHoverProvider('mcfunction', {
    async provideHover(model, position) {
      const service = getService()
      if (!service) return null
      const path = pathFromUri(model.uri)
      const file = service.getFile(path)
      if (!file) return null

      const offset = file.doc.offsetAt({
        line: position.lineNumber - 1,
        character: position.column - 1,
      })

      const hover = service.getHover(path, offset)
      if (!hover) return null

      return {
        range: {
          startLineNumber: file.doc.positionAt(hover.range.start).line + 1,
          startColumn: file.doc.positionAt(hover.range.start).character + 1,
          endLineNumber: file.doc.positionAt(hover.range.end).line + 1,
          endColumn: file.doc.positionAt(hover.range.end).character + 1,
        },
        contents: [{ value: hover.markdown, isTrusted: false }],
      }
    },
  })

  languages.registerDefinitionProvider('mcfunction', {
    async provideDefinition(model, position) {
      const service = getService()
      if (!service) return []
      const path = pathFromUri(model.uri)
      const file = service.getFile(path)
      if (!file) return []

      const offset = file.doc.offsetAt({
        line: position.lineNumber - 1,
        character: position.column - 1,
      })

      const defs = await service.getDefinition(path, offset)
      return defs
        .filter(d => d.uri.startsWith(PACK_URI_PREFIX))
        .map(d => {
          const targetFile = service.getFile(d.uri.slice(PACK_URI_PREFIX.length))
          const doc = targetFile?.doc ?? file.doc
          return {
            uri: monaco.Uri.parse(d.uri),
            range: {
              startLineNumber: doc.positionAt(d.range.start).line + 1,
              startColumn: doc.positionAt(d.range.start).character + 1,
              endLineNumber: doc.positionAt(d.range.end).line + 1,
              endColumn: doc.positionAt(d.range.end).character + 1,
            },
          }
        })
    },
  })
}
