import { existsSync, mkdirSync, readFileSync, writeFileSync, rmSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { getLogger } from './logger.js'

const CACHE_DIR = join(tmpdir(), 'dpcheck-cache')
const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000 // 24h

const log = getLogger().child('cache')

function safeKey(key: string): string {
  return key.replace(/[^a-zA-Z0-9._-]/g, '_')
}

export function clearCache(): void {
  log.info('Clearing cache')
  if (existsSync(CACHE_DIR)) rmSync(CACHE_DIR, { recursive: true, force: true })
}

export function getCache<T>(key: string, ttlMs: number = DEFAULT_TTL_MS): T | null {
  const file = join(CACHE_DIR, safeKey(key) + '.json')
  try {
    if (!existsSync(file)) {
      log.debug(`Cache get MISS ${key} (not found)`)
      return null
    }
    const mtime = statSync(file).mtimeMs
    if (Date.now() - mtime > ttlMs) {
      log.debug(`Cache get MISS ${key} (expired, age=${Math.round((Date.now()-mtime)/1000)}s)`)
      return null
    }
    log.debug(`Cache get HIT ${key}`)
    return JSON.parse(readFileSync(file, 'utf-8')) as T
  } catch (e) {
    log.debug(`Cache get ERROR ${key}:`, e)
    return null
  }
}

export function setCache<T>(key: string, value: T): void {
  try {
    if (!existsSync(CACHE_DIR)) mkdirSync(CACHE_DIR, { recursive: true })
    writeFileSync(join(CACHE_DIR, safeKey(key) + '.json'), JSON.stringify(value), 'utf-8')
    log.debug(`Cache set ${key}`)
  } catch (e) {
    log.debug(`Cache set ERROR ${key}:`, e)
    // Caching is best-effort; never break the tool if it fails.
  }
}
