// @req FR-045 - Business File Manager is a Development subdomain inside the selected BusinessShell.
// @spec SDD-023, ADR-016, SEC-007
// @tested tests/e2e/fr045-files.spec.js
const { test, expect } = require('@playwright/test')

async function chooseBusiness(page) {
  await page.goto('/login')
  await page.getByRole('link', { name: /demo login/i }).click()
  await page.getByRole('button', { name: /Open Business Business 01/i }).click()
  await expect(page).toHaveURL(/overview/)
}

test.describe('FR-045 Business File Manager', () => {
  test('opens Files inside Development with mount and managed-file controls', async ({ page }) => {
    await chooseBusiness(page)
    await page.getByRole('link', { name: 'Files', exact: true }).click()
    await expect(page).toHaveURL(/\/files$/)
    await expect(page.getByRole('heading', { name: 'Files', exact: true })).toBeVisible()
    await expect(page.getByLabel('Absolute Windows root')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Add file' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Preview reconcile' })).toBeVisible()
  })

  test('fails a Business aggregation request outside the viewer scope', async ({ request }) => {
    const response = await request.get('/api/business/files?businessId=not-visible')
    expect(response.status()).toBe(400)
    expect((await response.json()).error).toMatch(/not visible/i)
  })
})
