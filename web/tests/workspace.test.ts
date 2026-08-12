import { describe, it, expect } from 'vitest'
import {
  buildWorkspaceFiles,
  createWorkspaceSnapshot,
  computeContentHash,
  isResultStale,
  nextRevision,
  type WorkspaceState,
} from '../src/workspace'

const state = (over: Partial<WorkspaceState> = {}): WorkspaceState => ({
  originalFiles: { 'pack.mcmeta': '{pack}', 'data/a/foo.mcfunction': '# a' },
  editedFiles: {},
  deletedFiles: new Set(),
  ...over,
})

describe('buildWorkspaceFiles', () => {
  it('returns null with no original pack', () => {
    expect(buildWorkspaceFiles({ originalFiles: null, editedFiles: {}, deletedFiles: new Set() })).toBeNull()
  })

  it('overlays edits onto originals', () => {
    const files = buildWorkspaceFiles(state({ editedFiles: { 'data/a/foo.mcfunction': '# edited' } }))!
    expect(files['data/a/foo.mcfunction']).toBe('# edited')
    expect(files['pack.mcmeta']).toBe('{pack}')
  })

  it('removes deleted files from the merged map', () => {
    const files = buildWorkspaceFiles(state({ deletedFiles: new Set(['data/a/foo.mcfunction']) }))!
    expect('data/a/foo.mcfunction' in files).toBe(false)
  })

  it('is the single derivation: edit + delete interplay', () => {
    const files = buildWorkspaceFiles(state({
      editedFiles: { 'data/a/foo.mcfunction': '# edited', 'data/b/new.mcfunction': '# new' },
      deletedFiles: new Set(['data/a/foo.mcfunction']),
    }))!
    expect('data/a/foo.mcfunction' in files).toBe(false)
    expect(files['data/b/new.mcfunction']).toBe('# new')
  })
})

describe('createWorkspaceSnapshot', () => {
  it('builds a revisioned snapshot', () => {
    const snap = createWorkspaceSnapshot(
      state({ editedFiles: { 'data/a/foo.mcfunction': '# edited' } }),
      { packName: 'p', mode: 'datapack', sourceVersion: 'Auto' },
      7,
    )!
    expect(snap.revision).toBe(7)
    expect(snap.packName).toBe('p')
    expect(snap.sourceVersion).toBe('Auto')
    expect(snap.files['data/a/foo.mcfunction']).toBe('# edited')
  })

  it('returns null without an original pack', () => {
    expect(createWorkspaceSnapshot(
      { originalFiles: null, editedFiles: {}, deletedFiles: new Set() },
      { packName: 'p', mode: 'auto', sourceVersion: 'Auto' }, 0,
    )).toBeNull()
  })
})

describe('isResultStale / revisions', () => {
  it('flags results whose revision moved', () => {
    expect(isResultStale(5, 5)).toBe(false)
    expect(isResultStale(6, 5)).toBe(true)
  })

  it('bumps revisions monotonically', () => {
    expect(nextRevision(3)).toBe(4)
  })
})

describe('computeContentHash', () => {
  it('is key-order independent', () => {
    const a = computeContentHash({ b: '2', a: '1' })
    const b = computeContentHash({ a: '1', b: '2' })
    expect(a).toBe(b)
  })

  it('changes when content changes', () => {
    expect(computeContentHash({ a: '1' })).not.toBe(computeContentHash({ a: '2' }))
  })

  it('changes when a file is added or removed', () => {
    const base = computeContentHash({ a: '1' })
    expect(computeContentHash({ a: '1', c: 'x' })).not.toBe(base)
  })
})
