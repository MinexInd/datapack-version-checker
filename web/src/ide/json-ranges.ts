/**
 * json-ranges — Range-tracking JSON parser + byte-stable write-back engine.
 *
 * When the visual editor edits one node of a JSON file, we splice ONLY that
 * node's text range so untouched bytes (whitespace, newlines, formatting)
 * stay byte-identical.
 */

import { type JsonValue, type JsonPath, serializeNode, serializeJson } from './mcdoc-edit'

// ─── Public types ────────────────────────────────────────────────────────────

export interface JsonRangeNode {
  value: JsonValue
  /** Start offset (inclusive) of this node in the source string. */
  start: number
  /** End offset (exclusive) of this node in the source string. */
  end: number
}

// ─── Internal types ──────────────────────────────────────────────────────────

interface _INode extends JsonRangeNode {
  /** Maps object key name to its VALUE range node (preserves insertion order). */
  _objMap?: Map<string, _INode>
  /** Ordered list of item range nodes for arrays. */
  _arrItems?: _INode[]
}

// ─── Recursive-descent parser ────────────────────────────────────────────────

class Parser {
  private pos = 0

  constructor(private readonly src: string) {}

  private peek(): string {
    return this.pos < this.src.length ? this.src[this.pos] : ''
  }

  private advance(): string {
    return this.src[this.pos++]
  }

  private skipWhitespace(): void {
    while (this.pos < this.src.length) {
      const ch = this.src[this.pos]
      if (ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r') {
        this.pos++
      } else {
        break
      }
    }
  }

  // ── Entry point ───────────────────────────────────────────────────────

  parseValue(): _INode | null {
    this.skipWhitespace()
    if (this.pos >= this.src.length) return null

    const ch = this.src[this.pos]
    switch (ch) {
      case '{': return this.parseObject()
      case '[': return this.parseArray()
      case '"': return this.parseString()
      case 't': return this.parseLiteral('true', true)
      case 'f': return this.parseLiteral('false', false)
      case 'n': return this.parseLiteral('null', null)
      default:
        if (ch === '-' || (ch >= '0' && ch <= '9')) return this.parseNumber()
        return null
    }
  }

  // ── Object ─────────────────────────────────────────────────────────────

  private parseObject(): _INode | null {
    const start = this.pos
    this.advance() // skip '{'

    const obj: Record<string, JsonValue> = {}
    const objMap = new Map<string, _INode>()

    this.skipWhitespace()
    if (this.peek() === '}') {
      this.advance()
      return { value: obj, start, end: this.pos, _objMap: objMap }
    }

    while (true) {
      this.skipWhitespace()
      const keyNode = this.parseString()
      if (!keyNode) return null
      const key = keyNode.value as string

      this.skipWhitespace()
      if (this.peek() !== ':') return null
      this.advance() // skip ':'

      this.skipWhitespace()
      const valNode = this.parseValue()
      if (!valNode) return null

      obj[key] = valNode.value
      objMap.set(key, valNode)

      this.skipWhitespace()
      const p = this.peek()
      if (p === '}') {
        this.advance()
        return { value: obj, start, end: this.pos, _objMap: objMap }
      }
      if (p === ',') {
        this.advance()
        continue
      }
      return null
    }
  }

  // ── Array ──────────────────────────────────────────────────────────────

  private parseArray(): _INode | null {
    const start = this.pos
    this.advance() // skip '['

    const arr: JsonValue[] = []
    const items: _INode[] = []

    this.skipWhitespace()
    if (this.peek() === ']') {
      this.advance()
      return { value: arr, start, end: this.pos, _arrItems: items }
    }

    while (true) {
      this.skipWhitespace()
      const itemNode = this.parseValue()
      if (!itemNode) return null

      arr.push(itemNode.value)
      items.push(itemNode)

      this.skipWhitespace()
      const p = this.peek()
      if (p === ']') {
        this.advance()
        return { value: arr, start, end: this.pos, _arrItems: items }
      }
      if (p === ',') {
        this.advance()
        continue
      }
      return null
    }
  }

  // ── String ─────────────────────────────────────────────────────────────

  private parseString(): _INode | null {
    const start = this.pos
    if (this.peek() !== '"') return null
    this.advance() // skip opening '"'

    let result = ''
    while (this.pos < this.src.length) {
      const ch = this.src[this.pos++]
      if (ch === '"') {
        return { value: result, start, end: this.pos }
      }
      if (ch === '\\') {
        if (this.pos >= this.src.length) return null
        const esc = this.src[this.pos++]
        switch (esc) {
          case '"':  result += '"';  break
          case '\\': result += '\\'; break
          case '/':  result += '/';  break
          case 'b':  result += '\b'; break
          case 'f':  result += '\f'; break
          case 'n':  result += '\n'; break
          case 'r':  result += '\r'; break
          case 't':  result += '\t'; break
          case 'u': {
            if (this.pos + 4 > this.src.length) return null
            const hex = this.src.slice(this.pos, this.pos + 4)
            if (!/^[0-9a-fA-F]{4}$/.test(hex)) return null
            this.pos += 4
            result += String.fromCharCode(parseInt(hex, 16))
            break
          }
          default:
            return null // invalid escape
        }
      } else {
        result += ch
      }
    }
    return null // unterminated string
  }

