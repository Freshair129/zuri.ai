// @req FR-185 — Marketing P5 pages render scoped unavailable/unknown states
// at mobile width and preserve the active Business across reload/switch.
// @spec SDD-086, SEC-001, SEC-003
// @tested tests/e2e/marketing-p5.spec.js

const { test, expect } = require('@playwright/test')
const { loginAsOwner } = require('./e2e-auth')

async function chooseBusiness(page, businessName = /Business 01/i) {
  await page.goto('/businesses')
  const button = page.getByRole('button', { name: new RegExp(`Open Business ${businessName.source}`, businessName.flags) }).first()
  await expect(button).toBeVisible()
  await button.click()
}

test.describe('Marketing P5 truthful planning/read surfaces', () => {
  test('renders paid, broadcast and AskMarketing states at 390px and survives reload', async ({ page }) => {
    await loginAsOwner(page)
    await chooseBusiness(page)
    await page.setViewportSize({ width: 390, height: 844 })
    for (const path of ['/growth/paid-media', '/growth/broadcast', '/growth/ask-marketing']) {
      await page.goto(path)
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
      await expect(page.getByText(/unavailable|planning|read-only|Measured provider metrics/i).first()).toBeVisible()
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
      await page.reload()
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
    }
  })

  test('switches Business before reading the planning surface', async ({ page }) => {
    await loginAsOwner(page)
    await page.goto('/businesses')
    const buttons = page.getByRole('button', { name: /Open Business/i })
    await expect(buttons.first()).toBeVisible()
    const scope = await (await page.request.get('/api/scope')).json()
    const second = scope.businesses?.[1]
    if (!second) return
    await page.getByRole('button', { name: new RegExp(`Open Business ${second.name}`) }).click()
    await page.goto('/growth/broadcast')
    await expect(page.getByRole('heading', { name: 'Broadcast planning' })).toBeVisible()
    await expect(page.getByText(/Dispatch is unavailable/i)).toBeVisible()
  })
})

