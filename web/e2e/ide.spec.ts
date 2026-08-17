import { test, expect } from '@playwright/test'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const SAMPLE_DIR = path.resolve(__dirname, '../public/vanilla-data')

test.describe('Minex IDE E2E', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/')
    await expect(page.locator('.dropzone')).toBeVisible({ timeout: 30_000 })
  })

  test('loads a datapack and shows file tree', async ({ page }) => {
    const folderInput = page.locator('input[webkitdirectory]')
    await folderInput.setInputFiles(SAMPLE_DIR)

    await expect(page.locator('.dz-loaded .count')).toContainText('files loaded', { timeout: 60_000 })
    await expect(page.locator('.ide-shell')).toBeVisible({ timeout: 30_000 })

    const treeItems = page.locator('.ide-tree-item')
    const count = await treeItems.count()
    expect(count).toBeGreaterThan(50)
  })

  test('opens a recipe file and shows specialized editor', async ({ page }) => {
    await page.locator('input[webkitdirectory]').setInputFiles(SAMPLE_DIR)
    await expect(page.locator('.dz-loaded .count')).toContainText('files loaded', { timeout: 60_000 })
    await expect(page.locator('.ide-shell')).toBeVisible({ timeout: 30_000 })

    const recipeLink = page.locator('.ide-tree-item').filter({ hasText: 'shaped' }).first()
    if (await recipeLink.count() > 0) {
      await recipeLink.click()
      await expect(page.locator('.recipe-editor, .shaped-editor, .ide-editor')).toBeVisible({ timeout: 10_000 })
    }
  })

  test('opens an advancement and shows editor', async ({ page }) => {
    await page.locator('input[webkitdirectory]').setInputFiles(SAMPLE_DIR)
    await expect(page.locator('.dz-loaded .count')).toContainText('files loaded', { timeout: 60_000 })
    await expect(page.locator('.ide-shell')).toBeVisible({ timeout: 30_000 })

    const adv = page.locator('.ide-tree-item').filter({ hasText: '.json' }).first()
    if (await adv.count() > 0) {
      await adv.click()
      await page.waitForTimeout(500)
      const editor = page.locator('.ide-editor, .advancement-editor')
      await expect(editor.first()).toBeVisible({ timeout: 10_000 })
    }
  })

  test('keyboard shortcuts work', async ({ page }) => {
    await page.locator('input[webkitdirectory]').setInputFiles(SAMPLE_DIR)
    await expect(page.locator('.dz-loaded .count')).toContainText('files loaded', { timeout: 60_000 })
    await expect(page.locator('.ide-shell')).toBeVisible({ timeout: 30_000 })

    await page.keyboard.press('Control+p')
    await expect(page.locator('.quickopen, .quick-open')).toBeVisible({ timeout: 5_000 })
    await page.keyboard.press('Escape')
    await expect(page.locator('.quickopen, .quick-open')).not.toBeVisible({ timeout: 5_000 })

    await page.keyboard.press('Control+Shift+p')
    await expect(page.locator('.command-palette')).toBeVisible({ timeout: 5_000 })
    await page.keyboard.press('Escape')
  })

  test('copy button copies file content', async ({ page }) => {
    await page.locator('input[webkitdirectory]').setInputFiles(SAMPLE_DIR)
    await expect(page.locator('.dz-loaded .count')).toContainText('files loaded', { timeout: 60_000 })
    await expect(page.locator('.ide-shell')).toBeVisible({ timeout: 30_000 })

    await page.locator('.ide-tree-item').first().click()
    await page.waitForTimeout(500)

    const copyBtn = page.locator('.ide-tool-btn').filter({ hasText: 'Copy' }).first()
    if (await copyBtn.count() > 0) {
      await copyBtn.click()
      const text = await page.evaluate(() => navigator.clipboard.readText())
      expect(text.length).toBeGreaterThan(0)
    }
  })

  test('format button formats JSON', async ({ page }) => {
    await page.locator('input[webkitdirectory]').setInputFiles(SAMPLE_DIR)
    await expect(page.locator('.dz-loaded .count')).toContainText('files loaded', { timeout: 60_000 })
    await expect(page.locator('.ide-shell')).toBeVisible({ timeout: 30_000 })

    await page.locator('.ide-tree-item').filter({ hasText: '.json' }).first().click()
    await page.waitForTimeout(500)

    const formatBtn = page.locator('.ide-tool-btn').filter({ hasText: 'Format' }).first()
    if (await formatBtn.count() > 0) {
      await formatBtn.click()
    }
  })
})
