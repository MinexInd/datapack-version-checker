/**
 * Pure helpers for file-create / rename / delete safety in the web IDE.
 */

/**
 * Validate a single file-name basename (not a full path).
 *
 * Rejects:
 * - empty
 * - path separators `/` or `\`
 * - `..` segments or absolute-path markers
 * - control characters
 * - leading or trailing whitespace
 * - names ending in `/`
 *
 * Returns a human-readable error string, or `null` when the name is usable.
 */
export function validateFileName(name: string): string | null {
  const trimmed = name.trim()
  if (!trimmed) return 'File name must not be empty'
  if (trimmed !== name) return 'File name must not start or end with whitespace'
  if (trimmed.endsWith('/')) return 'File name must not end with "/"'
  if (trimmed.includes('/') || trimmed.includes('\\')) return 'File name must not contain path separators'
  if (trimmed.includes('..')) return 'File name must not contain ".."'
  for (let i = 0; i < trimmed.length; i++) {
    const c = trimmed.charCodeAt(i)
    if (c < 0x20 || c === 0x7f) return 'File name must not contain control characters'
  }
  return null
}

/**
 * True when the supplied path looks like a traversal or absolute reference.
 */
export function isPathTraversal(path: string): boolean {
  if (path.startsWith('/') || path.startsWith('\\')) return true
  const parts = path.split('/').filter(Boolean)
  return parts.some(p => p === '..')
}

/**
 * Cheap reference scan: given a file path, derive likely resource-location
 * ids and search every file's text for mentions.
 *
 * For `data/<ns>/functions/<name>.mcfunction` we search:
 *   - `<ns>:<name>`
 *   - `<ns>:functions/<name>`
 *   - `#<ns>:<name>`
 *   - `<rhs><ns>:<name></rhs>` (raw XML-ish tag form seen in some datapacks)
 *
 * Returns line-matched snippets. Order is filesystem traversal order.
 */
export function findReferencesTo(
  path: string,
  files: Record<string, string>,
): { file: string; line: number; snippet: string }[] {
  const results: { file: string; line: number; snippet: string }[] = []
  const lower = path.toLowerCase()

  // Only derive ids from data/... paths; everything else gets no matches.
  if (!lower.startsWith('data/')) return results

  const parts = lower.split('/')
  // data/<ns>/<type>/<name>.<ext>
  if (parts.length < 4) return results

  const ns = parts[1]
  const type = parts[2]
  const nameWithExt = parts.slice(3).join('/')
  const dot = nameWithExt.lastIndexOf('.')
  const name = dot >= 0 ? nameWithExt.slice(0, dot) : nameWithExt

  const ids = new Set<string>([
    `${ns}:${name}`,
    `${ns}:${type}/${name}`,
    `#${ns}:${name}`,
    `#${ns}:${type}/${name}`,
    `<rhs>${ns}:${name}</rhs>`,
    `<rhs>${ns}:${type}/${name}</rhs>`,
  ])

  for (const [file, content] of Object.entries(files)) {
    if (file === path) continue
    const lines = content.split('\n')
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]
      for (const id of ids) {
        if (line.includes(id)) {
          results.push({ file, line: i + 1, snippet: line.trim() })
          break
        }
      }
    }
  }

  return results
}
