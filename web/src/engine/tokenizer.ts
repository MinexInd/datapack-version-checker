export interface Token {
  value: string
  start: number
  end: number
}

export function tokenizeCommand(line: string): Token[] {
  const tokens: Token[] = []
  let i = 0
  const n = line.length

  while (i < n) {
    const ch = line[i]
    if (ch === ' ' || ch === '\t') {
      i++
      continue
    }

    const start = i

    if (ch === '"' || ch === "'") {
      const quote = ch
      i++
      while (i < n) {
        if (line[i] === '\\' && i + 1 < n) {
          i += 2
          continue
        }
        if (line[i] === quote) {
          i++
          break
        }
        i++
      }
      tokens.push({ value: line.slice(start, i), start, end: i })
      continue
    }

    if (ch === '{' || ch === '[') {
      const open = ch
      const close = ch === '{' ? '}' : ']'
      let depth = 0
      let inQuote = false
      let quoteChar = ''
      while (i < n) {
        const c = line[i]
        if (inQuote) {
          if (c === '\\' && i + 1 < n) {
            i += 2
            continue
          }
          if (c === quoteChar) inQuote = false
          i++
          continue
        }
        if (c === '"' || c === "'") {
          inQuote = true
          quoteChar = c
          i++
          continue
        }
        if (c === open) depth++
        else if (c === close) {
          depth--
          if (depth === 0) {
            i++
            break
          }
        }
        i++
      }
      tokens.push({ value: line.slice(start, i), start, end: i })
      continue
    }

    let value = ''
    while (i < n) {
      const c = line[i]
      if (c === ' ' || c === '\t') break
      if ((c === '{' || c === '[') && value.length === 0) break
      value += c
      i++
    }
    tokens.push({ value, start, end: i })
  }

  return tokens
}

export function stripQuotes(value: string): string {
  if ((value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))) {
    return value.slice(1, -1)
  }
  return value
}
