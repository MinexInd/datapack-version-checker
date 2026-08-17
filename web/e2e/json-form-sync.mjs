import { chromium } from 'playwright'
const CHROME = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || process.env.HOME + '/.cache/ms-playwright/chromium-1234/chrome-linux64/chrome'
const BASE = 'http://127.0.0.1:5173'
const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox','--disable-setuid-sandbox','--disable-dev-shm-usage','--disable-clipboard'] })
const page = await browser.newPage({ viewport: { width: 1500, height: 950 } })
const log=(...a)=>console.log(...a)
let pass=0, fail=0
const check=(n,c)=>{ if(c){pass++;log('  PASS:',n)} else {fail++;log('  FAIL:',n)} }
const errors=[]
page.on('console', m=>{ if(m.type()==='error' && !/Failed to load resource|favicon/i.test(m.text())) errors.push(m.text()) })
page.on('pageerror', e=> errors.push('PAGEERROR: '+e.message))

// Start from the empty hub state at /datapack-editor/
await page.goto(BASE+'/datapack-editor/', { waitUntil:'commit', timeout:120000 })
await page.evaluate(()=> localStorage.clear()).catch(()=>{})
await page.reload({ waitUntil:'commit' })
await page.waitForSelector('.dz-new-pack', { timeout:60000 })

// Create a datapack from scratch (mcdoc is unavailable in this sandbox -> fallback editors)
await page.locator('.dz-new-pack-input:not(.dz-new-pack-num)').first().fill('demo')
await page.locator('.dz-new-pack button:has-text("Create")').click()
await page.waitForSelector('.ide-tree-row', { timeout:60000 })
await page.waitForTimeout(400)

// Create a recipe file via the explorer New File button
await page.locator('button[aria-label="New File"]').click()
await page.waitForSelector('.ide-newfile-input', { timeout:10000 })
await page.locator('.ide-newfile-input').fill('data/demo/recipe/test.json')
await page.keyboard.press('Enter')
await page.waitForTimeout(400)
const rows = await page.locator('.ide-tree-row').allTextContents()
check('recipe file created', rows.some(t=>t.includes('test.json')))

// Open the recipe file
await page.locator('.ide-tree-row', { hasText: 'test.json' }).first().click()
await page.waitForSelector('.ide-split', { timeout:30000 })
// wait for Monaco to finish mounting (it shows a 'Loading...' overlay first)
await page.waitForFunction(() => { const el = document.querySelector('.ide-split-left'); return !!el && !/Loading/.test(el.textContent || '') }, { timeout: 30000 })
await page.waitForSelector('.ide-split-left .monaco-editor textarea', { timeout: 30000 })
await page.waitForTimeout(400)

// Type a NEW recipe JSON into the Monaco JSON pane.
// We drive Monaco's model directly (its onDidChangeModelContent still fires the
// wrapper's onChange -> handleJsonChange, the exact path that was broken),
// because Monaco's textarea is covered by an overlay and not clickable here.
const newJson = '{"type":"minecraft:crafting_shapeless","ingredients":[{"item":"minecraft:diamond"}],"result":{"item":"minecraft:netherite_ingot","count":42}}'
await page.evaluate((j) => {
  const editors = window.monaco.editor.getEditors()
  const ed = editors.find(e => { const n = e.getDomNode(); return n && n.closest('.ide-split-left') }) || editors[0]
  ed.setValue(j)
}, newJson)
await page.waitForTimeout(600)

const after = await page.locator('.ide-split-right').innerText().catch(()=>'')
const itemVals = await page.$$eval('.ide-split-right input[type=text]', els => els.map(e => e.value)).catch(()=>[])
const countVal = await page.locator('.ide-split-right input[type=number]').first().inputValue().catch(()=>'')
check('form reflects new result item (netherite_ingot)', itemVals.some(v => v.includes('netherite_ingot')))
check('form reflects count=42', countVal === '42' || after.includes('42'))

const jsonNow = await page.evaluate(() => {
  try { const m = window.monaco && window.monaco.editor.getModels()[0]; return m ? m.getValue() : '' } catch(e){ return '' }
})
check('JSON pane preserved edit', jsonNow.includes('netherite_ingot'))

log('\n# reverse: form -> JSON sync')
// Edit the count in the form and verify the JSON updates
await page.locator('.ide-split-right input[type=number]').first().fill('7')
await page.waitForTimeout(500)
const jsonAfterForm = await page.evaluate(() => {
  try { const m = window.monaco && window.monaco.editor.getModels()[0]; return m ? m.getValue() : '' } catch(e){ return '' }
})
let parsed=null; try { parsed = JSON.parse(jsonAfterForm) } catch(e){}
check('form edit reflected in JSON (count 7)', parsed && parsed.result && parsed.result.count === 7)

log('\n# Console errors')
check('no console/page errors', errors.length === 0)
if (errors.length) log('  ERRORS:', errors.slice(0,5))

log(`\nRESULT pass=${pass} fail=${fail}`)
await browser.close()
process.exit(fail>0 ? 1 : 0)
