// Token model for the mcfunction lexer.

export enum TokenKind {
  /** A bare word, resource location, or command name: e.g. `execute`, `minecraft:flame`. */
  Word = "Word",
  /** A numeric literal: `5`, `-3`, `1.5`, `0.5d`. */
  Number = "Number",
  /** A quoted string including delimiters: `"hello world"`. */
  String = "String",
  /** A relative/world coordinate token: `~`, `~1`, `^0.5`. */
  Relative = "Relative",
  /** An entity selector head: `@a`, `@p`, `@s`. */
  Selector = "Selector",
  /** A balanced braced group `{...}` (NBT compound / JSON object). */
  Brace = "Brace",
  /** A balanced bracketed group `[...]` (NBT array / JSON array / selector args). */
  Bracket = "Bracket",
  /** A balanced parenthesised group `(...)`. */
  Paren = "Paren",
  /** Any other punctuation, e.g. `..` (range), `/`. */
  Punct = "Punct",
}

export interface Token {
  kind: TokenKind;
  /** Raw source text, including delimiters for groups/strings. */
  text: string;
  /** 0-based start offset in the source line. */
  start: number;
  /** 1-based end offset in the source line (exclusive). */
  end: number;
  /** 1-based line number (for cross-line groups this is the line of the start). */
  line: number;
}

/** Number token numeric value (strips trailing type suffix like `d`, `f`). */
export function numberValue(t: Token): number {
  const raw = t.text.replace(/[df]$/i, "");
  return Number(raw);
}

/** True if the token text looks like a relative coordinate. */
export function isRelative(text: string): boolean {
  return text.startsWith("~") || text.startsWith("^");
}
