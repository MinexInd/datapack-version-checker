/** Line-level diff for the fix preview.
 *
 * The previous renderer compared source line i against output line i. That is
 * only correct when a port rewrites lines in place — the moment a fix inserts
 * or removes one, every following line reports as changed. JSON fixes do that
 * constantly (adding a field, unwrapping an object), which is why JSON diffs
 * were unreadable and got rendered as two whole-file columns instead.
 *
 * This does a real LCS diff. Common prefix and suffix are trimmed first, so the
 * expensive part only runs over the region that actually differs — on real pack
 * files that is usually a few lines out of a few hundred.
 */

export type DiffRowKind = 'context' | 'added' | 'removed' | 'gap'

export interface DiffRow {
  kind: DiffRowKind
  text: string
  /** 1-based line number in the original file. */
  srcLine?: number
  /** 1-based line number in the ported file. */
  outLine?: number
  /** For gap rows: how many unchanged lines were collapsed. */
  hidden?: number
}

export interface DiffResult {
  rows: DiffRow[]
  added: number
  removed: number
  /** True when the changed region was too large for an exact diff. */
  approximate: boolean
}

type Op =
  | { op: '='; ai: number; bi: number; text: string }
  | { op: '-'; ai: number; text: string }
  | { op: '+'; bi: number; text: string }

/** Above this the DP table costs more memory than the result is worth. */
const MAX_CELLS = 4_000_000

function lcsOps(a: string[], b: string[]): Op[] {
  const n = a.length
  const m = b.length
  if (n === 0) return b.map((text, bi) => ({ op: '+', bi, text }))
  if (m === 0) return a.map((text, ai) => ({ op: '-', ai, text }))

  const w = m + 1
  const dp = new Uint32Array((n + 1) * w)
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i * w + j] = a[i] === b[j]
        ? dp[(i + 1) * w + (j + 1)] + 1
        : Math.max(dp[(i + 1) * w + j], dp[i * w + (j + 1)])
    }
  }

  const ops: Op[] = []
  let i = 0
  let j = 0
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      ops.push({ op: '=', ai: i, bi: j, text: a[i] })
      i++
      j++
    } else if (dp[(i + 1) * w + j] >= dp[i * w + (j + 1)]) {
      ops.push({ op: '-', ai: i, text: a[i] })
      i++
    } else {
      ops.push({ op: '+', bi: j, text: b[j] })
      j++
    }
  }
  while (i < n) { ops.push({ op: '-', ai: i, text: a[i] }); i++ }
  while (j < m) { ops.push({ op: '+', bi: j, text: b[j] }); j++ }
  return ops
}

/** Positional fallback for changed regions too large to diff exactly. */
function positionalOps(a: string[], b: string[]): Op[] {
  const ops: Op[] = []
  const len = Math.max(a.length, b.length)
  for (let k = 0; k < len; k++) {
    const s = a[k]
    const o = b[k]
    if (s !== undefined && o !== undefined && s === o) {
      ops.push({ op: '=', ai: k, bi: k, text: s })
      continue
    }
    if (s !== undefined) ops.push({ op: '-', ai: k, text: s })
    if (o !== undefined) ops.push({ op: '+', bi: k, text: o })
  }
  return ops
}

export function diffLines(src: string[], out: string[], context = 3): DiffResult {
  // Trim the identical head.
  let start = 0
  const maxStart = Math.min(src.length, out.length)
  while (start < maxStart && src[start] === out[start]) start++

  // Trim the identical tail.
  let endSrc = src.length
  let endOut = out.length
  while (endSrc > start && endOut > start && src[endSrc - 1] === out[endOut - 1]) {
    endSrc--
    endOut--
  }

  const midSrc = src.slice(start, endSrc)
  const midOut = out.slice(start, endOut)

  const approximate = midSrc.length * midOut.length > MAX_CELLS
  const ops = approximate ? positionalOps(midSrc, midOut) : lcsOps(midSrc, midOut)

  const rows: DiffRow[] = []
  let added = 0
  let removed = 0

  for (let k = 0; k < start; k++) {
    rows.push({ kind: 'context', text: src[k], srcLine: k + 1, outLine: k + 1 })
  }

  for (const op of ops) {
    if (op.op === '=') {
      rows.push({
        kind: 'context',
        text: op.text,
        srcLine: start + op.ai + 1,
        outLine: start + op.bi + 1,
      })
    } else if (op.op === '-') {
      removed++
      rows.push({ kind: 'removed', text: op.text, srcLine: start + op.ai + 1 })
    } else {
      added++
      rows.push({ kind: 'added', text: op.text, outLine: start + op.bi + 1 })
    }
  }

  const tailSrcStart = endSrc
  const tailOutStart = endOut
  for (let k = 0; k < src.length - tailSrcStart; k++) {
    rows.push({
      kind: 'context',
      text: src[tailSrcStart + k],
      srcLine: tailSrcStart + k + 1,
      outLine: tailOutStart + k + 1,
    })
  }

  return { rows: collapseContext(rows, context), added, removed, approximate }
}

/** Keep `context` unchanged lines around each change; collapse the rest. */
function collapseContext(rows: DiffRow[], context: number): DiffRow[] {
  const keep = new Array<boolean>(rows.length).fill(false)
  for (let i = 0; i < rows.length; i++) {
    if (rows[i].kind === 'added' || rows[i].kind === 'removed') {
      for (let j = Math.max(0, i - context); j <= Math.min(rows.length - 1, i + context); j++) {
        keep[j] = true
      }
    }
  }

  const out: DiffRow[] = []
  let run = 0
  for (let i = 0; i < rows.length; i++) {
    if (keep[i]) {
      if (run > 0) {
        out.push({ kind: 'gap', text: '', hidden: run })
        run = 0
      }
      out.push(rows[i])
    } else {
      run++
    }
  }
  if (run > 0) out.push({ kind: 'gap', text: '', hidden: run })
  return out
}
