import express from 'express'
import type { Request, Response } from 'express'
import { mkdirSync, writeFileSync, rmSync, existsSync, readdirSync, statSync, readFileSync } from 'node:fs'
import { join, dirname, relative } from 'node:path'
import { tmpdir } from 'node:os'
import { randomUUID } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { checkCompatibilityContentBased, checkResourcePack } from './engine.js'
import { fixDatapack, fixResourcePack } from './fixer.js'
import { fetchVersions } from './api.js'
import { getLogger } from './logger.js'
import JSZip from 'jszip'

const __dirname = dirname(fileURLToPath(import.meta.url))

export function createApp() {
  const app = express()
  const log = getLogger().child('http')
  app.use(express.json({ limit: '100mb' }))

  // Request logging middleware
  app.use((req: Request, _res: Response, next: () => void) => {
    log.debug(`${req.method} ${req.path}`)
    next()
  })

  const webDist = join(__dirname, '..', 'web', 'dist')
  if (existsSync(webDist)) {
    app.use(express.static(webDist))
  }

  app.get('/api/versions', async (_req: Request, res: Response) => {
    log.info('GET /api/versions')
    try {
      const versions = await fetchVersions()
      log.info(`Returning ${versions.length} versions`)
      res.json(versions)
    } catch (err: any) {
      log.error('Failed to fetch versions:', err.message)
      res.status(500).json({ error: err.message })
    }
  })

  app.post('/api/check', async (req: Request, res: Response) => {
    const { mode = 'auto', versions, all = false, strict = false, files } = req.body
    const fileCount = files ? Object.keys(files).length : 0
    log.info(`POST /api/check mode=${mode} files=${fileCount} versions=${versions ? versions.join(',') : 'auto'}`)
    if (!files || typeof files !== 'object') {
      res.status(400).json({ error: 'Missing or invalid "files" field' })
      return
    }

    const tmpDir = join(tmpdir(), 'dpcheck-' + randomUUID())
    try {
      log.time('server-check')
      mkdirSync(tmpDir, { recursive: true })
      for (const [rel, content] of Object.entries(files as Record<string, string>)) {
        const full = join(tmpDir, rel)
        mkdirSync(dirname(full), { recursive: true })
        writeFileSync(full, content, 'utf-8')
      }

      if (!existsSync(join(tmpDir, 'pack.mcmeta'))) {
        res.status(400).json({ error: 'No pack.mcmeta found in uploaded files' })
        return
      }

      const hasData = existsSync(join(tmpDir, 'data'))
      const hasAssets = existsSync(join(tmpDir, 'assets'))
      let resolvedMode = mode
      if (mode === 'auto') {
        resolvedMode = hasData && !hasAssets ? 'datapack' : hasAssets && !hasData ? 'resourcepack' : 'datapack'
      }
      const versionList = all ? undefined : versions?.length ? versions : undefined

      let result: any
      if (resolvedMode === 'resourcepack') {
        log.debug('Running resource pack check...')
        result = await checkResourcePack(tmpDir, versionList, all)
      } else {
        log.debug('Running datapack check...')
        result = await checkCompatibilityContentBased(tmpDir, versionList, all, strict)
      }
      log.timeEnd('server-check', `(${result.versions_checked} versions)`)
      log.info(`Result: ${result.compatible.length} compatible, ${result.incompatible.length} incompatible`)

      res.json({ result, mode: resolvedMode })
    } catch (err: any) {
      log.error('Check failed:', err.message || String(err))
      res.status(500).json({ error: err.message || String(err) })
    } finally {
      log.debug(`Cleaning up temp dir: ${tmpDir}`)
      try { rmSync(tmpDir, { recursive: true, force: true }) } catch { }
    }
  })

  app.post('/api/fix', async (req: Request, res: Response) => {
    const { files, targetVersion, sourceVersion } = req.body
    const fileCount = files ? Object.keys(files).length : 0
    log.info(`POST /api/fix target=${targetVersion} files=${fileCount}`)
    if (!files || typeof files !== 'object') {
      res.status(400).json({ error: 'Missing or invalid "files" field' })
      return
    }
    if (!targetVersion) {
      res.status(400).json({ error: 'Missing "targetVersion" field' })
      return
    }

    const tmpDir = join(tmpdir(), 'dpcheck-fix-' + randomUUID())
    const outDir = join(tmpdir(), 'dpcheck-fix-out-' + randomUUID())
    try {
      log.time('server-fix')
      mkdirSync(tmpDir, { recursive: true })
      for (const [rel, content] of Object.entries(files as Record<string, string>)) {
        const full = join(tmpDir, rel)
        mkdirSync(dirname(full), { recursive: true })
        writeFileSync(full, content, 'utf-8')
      }

      if (!existsSync(join(tmpDir, 'pack.mcmeta'))) {
        res.status(400).json({ error: 'No pack.mcmeta found in uploaded files' })
        return
      }
      const isRp = existsSync(join(tmpDir, 'assets')) && !existsSync(join(tmpDir, 'data'))

      const fixResult = isRp
        ? await fixResourcePack({ packDir: tmpDir, outputDir: outDir, targetVersion, sourceVersion })
        : await fixDatapack({ datapackDir: tmpDir, outputDir: outDir, targetVersion, sourceVersion })

      if (fixResult.summary.errors.length > 0 && fixResult.results.length === 0) {
        res.status(400).json({ error: fixResult.summary.errors.join('; ') })
        return
      }

      // Zip the fixed output directory and return it.
      const zip = new JSZip()
      const addFiles = (dir: string, base: string) => {
        for (const entry of readdirSync(dir)) {
          const full = join(dir, entry)
          if (statSync(full).isDirectory()) addFiles(full, join(base, entry))
          else zip.file(relative(outDir, full).replace(/\\/g, '/'), readFileSync(full))
        }
      }
      if (existsSync(outDir)) addFiles(outDir, '')
      const buf = await zip.generateAsync({ type: 'nodebuffer' })
      log.timeEnd('server-fix', `(${fixResult.summary.filesFixed} files fixed, ${fixResult.summary.totalPatches} patches)`)

      res.setHeader('Content-Type', 'application/zip')
      res.setHeader('Content-Disposition', `attachment; filename="${'fixed_' + targetVersion.replace(/[^a-zA-Z0-9._-]/g, '_')}.zip"`)
      res.send(buf)
    } catch (err: any) {
      log.error('Fix failed:', err.message || String(err))
      res.status(500).json({ error: err.message || String(err) })
    } finally {
      log.debug(`Cleaning up temp dirs`)
      try { rmSync(tmpDir, { recursive: true, force: true }) } catch { }
      try { rmSync(outDir, { recursive: true, force: true }) } catch { }
    }
  })

  app.get('/{*path}', (_req: Request, res: Response) => {
    const idx = join(__dirname, '..', 'web', 'dist', 'index.html')
    if (existsSync(idx)) {
      res.sendFile(idx)
    } else {
      res.status(200).json({ status: 'dpcheck server running. Build frontend with: cd web && npm run build' })
    }
  })

  return app
}

export function startServer(port: number = 3001) {
  const app = createApp()
  const log = getLogger()
  app.listen(port, () => {
    log.info(`dpcheck GUI server running at http://localhost:${port}`)
    console.log(`\n  🌐 dpcheck GUI server running at http://localhost:${port}\n`)
  })
}
