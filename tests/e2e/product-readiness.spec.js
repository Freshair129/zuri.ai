// @req FR-094 — an authorized BusinessShell viewer can traverse the readiness
// summary, inspect a technical domain and see a feature use case and evidence.
// @spec docs/domains/project-manager/features/FR-094-domain-feature-readiness-dashboard.md
// @tested tests/e2e/product-readiness.spec.js
const { test, expect } = require('@playwright/test')
// api() retries a lost connection, never an answer — see ./reconnecting-request.
const { api } = require('./reconnecting-request')

async function enterBusiness(page, name = 'Business 01') {
  // Authentication is not the behavior under test. Establish the same explicit
  // local demo session through its public route, then exercise Business Routing.
  await api(page.request).post('/api/session/demo', { maxRedirects: 0 })
  await page.goto('/businesses')
  await page.getByRole('button', { name: new RegExp(`Open Business ${name}`) }).click()
  await expect(page).toHaveURL(/overview/)
}

test.describe('FR-094 Product Readiness Dashboard', () => {
  test.beforeEach(async ({ page }) => enterBusiness(page))

  test('shows six KPIs and drills into one domain with feature use cases', async ({ page }) => {
    await page.goto('/platform/product-readiness')

    await expect(page.getByRole('heading', { name: 'Product readiness' })).toBeVisible()
    for (const label of ['Domains', 'Features', 'Ready', 'Progress', 'Verified FRs', 'Open gaps']) {
      await expect(page.locator('main').getByText(label, { exact: true })).toBeVisible()
    }
    await expect(page.getByText('วิธีคำนวณและขอบเขตของตัวเลข')).toBeVisible()
    await expect(page.getByText('ตัวอย่าง use case').first()).toBeVisible()

    await page.locator('a[href="/platform/product-readiness/crm"]').click()
    await expect(page).toHaveURL(/\/platform\/product-readiness\/crm$/)
    await expect(page.getByRole('heading', { name: 'CRM readiness' })).toBeVisible()
    await expect(page.getByText('FEAT-009', { exact: true })).toBeVisible()
    await expect(page.getByText('ตัวอย่าง use case').first()).toBeVisible()
    await expect(page.getByLabel('Filter by readiness')).toBeVisible()
  })
})
