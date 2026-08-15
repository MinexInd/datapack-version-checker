import { test, expect, type Page } from '@playwright/test'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

// The CORS/rewrite bugs only manifest in production (external CDNs), so this
// test targets the deployed GH Pages site by default. Override with
// PLAYWRIGHT_BASE_URL to point at a local preview instead.
const BASE_URL = process.env.PLAYWRIGHT_BASE_URL ?? 'https://minexind.github.io'
const FIXTURE_ZIP = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'sample-pack.zip')

interface NetworkFailure {
  url: string
  status: number
  error: string
}

async function collectFailures(page: Page) {
  const failures: NetworkFailure[] = []
  const consoleErrors: string[] = []
  page.on('requestfailed', (req) => {
    failures.push({ url: req.url(), status: 0, error: req.failure()?.errorText ?? 'unknown' })
  })
  page.on('response', (res) => {
    if (res.status() >= 400) {
      failures.push({ url: res.url(), status: res.status(), error: '' })
    }
  })
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text())
  })
  return { failures, consoleErrors }
}

test('Spyglass bootstraps with zero CORS failures', async ({ page }) => {
  const { failures, consoleErrors } = await collectFailures(page)

  // The IDE lives at /datapack-editor. Load it directly.
  await page.goto(`${BASE_URL}/datapack-editor`, { waitUntil: 'domcontentloaded' })

  // Upload a minimal datapack through the hidden zip input.
  const zipInput = page.locator('input[accept=".zip"]')
  await zipInput.waitFor({ state: 'attached', timeout: 15000 })
  await zipInput.setInputFiles(FIXTURE_ZIP)

  // The pack loads and the explorer shows a non-zero file count.
  await expect(page.locator('.ide-explorer-count').first()).toHaveText(/[1-9]/, { timeout: 15000 })

  // Spyglass init downloads vanilla data on first load — give it room.
  await expect(page.getByText('Spyglass ✓')).toBeVisible({ timeout: 120000 })

  // No CORS/network failures on the critical paths.
  const corsFailures = failures.filter(
    (f) =>
      f.url.includes('spyglassmc.com') ||
      f.url.includes('jsdelivr') ||
      f.url.includes('raw.githubusercontent') ||
      f.url.includes('minexind.github.io'),
  )
  expect(corsFailures).toEqual([])

  // No uncaught console errors mentioning CORS or Spyglass init.
  const fatalConsole = consoleErrors.filter(
    (e) => e.includes('CORS') || e.includes('Spyglass init failed') || e.includes('NetworkError'),
  )
  expect(fatalConsole).toEqual([])
})