import { chromium } from 'playwright'
const CHROME = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || process.env.HOME + '/.cache/ms-playwright/chromium-1234/chrome-linux64/chrome'
const BASE = 'http://127.0.0.1:5173'
const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox','--disable-setuid-sandbox','--disable-dev-shm-usage','--disable-clipboard'] })
const page = await browser.newPage({ viewport: { width: 1600, height: 950 } })
const log=(...a)=>console.log(...a)
let pass=0, fail=0
const check=(n,c)=>{ if(c){pass++;log('  PASS:',n)} else {fail++;log('  FAIL:',n)} }
const errors=[]
page.on('console', m=>{ if(m.type()==='error' && !/Failed to load resource|favicon|spyglassmc\.com|CORS policy/i.test(m.text())) errors.push(m.text()) })
page.on('pageerror', e=> errors.push('PAGEERROR: '+e.message))

await page.goto(BASE+'/datapack-editor/', { waitUntil:'commit', timeout:120000 })
await page.evaluate(()=> localStorage.clear()).catch(()=>{})
await page.reload({ waitUntil:'commit' })
await page.waitForSelector('.dz-new-pack', { timeout:60000 })
await page.locator('.dz-new-pack-input:not(.dz-new-pack-num)').first().fill('demo')
await page.locator('.dz-new-pack button:has-text("Create")').click()
await page.waitForSelector('.ide-tree-row', { timeout:60000 })
await page.waitForTimeout(300)

// create mcfunction file
await page.locator('button[aria-label="New File"]').click()
await page.waitForSelector('.ide-newfile-input', { timeout:10000 })
await page.locator('.ide-newfile-input').fill('data/demo/function/spell.mcfunction')
await page.keyboard.press('Enter')
await page.waitForTimeout(300)
await page.locator('.ide-tree-row', { hasText: 'spell.mcfunction' }).first().click()
await page.waitForSelector('.visual-editor', { timeout:30000 })
await page.waitForTimeout(300)

// ---- SEMANTIC DECOMPILATION: type a real datapack, open Visual ----
await page.locator('.visual-mode-toggle button:has-text("Code")').click()
await page.waitForSelector('.visual-editor .monaco-editor', { timeout:30000 })
await page.waitForFunction(() => { const e=document.querySelector('.visual-editor'); return !!e && !/Loading/.test(e.textContent||'') }, {timeout:30000})
const code = 'kill @s\neffect give @s minecraft:speed 10 1'
await page.evaluate((j) => {
  const eds = window.monaco.editor.getEditors()
  const ed = eds.find(e=>{ const n=e.getDomNode(); return n && n.closest('.visual-editor') }) || eds[0]
  ed.setValue(j)
}, code)
await page.waitForTimeout(600)
await page.locator('.visual-mode-toggle button:has-text("Visual")').click()
await page.waitForTimeout(500)

const labels = await page.locator('.vnode .vnode-label').allInnerTexts()
log('  node labels:', JSON.stringify(labels))
check('semantic Kill node present (not just Custom Command)', labels.some(l=>/kill/i.test(l)))
check('semantic Effect node present (not just Custom Command)', labels.some(l=>/effect/i.test(l)))

// compile round-trip
await page.locator('.visual-compile').click()
await page.waitForTimeout(400)
const compiled = await page.locator('.visual-compiled').innerText().catch(()=>'')
check('compiled contains kill @s', compiled.includes('kill @s'))
check('compiled contains effect give', compiled.toLowerCase().includes('effect give'))

// ---- DELETE NODE (Delete key) ----
const beforeCount = await page.locator('.react-flow__node').count()
const killNode = page.locator('.react-flow__node', { has: page.locator('.vnode', { hasText: /kill/i }) }).first()
await killNode.click({ position: { x: 10, y: 10 } })  // click node body to select (not input)
await page.waitForTimeout(150)
await page.keyboard.press('Delete')
await page.waitForTimeout(300)
const afterCount = await page.locator('.react-flow__node').count()
check('Delete key removed a node', afterCount === beforeCount - 1)
// edge from entry to deleted node removed: entry should have 1 outgoing edge now
const edgeCount = await page.locator('.react-flow__edge').count()
check('edge count dropped after delete', edgeCount < beforeCount - 1)

// ---- DUPLICATE (Ctrl+D) ----
const effNode = page.locator('.react-flow__node', { has: page.locator('.vnode', { hasText: /effect/i }) }).first()
await effNode.click({ position: { x: 10, y: 10 } })
await page.waitForTimeout(150)
const beforeDup = await page.locator('.react-flow__node').count()
await page.keyboard.press('Control+d')
await page.waitForTimeout(300)
const afterDup = await page.locator('.react-flow__node').count()
check('Ctrl+D duplicated a node', afterDup === beforeDup + 1)

// ---- CONTEXT MENU (right-click -> Delete) ----
const dupNode = page.locator('.react-flow__node', { has: page.locator('.vnode', { hasText: /effect/i }) }).last()
await dupNode.click({ button: 'right', position: { x: 10, y: 10 } })
await page.waitForTimeout(200)
const ctxVisible = await page.locator('.vf-ctx-menu').isVisible().catch(()=>false)
check('right-click context menu appears', ctxVisible)
if (ctxVisible) {
  const beforeCtx = await page.locator('.react-flow__node').count()
  await page.locator('.vf-ctx-menu li', { hasText: 'Delete' }).click()
  await page.waitForTimeout(300)
  const afterCtx = await page.locator('.react-flow__node').count()
  check('context-menu Delete removed a node', afterCtx === beforeCtx - 1)
}

log('\n# Console errors')
check('no console/page errors', errors.length === 0)
if (errors.length) log('  ERRORS:', errors.slice(0,6))

log(`\nRESULT pass=${pass} fail=${fail}`)
await browser.close()
process.exit(fail>0 ? 1 : 0)
