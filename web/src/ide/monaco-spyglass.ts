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

// Spyglass CompletionKind -> Monaco CompletionItemKind. The two enums use
// different numbering (Spyglass starts at 1, Monaco at 0, Keyword/Text/etc.
// are shifted), so pass items through this map or every icon renders wrong.
const KIND_MAP: Record<number, number> = {
  1: 18,   // Text
  2: 0,    // Method
  3: 1,    // Function
  4: 2,    // Constructor
  5: 3,    // Field
  6: 4,    // Variable
  7: 5,    // Class
  8: 7,    // Interface
  9: 8,    // Module
  10: 9,   // Property
  11: 12,  // Unit
  12: 13,  // Value
  13: 15,  // Enum
  14: 17,  // Keyword
  15: 27,  // Snippet
  16: 19,  // Color
  17: 20,  // File
  18: 21,  // Reference
  19: 23,  // Folder
  20: 16,  // EnumMember
  21: 14,  // Constant
  22: 6,   // Struct
  23: 10,  // Event
  24: 11,  // Operator
  25: 24,  // TypeParameter
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

// Semantic tokens cache: keyed by path + Monaco model version id, stores
// {data, resultId, ts}. The version id part makes edits invalidate the
// cache immediately instead of serving stale colors for up to TTL.
const tokenCache = new Map<string, { data: Uint32Array; resultId: string; ts: number }>()
const TOKEN_CACHE_TTL = 400

export function registerSpyglassMonaco(
  monaco: typeof Monaco,
  getService: () => SpyglassService | null,
): void {
  const { languages } = monaco

  // Same Spyglass-backed providers for mcfunction, datapack mcdoc JSON and
  // NBT — mirrors the VSCode extension's language registration.
  const languages_ = ['mcfunction', 'json', 'snbt'] as const

  languages.setLanguageConfiguration('mcfunction', {
    comments: { lineComment: '#' },
    brackets: [['(', ')']],
    autoClosingPairs: [{ open: '(', close: ')' }],
    surroundingPairs: [{ open: '(', close: ')' }],
  })

  languages.registerDocumentSemanticTokensProvider([...languages_], {
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

      // Cache key includes the model version: edits invalidate immediately.
      const cacheKey = `${path}@${model.getVersionId()}`
      const cached = tokenCache.get(cacheKey)
      const now = Date.now()
      if (cached && (now - cached.ts) < TOKEN_CACHE_TTL) {
        return { data: cached.data, resultId: cached.resultId }
      }

      await service.ensureFileSynced(path, model.getValue())
      if (token.isCancellationRequested) return { data: new Uint32Array(0), resultId: '0' }
      const file = service.getFile(path)
      if (!file) return { data: new Uint32Array(0), resultId: '0' }

      const tokens = await service.getSemanticTokens(path)
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
      tokenCache.set(cacheKey, { data: result.data, resultId: result.resultId, ts: Date.now() })
      return result
    },
    releaseDocumentSemanticTokens() {},
  })

  languages.registerCompletionItemProvider([...languages_], {
    triggerCharacters: [
      ' ', '/', '$', '@', '#', '~', '^', '!', '?', '.', ':', ';', '=', '>', '<', '(', '{', '[',
    ],
    async provideCompletionItems(model: Monaco.editor.ITextModel, position: Monaco.Position, context: Monaco.languages.CompletionContext, token: Monaco.CancellationToken) {
      const service = getService()
      if (!service) return { suggestions: [] }
      const path = pathFromUri(model.uri)

      // Sync the Spyglass doc to the Monaco model first, then compute the
      // offset from Monaco itself — the parsed node may still lag the model
      // content during typing, and a stale doc makes every offset mismatch.
      await service.ensureFileSynced(path, model.getValue())
      if (token.isCancellationRequested) return { suggestions: [] }
      const file = service.getFile(path)
      if (!file) return { suggestions: [] }

      const offset = model.getOffsetAt(position)
      const items = await service.getCompletions(path, offset, context.triggerCharacter)
      if (token.isCancellationRequested) return { suggestions: [] }

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
            kind: (KIND_MAP[item.kind ?? 1] ?? 18) as Monaco.languages.CompletionItemKind,
            detail: item.detail,
            documentation: item.documentation ? { value: item.documentation } : undefined,
            insertText: item.insertText ?? item.label,
            range,
          }
        }),
      }
    },
  })

  languages.registerHoverProvider([...languages_], {
    async provideHover(model, position) {
      const service = getService()
      if (!service) return null
      const path = pathFromUri(model.uri)

      await service.ensureFileSynced(path, model.getValue())
      const file = service.getFile(path)
      if (!file) return null

      const offset = model.getOffsetAt(position)
      const hover = await service.getHover(path, offset)
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

  languages.registerDefinitionProvider([...languages_], {
    async provideDefinition(model, position) {
      const service = getService()
      if (!service) return []
      const path = pathFromUri(model.uri)

      await service.ensureFileSynced(path, model.getValue())
      const file = service.getFile(path)
      if (!file) return []

      const offset = model.getOffsetAt(position)
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
