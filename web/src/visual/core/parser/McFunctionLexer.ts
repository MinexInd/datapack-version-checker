import { Token, TokenKind } from "./tokens";

// ---------------------------------------------------------------------------
// A proper tokenizer for Minecraft commands.
// It does NOT split on whitespace blindly: it understands quoted strings,
// backslash escapes, nested braces/brackets/parens (NBT and JSON), relative
// coordinates and ranges. Each token keeps its source position so the AST can
// support diagnostics, highlighting and navigation.
// ---------------------------------------------------------------------------

const OPEN_TO_CLOSE: Record<string, string> = { "{": "}", "[": "]", "(": ")" };
const OPEN_KIND: Record<string, TokenKind> = {
  "{": TokenKind.Brace,
  "[": TokenKind.Bracket,
  "(": TokenKind.Paren,
};

export interface LexError {
  message: string;
  index: number;
}

export function tokenize(line: string): { tokens: Token[]; errors: LexError[] } {
  const tokens: Token[] = [];
  const errors: LexError[] = [];
  let i = 0;
  const n = line.length;

  while (i < n) {
    // Skip whitespace
    while (i < n && /\s/.test(line[i])) i++;
    if (i >= n) break;

    const start = i;
    const c = line[i];

    // Quoted string
    if (c === '"' || c === "'") {
      const quote = c;
      let j = i + 1;
      let closed = false;
      while (j < n) {
        if (line[j] === "\\") {
          j += 2;
          continue;
        }
        if (line[j] === quote) {
          closed = true;
          j++;
          break;
        }
        j++;
      }
      if (!closed) {
        errors.push({ message: `Unterminated string literal starting with ${quote}`, index: i });
      }
      tokens.push({ kind: TokenKind.String, text: line.slice(i, j), start, end: j, line: 1 });
      i = j;
      continue;
    }

    // A token that may contain nested groups.
    // We consume until whitespace at bracket-depth 0.
    let j = i;
    const stack: string[] = [];
    let inQuote: string | null = null;
    while (j < n) {
      const ch = line[j];
      if (inQuote) {
        if (ch === "\\") {
          j += 2;
          continue;
        }
        if (ch === inQuote) inQuote = null;
        j++;
        continue;
      }
      if (ch === '"' || ch === "'") {
        inQuote = ch;
        j++;
        continue;
      }
      if (ch === "{" || ch === "[" || ch === "(") {
        stack.push(ch);
        j++;
        continue;
      }
      if (ch === "}" || ch === "]" || ch === ")") {
        const top = stack[stack.length - 1];
        if (top && OPEN_TO_CLOSE[top] === ch) {
          stack.pop();
          j++;
          continue;
        }
        // Unmatched closing bracket — stop the token here.
        break;
      }
      if (/\s/.test(ch)) {
        if (stack.length === 0) break;
        j++;
        continue;
      }
      j++;
    }

    const raw = line.slice(i, j);
    if (stack.length > 0) {
      errors.push({
        message: `Unbalanced group — missing ${stack.map((o) => OPEN_TO_CLOSE[o]).join("")}`,
        index: i,
      });
    }

    // Classify the token.
    let kind: TokenKind;
    if (raw.startsWith("@")) {
      kind = TokenKind.Selector;
    } else if (OPEN_KIND[raw[0]] !== undefined) {
      kind = OPEN_KIND[raw[0]];
    } else if (raw.startsWith("~") || raw.startsWith("^")) {
      kind = TokenKind.Relative;
    } else if (/^[-+]?(\d+\.?\d*|\.\d+)([df])?$/i.test(raw)) {
      kind = TokenKind.Number;
    } else {
      kind = TokenKind.Word;
    }

    tokens.push({ kind, text: raw, start, end: j, line: 1 });
    i = j;
  }

  return { tokens, errors };
}

/**
 * Tokenize a full function file (multiple lines) and track line numbers.
 * Returns tokens with correct `line` values and per-line lex errors.
 */
export function tokenizeFile(source: string): { tokens: Token[]; errors: LexError[] } {
  const tokens: Token[] = [];
  const errors: LexError[] = [];
  const lines = source.split(/\r?\n/);
  for (let idx = 0; idx < lines.length; idx++) {
    const { tokens: lineTokens, errors: lineErrors } = tokenize(lines[idx]);
    for (const t of lineTokens) tokens.push({ ...t, line: idx + 1 });
    for (const e of lineErrors) errors.push(e);
  }
  return { tokens, errors };
}
