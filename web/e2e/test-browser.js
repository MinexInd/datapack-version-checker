
const { chromium } = require('playwright')

async function main() {
  const browser = await chromium.launch({ 
    executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE,
    headless: true,
    args: ['--no-sandbox', '--disable-gpu']
  })
  console.log('Browser launched!')

  const page = await browser.newPage()
  console.log('Page created')

  await page.goto('http://localhost:5173/', { waitUntil: 'domcontentloaded', timeout: 30000 })
  console.log('Page loaded!')

  const title = await page.title()
  console.log('Title:', title)

  const dropzone = await page.locator('.dropzone').count()
  console.log('Dropzone count:', dropzone)

  await browser.close()
  console.log('Done')
}

main().catch(e => { console.error(e); process.exit(1) })
