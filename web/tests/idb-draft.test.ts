import 'fake-indexeddb/auto'
import { describe, it, expect, beforeEach } from 'vitest'
import {
  createIdbDraftStore,
  clearIdbDraftStore,
  createMemoryDraftStore,
  DRAFT_SCHEMA_VERSION,
  type DraftSnapshot,
} from '../src/ide/idb-draft'

const draft = (over: Partial<DraftSnapshot> = {}): DraftSnapshot => ({
  schemaVersion: DRAFT_SCHEMA_VERSION,
  packName: 'pak',
  contentHash: 'abc123',
  editedFiles: { 'data/a/foo.mcfunction': '# edited' },
  deletedFiles: [],
  openTabs: ['pack.mcmeta'],
  activePath: 'pack.mcmeta',
  selectedVersion: 'Auto',
  sourceVersion: 'Auto',
  panel: 'problems',
  panelHeight: null,
  panelCollapsed: false,
  createdAt: 1,
  updatedAt: 1,
  ...over,
})

beforeEach(async () => { await clearIdbDraftStore('test-drafts') })

describe('idb draft store', () => {
  it('round-trips a draft across fresh instances', async () => {
    const s1 = await createIdbDraftStore('test-drafts')
    await s1.save(draft())
    const s2 = await createIdbDraftStore('test-drafts')
    const got = await s2.load()
    expect(got).not.toBeNull()
    expect(got!.packName).toBe('pak')
    expect(got!.editedFiles['data/a/foo.mcfunction']).toBe('# edited')
    expect(got!.openTabs).toEqual(['pack.mcmeta'])
  })

  it('returns the most recently updated draft', async () => {
    const store = await createIdbDraftStore('test-drafts')
    await store.save(draft({ packName: 'old', contentHash: 'h1', updatedAt: 5 }))
    await store.save(draft({ packName: 'new', contentHash: 'h2', updatedAt: 9 }))
    const got = await store.load()
    expect(got!.packName).toBe('new')
  })

  it('always writes the current schema version, discarding a caller-supplied one', async () => {
    const store = await createIdbDraftStore('test-drafts')
    await store.save(draft({ schemaVersion: 999 }))
    expect((await store.load())!.schemaVersion).toBe(DRAFT_SCHEMA_VERSION)
  })

  it('clears all drafts', async () => {
    const store = await createIdbDraftStore('test-drafts')
    await store.save(draft())
    await store.clear()
    expect(await store.load()).toBeNull()
  })
})

describe('memory draft store', () => {
  it('loads a saved draft', async () => {
    const store = createMemoryDraftStore()
    expect(await store.load()).toBeNull()
    await store.save(draft({ activePath: 'data/a/foo.mcfunction' }))
    expect((await store.load())!.activePath).toBe('data/a/foo.mcfunction')
  })

  it('clears', async () => {
    const store = createMemoryDraftStore(draft())
    await store.clear()
    expect(await store.load()).toBeNull()
  })
})
