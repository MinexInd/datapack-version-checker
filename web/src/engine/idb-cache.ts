export interface CacheLike {
  get(url: string): Promise<Response | null>
  put(url: string, response: Response): Promise<void>
}

interface StoredResponse {
  body: ArrayBuffer
  status: number
  statusText: string
  headers: Record<string, string>
}

const STORE = 'entries'

// One open connection per dbName, shared by all cache instances. clearIdbCache
// closes it so deleteDatabase isn't blocked; get/put lazily reopen afterwards.
const connections = new Map<string, IDBDatabase>()

function openDb(dbName: string): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(dbName, 1)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: 'url' })
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

function getEntry(db: IDBDatabase, url: string): Promise<StoredResponse | null> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly')
    const req = tx.objectStore(STORE).get(url)
    req.onsuccess = () => resolve((req.result as StoredResponse | undefined) ?? null)
    req.onerror = () => reject(req.error)
  })
}

function putEntry(db: IDBDatabase, url: string, entry: StoredResponse): Promise<void> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite')
    tx.objectStore(STORE).put({ url, ...entry })
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
}

export async function createIdbCache(dbName: string): Promise<CacheLike> {
  return {
    async get(url) {
      const db = await getDb(dbName)
      const stored = await getEntry(db, url)
      if (!stored) return null
      return new Response(stored.body, {
        status: stored.status,
        statusText: stored.statusText,
        headers: stored.headers,
      })
    },
    async put(url, response) {
      const db = await getDb(dbName)
      const body = await response.clone().arrayBuffer()
      const headers: Record<string, string> = {}
      response.headers.forEach((v, k) => { headers[k] = v })
      await putEntry(db, url, { body, status: response.status, statusText: response.statusText, headers })
    },
  }
}

export async function clearIdbCache(dbName: string): Promise<void> {
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

/** Shared DB name for the mcje API cache used by web/src/engine/api.ts. */
export const API_CACHE_DB = 'mcje-api-cache'