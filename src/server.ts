import express from 'express'
import type { Request, Response } from 'express'
import { mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { tmpdir } from 'node:os'
import { randomUUID } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { checkCompatibilityContentBased, checkResourcePack } from './engine.js'
import { fetchVersions } from './api.js'

const __dirname = dirname(fileURLToPath(import.meta.url))

export function createApp() {
  const app = express()
  app.use(express.json({ limit: '100mb' }))

  const webDist = join(__dirname, '..', 'web', 'dist')
  if (existsSync(webDist)) {
    app.use(express.static(webDist))
  }

  app.get('/api/versions', async (_req: Request, res: Response) => {
    try {
      const versions = await fetchVersions()
      res.json(versions)
    } catch (err: any) {
      res.status(500).json({ error: err.message })
    }
  })

  app.post('/api/check', async (req: Request, res: Response) => {
    const { mode = 'auto', versions, all = false, strict = false, files } = req.body
    if (!files || typeof files !== 'object') {
      res.status(400).json({ error: 'Missing or invalid "files" field' })
      return
    }

    const tmpDir = join(tmpdir(), 'dpcheck-' + randomUUID())
    try {
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
        result = await checkResourcePack(tmpDir, versionList, all)
      } else {
        result = await checkCompatibilityContentBased(tmpDir, versionList, all, strict)
      }

      res.json({ result, mode: resolvedMode })
    } catch (err: any) {
      res.status(500).json({ error: err.message || String(err) })
    } finally {
      try { rmSync(tmpDir, { recursive: true, force: true }) } catch { }
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
  app.listen(port, () => {
    console.log(`\n  🌐 dpcheck GUI server running at http://localhost:${port}\n`)
  })
}
