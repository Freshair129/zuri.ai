// @req FR-060 — Business Home Dashboard rendered in a real browser.
// @spec SDD-033 — reserved domains must never render a number.
// @tested tests/e2e/fr060-business-home.spec.js
const { test, expect } = require('@playwright/test')

async function openBusinessHome(page) {
  await page.goto('/login')
  await page.getByRole('button', { name: /demo login/i }).click()
  await page.getByRole('button', { name: /Open Business Business 01/i }).click()
  await expect(page).toHaveURL(/\/overview$/)
}

test.describe('FR-060 Business Home', () => {
  test('is the landing slot and renders briefing, health and attention queue', async ({ page }) => {
    await openBusinessHome(page)

    // The slot itself: first in the domain bar, and this page belongs to it.
    const bar = page.getByRole('navigation', { name: 'Domains' })
    await expect(bar.getByRole('link', { name: 'Business Home' })).toBeVisible()
    await expect(page.getByRole('heading', { name: /Business 01 — Command Center/ })).toBeVisible()

    await expect(page.getByRole('heading', { name: 'Zuri briefing' })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Business health' })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Attention queue' })).toBeVisible()

    // The composite must say what it covers rather than implying it covers all.
    // The coverage phrase appears in the caption, the score line and the briefing —
    // all three are deliberate, so assert presence rather than uniqueness.
    await expect(page.getByText(/of 7 domains/).first()).toBeVisible()

    await page.screenshot({ path: 'output/playwright/fr060-business-home.png', fullPage: true })
  })

  test('renders reserved domains as reserved, never as a zero', async ({ page }) => {
    await openBusinessHome(page)

    for (const label of ['Commerce', 'CRM', 'Marketing', 'Operations']) {
      await expect(page.getByText(label, { exact: true }).first()).toBeVisible()
    }
    // Every reserved slot says so in words. If any of them ever renders a score,
    // this count changes and the test fails — which is the point.
    await expect(page.getByText('Reserved — no module yet')).toHaveCount(4)
  })

  test('Development is a separate slot that roots at its own resource list', async ({ page }) => {
    await openBusinessHome(page)

    const development = page.getByRole('navigation', { name: 'Domains' }).getByRole('link', { name: 'Development' })
    await expect(development).toHaveAttribute('href', '/projects')
    await development.click()
    await expect(page).toHaveURL(/\/projects$/)
    // Development's sidebar must not offer the cross-domain page as its own.
    await expect(page.locator('aside').getByRole('link', { name: 'Overview' })).toHaveCount(0)
  })
})