  // ── Number ─────────────────────────────────────────────────────────────

  private parseNumber(): _INode | null {
    const start = this.pos

    // Optional minus
    if (this.peek() === '-') this.pos++

    // Integer part — at least one digit
    if (!this.consumeDigits()) return null

    // Fraction
    if (this.peek() === '.') {
      this.pos++
      if (!this.consumeDigits()) return null
    }

    // Exponent
    const ch = this.peek()
    if (ch === 'e' || ch === 'E') {
      this.pos++
      const sign = this.peek()
      if (sign === '+' || sign === '-') this.pos++
      if (!this.consumeDigits()) return null
    }

    const raw = this.src.slice(start, this.pos)
    const value = Number(raw)
    if (!Number.isFinite(value)) return null

    return { value, start, end: this.pos }
  }

  private consumeDigits(): boolean {
    if (
      this.pos >= this.src.length ||
      this.src[this.pos] < '0' ||
      this.src[this.pos] > '9'
    ) {
      return false
    }
    while (
      this.pos < this.src.length &&
      this.src[this.pos] >= '0' &&
      this.src[this.pos] <= '9'
    ) {
      this.pos++
    }
    return true
  }

  // ── Literals (true / false / null) ─────────────────────────────────────

  private parseLiteral<L extends JsonValue>(word: string, value: L): _INode | null {
    const start = this.pos
    if (!this.src.startsWith(word, this.pos)) return null
    this.pos += word.length
    return { value, start, end: this.pos }
  }

  /** Parse the full input — returns root node or null if trailing garbage. */
  parseComplete(): _INode | null {
    const root = this.parseValue()
    if (!root) return null
    this.skipWhitespace()
    if (this.pos !== this.src.length) return null
    return root
  }
}

// ─── Internal parse helper ───────────────────────────────────────────────────

function _parseInternal(content: string): _INode | null {
  try {
    return new Parser(content).parseComplete()
  } catch {
    // Safety net — parser methods should never throw, but guard anyway
    return null
  }
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Parse JSON while tracking byte ranges of every node.
 * Returns null on invalid JSON; never throws.
 */
export function parseWithRanges(content: string): JsonRangeNode | null {
  return _parseInternal(content)
}

/**
 * Walk a JSON path and return the byte range of the node at that position.
 *
 * - Object key segment → range of that key's VALUE node
 * - Array index segment → range of the item node at that index
 * - Empty path → range of the root node
 *
 * Returns null if the path doesn't resolve or the JSON is invalid.
 */
export function findNodeRange(
  content: string,
  path: JsonPath,
): { start: number; end: number } | null {
  const root = _parseInternal(content)
  if (!root) return null

  if (path.length === 0) {
    return { start: root.start, end: root.end }
  }

  let current: _INode = root
  for (const seg of path) {
    if (current._objMap && typeof seg === 'string') {
      const child = current._objMap.get(seg)
      if (!child) return null
      current = child
    } else if (current._arrItems) {
      const idx =
        typeof seg === 'number'
          ? seg
          : typeof seg === 'string'
            ? parseInt(seg, 10)
            : NaN
      if (!Number.isInteger(idx) || idx < 0 || idx >= current._arrItems.length)
        return null
      current = current._arrItems[idx]
    } else {
      return null
    }
  }

  return { start: current.start, end: current.end }
}

/**
 * Replace a single node in-place by splicing its byte range with the
 * compact serialization of `value`.
 *
 * Returns null if the path doesn't resolve or the JSON is invalid.
 * An empty path returns null (caller should fall back to whole-doc serialization).
 */
export function replaceNode(
  content: string,
  path: JsonPath,
  value: JsonValue,
): string | null {
  if (path.length === 0) return null

  const range = findNodeRange(content, path)
  if (!range) return null

  const serialized = serializeNode(value)
  return content.slice(0, range.start) + serialized + content.slice(range.end)
}

/**
 * Write back an edited value: try byte-stable splice first, fall back to
 * whole-document re-serialization with the provided `newRoot`.
 */
export function writeBack(
  content: string,
  path: JsonPath,
  value: JsonValue,
  newRoot: JsonValue,
): string {
  return replaceNode(content, path, value) ?? serializeJson(newRoot)
}
