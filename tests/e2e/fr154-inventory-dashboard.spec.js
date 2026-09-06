const { test, expect } = require('@playwright/test')
const { loginAsOwner } = require('./e2e-auth')

// @req FR-154 — the owner creates a category, a product master and two SKUs
//   (one counted, one not) from the real dashboard.
// @req FR-155 — a receipt appended from the dashboard changes the on-hand the
//   table shows, recomputed by the server; the uncounted SKU shows no number.
// @spec SEC-001
// @tested tests/e2e/fr154-inventory-dashboard.spec.js

test('FR-154/FR-155 — the Inventory dashboard creates catalogue rows and records a receipt', async ({ page }) => {
  await loginAsOwner(page)
  await page.getByRole('button', { name: /Open Business Business 01/ }).click()
  await expect(page).toHaveURL(/\/overview$/)

  // The domain is in the bar and its page belongs to it.
  const bar = page.getByRole('navigation', { name: 'Domains' })
  await bar.getByRole('link', { name: 'Inventory' }).click()
  await expect(page).toHaveURL(/\/inventory$/)
  await expect(page.getByRole('heading', { name: 'คลังสินค้า' })).toBeVisible()

  const tag = `${Date.now()}`.slice(-6)
  const category = `cat-${tag}`
  const master = `PM-${tag}`
  const counted = `SKU-${tag}-A`
  const uncounted = `SKU-${tag}-SVC`

  await page.getByLabel('รหัส', { exact: true }).first().fill(category)
  await page.getByLabel('ชื่อ (ไทย)', { exact: true }).first().fill('หมวด e2e')
  await page.getByLabel('ชื่อ (อังกฤษ)', { exact: true }).first().fill('E2E category')
  await page.getByRole('button', { name: 'สร้างหมวดหมู่', exact: true }).click()
  await expect(page.getByRole('status')).toContainText(`สร้างหมวดหมู่ ${category} แล้ว`)

  await page.getByLabel('รหัส', { exact: true }).nth(1).fill(master)
  await page.getByLabel('หมวดหมู่', { exact: true }).selectOption({ label: `${category} · หมวด e2e` })
  await page.getByLabel('ชื่อ (ไทย)', { exact: true }).nth(1).fill('สินค้าหลัก e2e')
  await page.getByLabel('ชื่อ (อังกฤษ)', { exact: true }).nth(1).fill('E2E master')
  await page.getByRole('button', { name: 'สร้างสินค้าหลัก', exact: true }).click()
  await expect(page.getByRole('status')).toContainText(`สร้างสินค้าหลัก ${master} แล้ว`)

  await page.getByLabel('รหัส SKU', { exact: true }).fill(counted)
  await page.getByLabel('สินค้าหลัก', { exact: true }).selectOption({ label: `${master} · สินค้าหลัก e2e` })
  await page.getByLabel('ชื่อ SKU', { exact: true }).fill('Counted item')
  await page.getByLabel('Safety stock', { exact: true }).fill('3')
  await page.getByRole('button', { name: 'สร้าง SKU', exact: true }).click()
  await expect(page.getByRole('status')).toContainText(`สร้าง SKU ${counted} (นับสต๊อก) แล้ว`)

  await page.getByLabel('รหัส SKU', { exact: true }).fill(uncounted)
  await page.getByLabel('สินค้าหลัก', { exact: true }).selectOption({ label: `${master} · สินค้าหลัก e2e` })
  await page.getByLabel('นโยบายสต๊อก', { exact: true }).selectOption('UNTRACKED')
  await page.getByRole('button', { name: 'สร้าง SKU', exact: true }).click()
  await expect(page.getByRole('status')).toContainText(`สร้าง SKU ${uncounted} (ไม่นับสต๊อก) แล้ว`)

  const countedRow = page.getByRole('row').filter({ hasText: counted })
  const uncountedRow = page.getByRole('row').filter({ hasText: uncounted })
  await expect(countedRow).toContainText('0 EA')
  await expect(uncountedRow).toContainText('ไม่นับสต๊อก')
  await expect(uncountedRow).not.toContainText('EA')

  await page.getByLabel('SKU', { exact: true }).selectOption({ label: `${counted} · Counted item` })
  await page.getByLabel('จำนวน', { exact: true }).fill('12')
  await page.getByLabel('อ้างอิง (PO / ใบส่งของ)', { exact: true }).fill('PO-E2E')
  const recorded = page.waitForResponse((response) => response.request().method() === 'POST' && response.url().includes('/api/inventory/stock-movements'))
  await page.getByRole('button', { name: 'บันทึก', exact: true }).click()
  expect((await recorded).ok()).toBe(true)
  await expect(page.getByRole('status')).toContainText('รับเข้า 12 หน่วย · คงเหลือ 0 → 12')
  await expect(countedRow).toContainText('12 EA')
  await expect(page.locator('p[role="alert"]')).toHaveCount(0)

  // Reload: the number survives because it is recomputed from the ledger, not remembered by the page.
  await page.reload()
  await expect(page.getByRole('row').filter({ hasText: counted })).toContainText('12 EA')
  await page.screenshot({ path: 'output/playwright/fr154-inventory-dashboard.png', fullPage: true })
})
