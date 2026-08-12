import type { PackFileMap } from '../api'

/**
 * Versioned draft persisted locally so an interrupted session can be restored.
 * Bump DRAFT_SCHEMA_VERSION and add a migration whenever the shape changes;
 * unknown old versions are treated as no-draft rather than corrupted data.
 */
export const DRAFT_SCHEMA_VERSION = 1

export interface DraftSnapshot {
  schemaVersion: number
  packName: string
  /** content hash of the *original* pack — detects source changes between sessions. */
  contentHash: string
  editedFiles: PackFileMap
  deletedFiles: string[]
  openTabs: string[]
  activePath: string | null
  selectedVersion: string
  sourceVersion: string
  panel: string
  panelHeight: number | null
  panelCollapsed: boolean
  createdAt: number
  updatedAt: number
}

export interface DraftStoreLike {
  load(): Promise<DraftSnapshot | null>
  save(draft: DraftSnapshot): Promise<void>
  clear(): Promise<void>
}

const STORE = 'drafts'
const MAX_DRAFTS = 20

// One open connection per dbName, mirroring idb-cache.ts so get/put/clear stay
// consistent and deleteDatabase isn't blocked by a lingering connection.
const connections = new Map<string, IDBDatabase>()

function keyOf(draft: Pick<DraftSnapshot, 'packName' | 'contentHash'>): string {
  return `${draft.packName}::${draft.contentHash}`
}

function openDb(dbName: string): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(dbName, 1)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: 'key' })
      }
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

async function getDb(dbName: string): Promise<IDBDatabase> {
  const existing = connections.get(dbName)
  if (existing) return existing
  const db = await openDb(dbName)
  connections.set(dbName, db)
  return db
}

interface StoredDraft extends Omit<DraftSnapshot, 'contentHash' | 'packName'> {
  key: string
  packName: string
  contentHash: string
}

function getAll(db: IDBDatabase): Promise<StoredDraft[]> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly')
    const req = tx.objectStore(STORE).getAll()
    req.onsuccess = () => resolve((req.result as StoredDraft[]) ?? [])
    req.onerror = () => reject(req.error)
  })
}

function put(db: IDBDatabase, entry: StoredDraft): Promise<void> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite')
    tx.objectStore(STORE).put(entry)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
}

function remove(db: IDBDatabase, key: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite')
    tx.objectStore(STORE).delete(key)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
}

function trimToLimit(db: IDBDatabase, keepKey: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite')
    const store = tx.objectStore(STORE)
    const req = store.getAll()
    req.onsuccess = () => {
      const all = (req.result as StoredDraft[]) ?? []
      const sorted = all.filter(e => e.key !== keepKey).sort((a, b) => b.updatedAt - a.updatedAt)
      for (const evict of sorted.slice(MAX_DRAFTS - 1)) store.delete(evict.key)
    }
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
}

function toStored(draft: DraftSnapshot): StoredDraft {
  const { packName, contentHash, ...rest } = draft
  return { key: keyOf(draft), packName, contentHash, ...rest }
}

function toSnapshot(entry: StoredDraft): DraftSnapshot {
  const { key: _key, ...rest } = entry
  return rest
}

export async function createIdbDraftStore(dbName: string): Promise<DraftStoreLike> {
  await getDb(dbName)
  return {
    async load() {
      const db = await getDb(dbName)
      const all = await getAll(db)
      if (all.length === 0) return null
      // Newest draft wins. Only accept ones whose schema we understand; a
      // version bump means we can no longer trust the shape, so treat as absent.
      const latest = all.sort((a, b) => b.updatedAt - a.updatedAt)[0]
      if (latest.schemaVersion !== DRAFT_SCHEMA_VERSION) return null
      return toSnapshot(latest)
    },

    async save(draft) {
      const db = await getDb(dbName)
      await put(db, toStored({ ...draft, schemaVersion: DRAFT_SCHEMA_VERSION }))
      await trimToLimit(db, keyOf(draft))
    },

    async clear() {
      const db = await getDb(dbName)
      const all = await getAll(db)
      for (const e of all) await remove(db, e.key)
    },
  }
}

export async function clearIdbDraftStore(dbName: string): Promise<void> {
  const conn = connections.get(dbName)
  if (conn) {
    conn.close()
    connections.delete(dbName)
  }
  await new Promise<void>((resolve, reject) => {
    const req = indexedDB.deleteDatabase(dbName)
    req.onsuccess = () => resolve()
    req.onerror = () => reject(req.error)
    req.onblocked = () => resolve()
  })
}

export const DRAFT_DB = 'minexstudio-drafts'

/** In-memory store for tests and non-IndexedDB environments. */
export function createMemoryDraftStore(seed: DraftSnapshot | null = null): DraftStoreLike {
  let current: DraftSnapshot | null = seed
  return {
    async load() {
      if (current && current.schemaVersion !== DRAFT_SCHEMA_VERSION) return null
      return current
    },
    async save(draft) {
      current = { ...draft, schemaVersion: DRAFT_SCHEMA_VERSION, updatedAt: Date.now() }
    },
    async clear() {
      current = null
    },
  }
}
