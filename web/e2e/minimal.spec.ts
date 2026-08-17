import { test, expect } from '@playwright/test'

test('page loads', async ({ page }) => {
  // Use domcontentloaded to avoid waiting on external resources
  await page.goto('/', { waitUntil: 'domcontentloaded', timeout: 30000 })
  await page.waitForTimeout(2000)

  const dropzone = page.locator('.dropzone')
  await expect(dropzone).toBeVisible({ timeout: 20000 })
})
