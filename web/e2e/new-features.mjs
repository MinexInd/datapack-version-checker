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

// capture clipboard writes
await page.addInitScript(() => {
  window.__clip = null
  try {
    const orig = navigator.clipboard && navigator.clipboard.writeText && navigator.clipboard.writeText.bind(navigator.clipboard)
    if (orig) { navigator.clipboard.writeText = (t) => { window.__clip = t; return Promise.resolve() } }
  } catch (e) {}
})

await page.goto(BASE+'/datapack-editor/', { waitUntil:'commit', timeout:120000 })
await page.evaluate(()=> localStorage.clear()).catch(()=>{})
await page.reload({ waitUntil:'commit' })
await page.waitForSelector('.dz-new-pack', { timeout:120000 })

log('\n# A. Top bar Home / breadcrumbs (no file loaded)')
// Initially no file => breadcrumbs-home "Home" visible, height ~30
const bcBefore = await page.locator('.breadcrumbs').first().boundingBox().catch(()=>null)
const homeText = await page.locator('.breadcrumbs-home').first().textContent().catch(()=>null)
check('breadcrumbs present before file load', !!bcBefore)
check('breadcrumbs height ~30px (no overlap)', bcBefore && Math.abs(bcBefore.height-30)<6)
check('Home label visible before load', (homeText||'').includes('Home'))

log('\n# B. Create datapack from scratch with supported_formats')
await page.locator('.dz-new-pack-input').first().fill('demo')
// set supported formats min/max
const nums = page.locator('.dz-new-pack-num')
if (await nums.count() >= 2) {
  await nums.nth(0).fill('10')
  await nums.nth(1).fill('20')
}
await page.locator('.dz-new-pack button:has-text("Create")').click()
// wait for explorer to appear
await page.waitForSelector('.ide-tree-row', { timeout:60000 })
await page.waitForTimeout(500)
const treeRows1 = await page.locator('.ide-tree-row').allTextContents()
check('explorer shows pack.mcmeta', treeRows1.some(t=>t.includes('pack.mcmeta')))

log('\n# C. Open pack.mcmeta and verify supported_formats + breadcrumbs after load')
await page.locator('.ide-tree-row', { hasText: 'pack.mcmeta' }).first().click()
await page.waitForTimeout(400)
const bcAfter = await page.locator('.breadcrumbs').first().boundingBox().catch(()=>null)
check('breadcrumbs still visible after file load', !!bcAfter)
check('breadcrumbs height ~30px after load', bcAfter && Math.abs(bcAfter.height-30)<6)
check('Home visible after load (breadcrumbs-item)', await page.locator('.breadcrumbs-item').first().count() > 0)
const editorText = await page.locator('.monaco-editor').first().innerText().catch(()=>'') || ''
const jsonText = await page.evaluate(() => {
  const ta = document.querySelector('textarea')
  return ta ? ta.value : ''
})
const combined = (editorText + ' ' + jsonText)
// read the actual file content from editor model
const fileContent = await page.evaluate(() => {
  // try to get monaco model value
  try {
    const models = window.monaco && window.monaco.editor && window.monaco.editor.getModels()
    return models && models.length ? models[0].getValue() : ''
  } catch(e){ return '' }
})
const look = (fileContent || editorText || '')
check('pack.mcmeta has supported_formats', look.includes('supported_formats'))
check('supported_formats min_inclusive:10', look.includes('"min_inclusive": 10') || look.includes('"min_inclusive":10'))
check('supported_formats max_inclusive:20', look.includes('"max_inclusive": 20') || look.includes('"max_inclusive":20'))

log('\n# D. Duplicate file via context menu')
await page.locator('.ide-tree-row', { hasText: 'pack.mcmeta' }).first().click({ button: 'right' })
await page.waitForSelector('.context-menu-item', { timeout:10000 })
await page.locator('.context-menu-item', { hasText: 'Duplicate' }).click()
await page.waitForTimeout(400)
const treeRows2 = await page.locator('.ide-tree-row').allTextContents()
check('duplicate created pack-copy.mcmeta', treeRows2.some(t=>t.includes('pack-copy.mcmeta')))

log('\n# E. Copy Path via context menu')
await page.locator('.ide-tree-row', { hasText: 'pack.mcmeta' }).first().click({ button: 'right' })
await page.waitForSelector('.context-menu-item', { timeout:10000 })
await page.locator('.context-menu-item', { hasText: 'Copy Path' }).click()
await page.waitForTimeout(300)
const clip = await page.evaluate(() => window.__clip)
check('Copy Path wrote pack.mcmeta to clipboard', clip === 'pack.mcmeta')

log('\n# F. Sidebar resize (GUI adjustable)')
const expBefore = await page.locator('.ide-explorer').first().boundingBox()
const sep = page.locator('.ide-sidebar-resize').first()
const sb = await sep.boundingBox()
await page.mouse.move(sb.x + sb.width/2, sb.y + sb.height/2)
await page.mouse.down()
await page.mouse.move(sb.x + 120, sb.y + sb.height/2, { steps: 8 })
await page.mouse.up()
await page.waitForTimeout(300)
const expAfter = await page.locator('.ide-explorer').first().boundingBox()
check('sidebar width changed after drag', expBefore && expAfter && Math.abs(expAfter.width - expBefore.width) > 40)

log('\n# Console errors')
check('no console/page errors', errors.length === 0)
if (errors.length) log('  ERRORS:', errors.slice(0,5))

log(`\nRESULT pass=${pass} fail=${fail}`)
await browser.close()
process.exit(fail>0 ? 1 : 0)
