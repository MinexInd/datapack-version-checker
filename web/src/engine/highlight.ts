/** JSON highlighter for the fix preview.
 *
 * mcfunction rules misread JSON badly: every quoted key becomes a string, `:`
 * turns into a resource-location token, and `{`/`[` swallow whole objects as
 * NBT. This tokenises JSON on its own terms so keys, values, and punctuation
 * stay distinguishable. */
export function highlightJson(code: string): string {
  const escaped = code
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')

  // A quoted run followed by a colon is a key; otherwise it is a string value.
  return escaped.replace(
    /("(?:[^"\\]|\\.)*")(\s*:)?|\b(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)\b|\b(true|false|null)\b/g,
    (match, str, colon, num, lit) => {
      if (str !== undefined) {
        return colon
          ? `<span class="hl-key">${str}</span>${colon}`
          : `<span class="hl-string">${str}</span>`
      }
      if (num !== undefined) return `<span class="hl-number">${num}</span>`
      if (lit !== undefined) return `<span class="hl-bool">${lit}</span>`
      return match
    },
  )
}

export function highlightMcfunction(code: string): string {
  const escaped = code
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
  const lines = escaped.split('\n')
  return lines.map(line => highlightLine(line)).join('\n')
}

function highlightLine(line: string): string {
  const marker = line.startsWith('> ') ? '>' : ' '
  const rest = marker === '>' ? line.slice(2) : line.slice(marker === ' ' && /^\s/.test(line) ? 0 : 0)
  const trimmed = rest.replace(/^\s{0,3}\d{0,3} \| /, '')
  const prefix = marker === '>'
    ? `<span class="hl-marker">${line[0]}</span> ` + rest.slice(0, rest.length - trimmed.length)
    : rest.slice(0, rest.length - trimmed.length)
  return prefix + highlightTokens(trimmed)
}

function highlightTokens(line: string): string {
  let result = ''
  let i = 0
  const len = line.length

  while (i < len) {
    if (line[i] === '#') {
      result += `<span class="hl-comment">${line.slice(i)}</span>`
      break
    }

    if (line[i] === '"') {
      const end = line.indexOf('"', i + 1)
      if (end === -1) {
        result += `<span class="hl-string">${line.slice(i)}</span>`
        break
      }
      result += `<span class="hl-string">${line.slice(i, end + 1)}</span>`
      i = end + 1
      continue
    }

    if (line[i] === '{' || line[i] === '[') {
      const brace = line[i]
      const close = brace === '{' ? '}' : ']'
      let depth = 0
      let j = i
      for (; j < len; j++) {
        if (line[j] === brace) depth++
        else if (line[j] === close) {
          depth--
          if (depth === 0) { j++; break }
        }
        if (line[j] === '"') {
          const skip = line.indexOf('"', j + 1)
          if (skip !== -1) j = skip
        }
      }
      result += `<span class="hl-nbt">${line.slice(i, j)}</span>`
      i = j
      continue
    }

    if (line[i] === '@' && i + 1 < len) {
      let j = i + 1
      while (j < len && /[a-zA-Z]/.test(line[j])) j++
      if (j < len && line[j] === '[') {
        let depth = 0
        for (; j < len; j++) {
          if (line[j] === '[') depth++
          else if (line[j] === ']') {
            depth--
            if (depth === 0) { j++; break }
          }
          if (line[j] === '"') {
            const skip = line.indexOf('"', j + 1)
            if (skip !== -1) j = skip
          }
        }
      }
      result += `<span class="hl-selector">${line.slice(i, j)}</span>`
      i = j
      continue
    }

    if ((line[i] === '~' || line[i] === '^') && (i === 0 || line[i - 1] === ' ' || line[i - 1] === '\t')) {
      let j = i + 1
      while (j < len && /[-\d.]/.test(line[j])) j++
      result += `<span class="hl-coord">${line.slice(i, j)}</span>`
      i = j
      continue
    }

    if (i > 0 && line[i] === ':' && /[a-z0-9_.-]/.test(line[i - 1] || '')) {
      let j = i + 1
      while (j < len && /[a-zA-Z0-9_./-]/.test(line[j])) j++
      result += `<span class="hl-rlid">${line.slice(i, j)}</span>`
      i = j
      continue
    }

    const wordMatch = line.slice(i).match(/^[a-zA-Z_/][a-zA-Z0-9_]*/)
    if (wordMatch) {
      const word = wordMatch[0]
      const wordLen = word.length
      if (i === 0 || (line[i - 1] === ' ' || line[i - 1] === '\t')) {
        if (word === 'true' || word === 'false') {
          result += `<span class="hl-bool">${word}</span>`
          i += wordLen
          continue
        }
        if (!/[a-zA-Z]/.test(line[i])) {
          result += word
          i += wordLen
          continue
        }
        result += `<span class="hl-cmd">${word}</span>`
        i += wordLen
        continue
      }
      result += word
      i += wordLen
      continue
    }

    const numMatch = line.slice(i).match(/^-?\d+(\.\d+)?[df]?/)
    if (numMatch && numMatch.index === 0 && (i === 0 || /[ \t,=(\[\]]/.test(line[i - 1]))) {
      const num = numMatch[0]
      const end = /[df]$/.test(num) ? num : num
      result += `<span class="hl-number">${end}</span>`
      i += num.length
      continue
    }

    result += line[i]
    i++
  }

  return result
}
