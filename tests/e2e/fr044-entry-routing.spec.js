const { test, expect } = require('@playwright/test')
const { loginAsOwner } = require('./e2e-auth')

// @req FR-044 — prove the route boundary before the final BusinessShell.
// @spec ADR-015, SDD-022 — Landing/Login/Business Routing stay outside shell chrome.
// @tested tests/e2e/fr044-entry-routing.spec.js

async function clearBusinessSelection(page) {
  await page.context().clearCookies()
  await page.goto('/')
  await page.evaluate(() => localStorage.removeItem('zuri-v2-scope'))
  await page.reload()
}

test.describe('FR-044 entry to BusinessShell', () => {
  test('keeps Landing, Login, and Business Routing outside final shell chrome', async ({ page }) => {
    await clearBusinessSelection(page)
    await expect(page.locator('[data-shell="entry"]')).toBeVisible()
    await expect(page.getByRole('navigation', { name: 'Domains' })).toHaveCount(0)

    await page.getByRole('link', { name: 'Sign in' }).click()
    await expect(page).toHaveURL(/\/login$/)
    await expect(page.locator('[data-shell="entry"]')).toBeVisible()
    await expect(page.getByRole('navigation', { name: 'Domains' })).toHaveCount(0)

    await loginAsOwner(page)
    await expect(page).toHaveURL(/\/businesses$/)
    await expect(page.getByRole('heading', { name: 'Choose a Business' })).toBeVisible()
    await expect(page.getByRole('button', { name: /Open Business Business 01/i })).toBeVisible()
    await expect(page.getByRole('navigation', { name: 'Domains' })).toHaveCount(0)
  })

  test('requires an explicit Business selection before mounting BusinessShell', async ({ page }) => {
    await clearBusinessSelection(page)
    await page.goto('/overview')
    await expect(page).toHaveURL(/\/login$/)
    await loginAsOwner(page)
    await expect(page).toHaveURL(/\/businesses$/)
    await expect(page.getByRole('heading', { name: 'Choose a Business' })).toBeVisible()

    await page.getByRole('button', { name: /Open Business Business 01/i }).click()
    await expect(page).toHaveURL(/\/overview$/)
    await expect(page.getByRole('navigation', { name: 'Domains' })).toBeVisible()
    await expect(page.getByRole('heading', { name: /Business 01.*Command Center/ })).toBeVisible()
    // FR-060 — the landing sidebar is Business Home's, a single Dashboard entry.
    await expect(page.locator('aside').getByRole('link', { name: 'Dashboard' })).toHaveCount(1)
    await expect(page.locator('aside').getByRole('link', { name: 'Overview' })).toHaveCount(0)
    await expect(page.locator('aside').getByText('Business Home', { exact: true })).toHaveCount(1)
    await expect(page.locator('aside').getByRole('link', { name: 'Business Home' })).toHaveCount(0)
    // FR-060 — Development roots at its own resource list now.
    await expect(page.getByRole('link', { name: 'Development' }).first()).toHaveAttribute('href', '/projects')

    await expect(page.getByRole('link', { name: 'Change Business' })).toHaveCount(0)
    await expect(page.getByRole('link', { name: 'Select Business from Organization' })).toHaveCount(1)
    await expect(page.locator('nav[aria-label="Breadcrumb"]').getByRole('link', { name: /Business 01/i })).toHaveCount(0)
    await expect(page.locator('nav[aria-label="Breadcrumb"]').getByRole('link', { name: 'Home' })).toHaveAttribute('href', '/overview')
    await page.getByRole('link', { name: 'Select Business from Organization' }).click()
    await expect(page).toHaveURL(/\/businesses$/)
    await expect(page.getByRole('heading', { name: 'Choose a Business' })).toBeVisible()
  })
})
