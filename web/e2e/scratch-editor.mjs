import { chromium } from 'playwright'
const CHROME = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || process.env.HOME + '/.cache/ms-playwright/chromium-1234/chrome-linux64/chrome'
const BASE = 'http://127.0.0.1:5173'
const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox','--disable-setuid-sandbox','--disable-dev-shm-usage'] })
const page = await browser.newPage({ viewport: { width: 1500, height: 950 } })
const log=(...a)=>console.log(...a)
let pass=0, fail=0
const check=(n,c)=>{ if(c){pass++;log('  PASS:',n)} else {fail++;log('  FAIL:',n)} }
const has=(t,s)=> (t||'').toLowerCase().includes(s.toLowerCase())
const errors=[]
page.on('console', m=>{ if(m.type()==='error') errors.push(m.text()) })
page.on('pageerror', e=> errors.push('PAGEERROR: '+e.message))

await page.goto(BASE+'/datapack-editor/', { waitUntil:'commit', timeout:120000 })
// Fresh start: clear any persisted draft so PackSelector empty state shows.
await page.evaluate(()=> localStorage.clear()).catch(()=>{})
await page.reload({ waitUntil:'commit' })
await page.waitForSelector('.dz-new-pack', { timeout:120000 })
log('\n# Create datapack from scratch')
await page.locator('.dz-new-pack-input:not(.dz-new-pack-num)').fill('my_pack')
await page.locator('.dz-new-pack .btn-primary').click()
await page.waitForSelector('.ide-tree-row', { timeout:120000 })
await page.waitForTimeout(800)
const tree = await page.locator('.ide-tree').innerText().catch(()=> '')
check('pack.mcmeta present', has(tree, 'pack.mcmeta'))
for (const f of ['advancement','recipe','loot_table','predicate','tag','functions'])
  check('skeleton folder data/my_pack/'+f, has(tree, f))
check('file-type badge json on pack.mcmeta', await page.locator('.ide-file-ext-mcmeta').count() > 0)

log('\n# New file with extension + relative path (auto-parent folders)')
await page.getByRole('button', { name: '+ New file' }).click()
await page.locator('.ide-newfile-input').fill('data/my_pack/advancement/diamond.json')
await page.keyboard.press('Enter')
await page.waitForTimeout(500)
const tree2 = await page.locator('.ide-tree').innerText().catch(()=> '')
check('created diamond.json', has(tree2, 'diamond.json'))
check('parent folder auto-created (advancement under my_pack)', await page.locator('.ide-tree-row', { hasText: 'diamond.json' }).count() > 0)
check('json badge on new file', await page.locator('.ide-file-ext-json').count() > 0)
// editor opened with scaffolded advancement
await page.waitForTimeout(800)
check('split view opened for new advancement', await page.locator('.ide-split').count() > 0)
const right = await page.locator('.ide-split-right').innerText().catch(()=> '')
check('scaffold shows Criteria', has(right, 'criteria'))

log('\n# New folder')
await page.getByRole('button', { name: '+ New folder' }).click()
await page.locator('.ide-newfile-input').fill('assets')
await page.keyboard.press('Enter')
await page.waitForTimeout(400)
check('new folder assets created', has(await page.locator('.ide-tree').innerText().catch(()=>''), 'assets'))

log('\n# Context menu New File on a folder')
await page.locator('.ide-tree-row', { hasText: 'data' }).first().click({ button: 'right' })
await page.waitForTimeout(200)
const cm = await page.locator('.context-menu').innerText().catch(()=> '')
check('context menu has New File', has(cm, 'new file'))
check('context menu has New Folder', has(cm, 'new folder'))
await page.locator('.context-menu-item', { hasText: 'New File' }).click()
await page.waitForTimeout(200)
check('inline new-file input opened from context menu', await page.locator('.ide-newfile-input').count() > 0)

log('\n# Console errors:', errors.length)
for (const e of errors.slice(0,10)) log('   ', e)
check('no console errors', errors.length === 0)

log('\n==== RESULT: '+pass+' pass / '+fail+' fail ====')
await browser.close()
process.exit(fail===0 ? 0 : 1)
