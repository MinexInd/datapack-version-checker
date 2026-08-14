/**
 * Line diff utility for the Fix Preview per-file diff view.
 */

export type LineDiffKind = 'added' | 'removed' | 'context' | 'gap'

export interface LineDiffRow {
  kind: LineDiffKind
  text: string
  srcLine?: number
  outLine?: number
  hidden?: number
}

export interface LineDiffResult {
  rows: LineDiffRow[]
  additions: number
  deletions: number
}

/**
 * Computes an LCS line diff between two text strings.
 */
export function computeLineDiff(before: string, after: string, context = 3): LineDiffResult {
  if (before === after) {
    return { rows: [], additions: 0, deletions: 0 }
  }

  const src = before.split('\n')
  const out = after.split('\n')

  // Fast prefix trim
  let start = 0
  const maxStart = Math.min(src.length, out.length)
  while (start < maxStart && src[start] === out[start]) {
    start++
  }

  // Fast suffix trim
  let endSrc = src.length - 1
  let endOut = out.length - 1
  while (endSrc >= start && endOut >= start && src[endSrc] === out[endOut]) {
    endSrc--
    endOut--
  }

  const midSrc = src.slice(start, endSrc + 1)
  const midOut = out.slice(start, endOut + 1)

  type Op =
    | { op: '='; ai: number; bi: number; text: string }
    | { op: '-'; ai: number; text: string }
    | { op: '+'; bi: number; text: string }

  const ops: Op[] = []

  // Context before
  const ctxStart = Math.max(0, start - context)
  if (start > 0) {
    if (ctxStart > 0) {
      ops.push({ op: '=', ai: -1, bi: -1, text: `--- ${ctxStart} unchanged lines ---` })
    }
    for (let i = ctxStart; i < start; i++) {
      ops.push({ op: '=', ai: i, bi: i, text: src[i] })
    }
  }

  // DP for middle
  const n = midSrc.length
  const m = midOut.length

  if (n * m > 2_000_000) {
    // Positional fallback for huge diffs
    const maxLen = Math.max(n, m)
    for (let k = 0; k < maxLen; k++) {
      if (k < n && k < m && midSrc[k] === midOut[k]) {
        ops.push({ op: '=', ai: start + k, bi: start + k, text: midSrc[k] })
      } else {
        if (k < n) ops.push({ op: '-', ai: start + k, text: midSrc[k] })
        if (k < m) ops.push({ op: '+', bi: start + k, text: midOut[k] })
      }
    }
  } else {
    const w = m + 1
    const dp = new Uint32Array((n + 1) * w)
    for (let i = n - 1; i >= 0; i--) {
      for (let j = m - 1; j >= 0; j--) {
        dp[i * w + j] = midSrc[i] === midOut[j]
          ? dp[(i + 1) * w + (j + 1)] + 1
          : Math.max(dp[(i + 1) * w + j], dp[i * w + (j + 1)])
      }
    }

    let i = 0
    let j = 0
    while (i < n && j < m) {
      if (midSrc[i] === midOut[j]) {
        ops.push({ op: '=', ai: start + i, bi: start + j, text: midSrc[i] })
        i++
        j++
      } else if (dp[(i + 1) * w + j] >= dp[i * w + (j + 1)]) {
        ops.push({ op: '-', ai: start + i, text: midSrc[i] })
        i++
      } else {
        ops.push({ op: '+', bi: start + j, text: midOut[j] })
        j++
      }
    }
    while (i < n) {
      ops.push({ op: '-', ai: start + i, text: midSrc[i] })
      i++
    }
    while (j < m) {
      ops.push({ op: '+', bi: start + j, text: midOut[j] })
      j++
    }
  }

  // Context after
  const ctxEnd = Math.min(src.length, endSrc + 1 + context)
  for (let i = endSrc + 1; i < ctxEnd; i++) {
    const outIdx = endOut + 1 + (i - (endSrc + 1))
    ops.push({ op: '=', ai: i, bi: outIdx, text: src[i] })
  }
  if (ctxEnd < src.length) {
    const remaining = src.length - ctxEnd
    ops.push({ op: '=', ai: -1, bi: -1, text: `--- ${remaining} unchanged lines ---` })
  }

  let additions = 0
  let deletions = 0
  const rows: LineDiffRow[] = []

  for (const op of ops) {
    if (op.op === '+') {
      additions++
      rows.push({ kind: 'added', text: op.text, outLine: op.bi + 1 })
    } else if (op.op === '-') {
      deletions++
      rows.push({ kind: 'removed', text: op.text, srcLine: op.ai + 1 })
    } else {
      if (op.ai === -1) {
        rows.push({ kind: 'gap', text: op.text })
      } else {
        rows.push({ kind: 'context', text: op.text, srcLine: op.ai + 1, outLine: op.bi + 1 })
      }
    }
  }

  return { rows, additions, deletions }
}
