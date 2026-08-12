import type { Mode, PackFileMap } from './api'

/**
 * The immutable-at-call-time unit every async operation runs against. Callers
 * capture one snapshot, run against it, and compare `revision` afterwards so
 * results that no longer match the live workspace are marked stale instead of
 * overwriting newer edits.
 */
export interface WorkspaceSnapshot {
  files: PackFileMap
  packName: string
  mode: Mode
  /** 'Auto' or an explicit game version name. */
  sourceVersion: string
  revision: number
}

/** The separable pieces of workspace state kept across the app. */
export interface WorkspaceState {
  originalFiles: PackFileMap | null
  editedFiles: PackFileMap
  deletedFiles: ReadonlySet<string>
}

/**
 * Single source of truth for the workspace file map: original files, overlaid
 * with edits, minus deletions. Every consumer (check, fix, analyze, export)
 * must use this so none of them silently sees a different set of files.
 */
export function buildWorkspaceFiles(state: WorkspaceState): PackFileMap | null {
  if (!state.originalFiles) return null
  const merged: PackFileMap = { ...state.originalFiles, ...state.editedFiles }
  for (const del of state.deletedFiles) delete merged[del]
  return merged
}

export function createWorkspaceSnapshot(
  state: WorkspaceState,
  meta: { packName: string; mode: Mode; sourceVersion: string },
  revision: number,
): WorkspaceSnapshot | null {
  const files = buildWorkspaceFiles(state)
  if (!files) return null
  return { files, packName: meta.packName, mode: meta.mode, sourceVersion: meta.sourceVersion, revision }
}

/** A stale result must be visibly marked and must not overwrite newer edits. */
export function isResultStale(currentRevision: number, resultRevision: number): boolean {
  return currentRevision !== resultRevision
}

/**
 * Deterministic content hash over the file map (stable key ordering). Used to
 * key drafts and to detect whether the underlying source pack changed between
 * sessions, which decides whether a stored draft can be restored safely.
 */
export function computeContentHash(files: PackFileMap): string {
  let hash = 0x811c9dc5
  for (const key of Object.keys(files).sort()) {
    hash = fnv1a(hash, key)
    hash = fnv1a(hash, '\u0000')
    hash = fnv1a(hash, files[key])
    hash = fnv1a(hash, '\u0001')
  }
  return (hash >>> 0).toString(36).padStart(8, '0')
}

function fnv1a(hash: number, input: string): number {
  let h = hash >>> 0
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return h >>> 0
}

/** Monotonic revision to stamp snapshots and results. */
export function nextRevision(current: number): number {
  return current + 1
}
