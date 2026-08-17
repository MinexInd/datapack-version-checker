import { chromium } from 'playwright'
const CHROME = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || process.env.HOME + '/.cache/ms-playwright/chromium-1234/chrome-linux64/chrome'
const BASE = 'http://127.0.0.1:5173'
const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox','--disable-setuid-sandbox','--disable-dev-shm-usage'] })
const page = await browser.newPage({ viewport: { width: 1500, height: 950 } })
const log=(...a)=>console.log(...a)
let pass=0, fail=0
const check=(n,c)=>{ if(c){pass++;log('  PASS:',n)} else {fail++;log('  FAIL:',n)} }
const has=(txt, sub)=> txt.toLowerCase().includes(sub.toLowerCase())

await page.goto(BASE+'/datapack-editor/', { waitUntil:'domcontentloaded', timeout:60000 })
await page.waitForSelector('.dropzone', { timeout:60000 })
await page.locator('input[webkitdirectory]').setInputFiles('public/test-pack')
await page.waitForSelector('.ide-tree-row', { timeout:60000 })
async function openRow(name, waitMs=3500){ await page.locator('.ide-tree-row').filter({ hasText: name }).first().click(); await page.waitForTimeout(waitMs) }

// Advancement (fully complete fallback form)
await openRow('diamond.json')
check('advancement: split view', await page.locator('.ide-split').count() > 0)
check('advancement: form rendered', await page.locator('.ide-split-right .advancement-editor').count() > 0)
const advTxt = await page.locator('.ide-split-right').innerText().catch(()=> '')
for (const f of ['Parent','Display','Criteria','Rewards','Requirements','conditions','Icon count','Icon tag']) check('advancement has "'+f+'"', has(advTxt, f))
await page.locator('.ide-split-left .monaco-editor').first().waitFor({ timeout: 8000 }).catch(()=>{})
check('advancement: left Monaco', await page.locator('.ide-split-left .monaco-editor').count() > 0)

// Tag
await openRow('test.json')
check('tag: split view', await page.locator('.ide-split').count() > 0)
check('tag: form rendered', await page.locator('.ide-split-right .tag-editor').count() > 0)

// Recipe
await openRow('diamond_pickaxe.json')
check('recipe: split view', await page.locator('.ide-split').count() > 0)
check('recipe: form rendered', await page.locator('.ide-split-right .recipe-itemref').count() > 0)

// Loot table (uniquely named file)
await openRow('loot_diamond.json')
check('loot_table: split view', await page.locator('.ide-split').count() > 0)
check('loot_table: form rendered', await page.locator('.ide-split-right .loot-table-editor').count() > 0)

// pack.mcmeta -> McmetaEditor
await openRow('pack.mcmeta')
check('pack.mcmeta: McmetaEditor', await page.locator('.ide-split-right .mcmeta-form').count() > 0)

// Toggle GUI/Source
await openRow('diamond.json')
await page.locator('.ide-split-modes button', { hasText: 'GUI' }).click(); await page.waitForTimeout(300)
check('GUI hides left', await page.locator('.ide-split-left').count() === 0)
await page.locator('.ide-split-modes button', { hasText: 'Split' }).click(); await page.waitForTimeout(300)
check('Split shows both + divider', await page.locator('.ide-split-left').count() > 0 && await page.locator('.ide-split-divider').count() > 0)

// Splitter drag adjusts left width
await openRow('diamond.json')
const leftBefore = await page.locator('.ide-split-left').boundingBox()
const div = await page.locator('.ide-split-divider').boundingBox()
const cx = div.x + div.width / 2
const cy = div.y + div.height / 2
await page.mouse.move(cx, cy)
await page.mouse.down()
await page.mouse.move(cx + 220, cy, { steps: 8 })
await page.mouse.up()
await page.waitForTimeout(400)
const leftAfter = await page.locator('.ide-split-left').boundingBox()
check('splitter drag changes left width', leftAfter && leftBefore && Math.abs(leftAfter.width - leftBefore.width) > 80)
check('left width grew after dragging right', leftAfter.width > leftBefore.width)

// Edit JSON -> form stays alive
await page.locator('.ide-split-left .monaco-editor').click()
await page.keyboard.type(' ')
await page.waitForTimeout(900)
check('alive after JSON edit', await page.locator('.ide-split').count() > 0 && await page.locator('.ide-split-right .advancement-editor').count() > 0)

// Two-way: form edit reflected in JSON
await openRow('diamond.json')
const before = await page.locator('.ide-split-left .view-lines').innerText().catch(()=> '')
await page.locator('.ide-split-right input[type=checkbox]').first().check().catch(()=>{})
await page.waitForTimeout(900)
const after = await page.locator('.ide-split-left .view-lines').innerText().catch(()=> '')
check('form edit reflected in JSON', before !== after)

log(`\nResults: ${pass} passed, ${fail} failed`)
await browser.close()
