import { chromium } from 'playwright'
import path from 'path'

const BASE_URL = 'http://localhost:5173'
const TEST_PACK = path.resolve('public/test-pack')
const CHROME = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || 
  process.env.HOME + '/.cache/ms-playwright/chromium-1234/chrome-linux64/chrome'

const browser = await chromium.launch({ 
  executablePath: CHROME,
  headless: true,
  args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
})

const page = await browser.newPage({ viewport: { width: 1280, height: 800 } })

async function test(name, fn) {
  try {
    await fn(page)
    console.log(`  PASS: ${name}`)
    return true
  } catch (e) {
    console.log(`  FAIL: ${name} — ${e.message}`)
    return false
  }
}

let passed = 0
let failed = 0

// Navigate to IDE
await page.goto(BASE_URL + '/datapack-editor/', { waitUntil: 'domcontentloaded', timeout: 30000 })
await page.waitForTimeout(2000)

// Load test pack once for all tests
await page.locator('input[webkitdirectory]').setInputFiles(TEST_PACK)
await page.waitForTimeout(3000)

// Test 1: File tree renders
if (await test('file tree renders', async (page) => {
  const rows = await page.locator('.ide-tree-row').count()
  if (rows < 6) throw new Error(`Only ${rows} tree rows found`)
})) passed++; else failed++

// Test 2: Open recipe file
if (await test('open recipe file', async (page) => {
  const file = page.locator('.ide-tree-row').filter({ hasText: 'diamond_pickaxe' }).first()
  if (await file.count() === 0) throw new Error('Recipe not in tree')
  await file.click()
  await page.waitForTimeout(500)

  const empty = await page.locator('.ide-editor-empty').count()
  if (empty > 0) throw new Error('Editor still empty')
}))) passed++; else failed++

// Test 3: Open advancement
if (await test('open advancement file', async (page) => {
  const file = page.locator('.ide-tree-row').filter({ hasText: 'diamond.json' }).first()
  if (await file.count() === 0) throw new Error('Advancement not in tree')
  await file.click()
  await page.waitForTimeout(500)

  const tab = await page.locator('.ide-tab.active .ide-tab-name').textContent()
  if (!tab || !tab.includes('diamond.json')) throw new Error('Wrong tab active: ' + tab)
}))) passed++; else failed++

// Test 4: Open mcfunction with syntax highlighting
if (await test('mcfunction syntax highlighting', async (page) => {
  const file = page.locator('.ide-tree-row').filter({ hasText: '.mcfunction' }).first()
  if (await file.count() === 0) throw new Error('Mcfunction not in tree')
  await file.click()
  await page.waitForTimeout(500)

  const highlight = await page.locator('.mcfunction-highlight').count()
  if (highlight === 0) throw new Error('Syntax highlighting not rendered')

  const textarea = await page.locator('.mcfunction-textarea').count()
  if (textarea === 0) throw new Error('Mcfunction textarea not rendered')
}))) passed++; else failed++

// Test 5: Open tag file
if (await test('open tag file', async (page) => {
  const file = page.locator('.ide-tree-row').filter({ hasText: 'test.json' }).first()
  if (await file.count() === 0) throw new Error('Tag not in tree')
  await file.click()
  await page.waitForTimeout(500)

  const empty = await page.locator('.ide-editor-empty').count()
  if (empty > 0) throw new Error('Editor still empty')
}))) passed++; else failed++

// Test 6: Copy button exists
if (await test('copy button present', async (page) => {
  await page.locator('.ide-tree-row').first().click()
  await page.waitForTimeout(300)

  const copyBtn = page.locator('.ide-tool-btn').filter({ hasText: 'Copy' }).first()
  if (await copyBtn.count() === 0) throw new Error('Copy button not found')
}))) passed++; else failed++

// Test 7: Format button exists
if (await test('format button present', async (page) => {
  await page.locator('.ide-tree-row').filter({ hasText: '.json' }).first().click()
  await page.waitForTimeout(300)

  const formatBtn = page.locator('.ide-tool-btn').filter({ hasText: 'Format' }).first()
  if (await formatBtn.count() === 0) throw new Error('Format button not found')
  await formatBtn.click()
  await page.waitForTimeout(300)
}))) passed++; else failed++

// Test 8: Ctrl+P quick open
if (await test('Ctrl+P opens quick open', async (page) => {
  await page.keyboard.press('Control+p')
  await page.waitForTimeout(300)

  const qo = await page.locator('.quickopen, .quick-open').count()
  if (qo === 0) throw new Error('Quick open not visible')
  await page.keyboard.press('Escape')
  await page.waitForTimeout(100)
}))) passed++; else failed++

// Test 9: Editor allows scrolling (not overflow:hidden)
if (await test('editor allows scrolling', async (page) => {
  await page.locator('.ide-tree-row').filter({ hasText: '.json' }).first().click()
  await page.waitForTimeout(300)

  const editor = page.locator('.ide-editor').first()
  const overflow = await editor.evaluate(el => getComputedStyle(el).overflowY)
  if (overflow === 'hidden') throw new Error('Editor has overflow:hidden')
}))) passed++; else failed++

// Test 10: Single toolbar (no duplicate)
if (await test('single toolbar only', async (page) => {
  const toolbars = await page.locator('.ide-editor-toolbar').count()
  if (toolbars !== 1) throw new Error(`Expected 1 toolbar, found ${toolbars}`)
}))) passed++; else failed++

console.log(`\nResults: ${passed} passed, ${failed} failed`)
process.exit(failed > 0 ? 1 : 0)

await browser.close()
