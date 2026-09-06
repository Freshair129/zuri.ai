const { test, expect } = require('@playwright/test')
const { loginAsOwner } = require('./e2e-auth')

// @req FR-160 — the owner creates a supplier on the Procurement dashboard, a
//   purchase order against it on the real console (one line naming a counted
//   SKU, one free-text line) and sends it.
// @req FR-161 — posts two goods receipts against it, sees the order go from
//   partially received to received, and sees the Warehouse's on-hand for the
//   SKU rise by exactly what was received — recomputed from the ledger.
// @spec ADR-066; SEC-001
// @tested tests/e2e/fr160-procurement.spec.js

test('FR-160/FR-161 — a supplier, a purchase order and two receipts on the Procurement pages, landing in the Warehouse', async ({ page }) => {
  test.setTimeout(120000)
  await loginAsOwner(page)
  await page.getByRole('button', { name: /Open Business Business 01/ }).click()
  await expect(page).toHaveURL(/\/overview$/)
  const bar = page.getByRole('navigation', { name: 'Domains' })
  const status = page.getByRole('status')
  const tag = `${Date.now()}`.slice(-6)

  // A counted SKU to buy, created on the Warehouse dashboard (FR-154).
  await bar.getByRole('link', { name: 'Warehouse' }).click()
  await expect(page).toHaveURL(/\/inventory$/)
  const category = `buy-${tag}`
  const master = `PM-BUY-${tag}`
  const sku = `SKU-BUY-${tag}`
  await page.getByLabel('รหัส', { exact: true }).first().fill(category)
  await page.getByLabel('ชื่อ (ไทย)', { exact: true }).first().fill('หมวดจัดซื้อ e2e')
  await page.getByLabel('ชื่อ (อังกฤษ)', { exact: true }).first().fill('E2E buying')
  await page.getByRole('button', { name: 'สร้างหมวดหมู่', exact: true }).click()
  await expect(status).toContainText(`สร้างหมวดหมู่ ${category} แล้ว`)
  await page.getByLabel('รหัส', { exact: true }).nth(1).fill(master)
  await page.getByLabel('หมวดหมู่', { exact: true }).selectOption({ label: `${category} · หมวดจัดซื้อ e2e` })
  await page.getByLabel('ชื่อ (ไทย)', { exact: true }).nth(1).fill('กล่อง e2e')
  await page.getByLabel('ชื่อ (อังกฤษ)', { exact: true }).nth(1).fill('E2E box')
  await page.getByRole('button', { name: 'สร้างสินค้าหลัก', exact: true }).click()
  await expect(status).toContainText(`สร้างสินค้าหลัก ${master} แล้ว`)
  await page.getByLabel('รหัส SKU', { exact: true }).fill(sku)
  await page.getByLabel('สินค้าหลัก', { exact: true }).selectOption({ label: `${master} · กล่อง e2e` })
  await page.getByLabel('ชื่อ SKU', { exact: true }).fill('Bought box')
  await page.getByRole('button', { name: 'สร้าง SKU', exact: true }).click()
  await expect(status).toContainText(`สร้าง SKU ${sku} (นับสต๊อก) แล้ว`)

  // The supplier, on the Procurement dashboard.
  await bar.getByRole('link', { name: 'Procurement' }).click()
  await expect(page).toHaveURL(/\/procurement$/)
  await expect(page.getByRole('heading', { name: 'จัดซื้อและผู้ขาย', exact: true })).toBeVisible()
  const supplierCode = `SUP-${tag}`
  await page.getByLabel('รหัสผู้ขาย', { exact: true }).fill(supplierCode)
  await page.getByLabel('ชื่อผู้ขาย', { exact: true }).fill('ผู้ขาย e2e')
  await page.getByLabel('Lead time (วัน)', { exact: true }).fill('5')
  const supplierCreated = page.waitForResponse((r) => r.request().method() === 'POST' && r.url().endsWith('/api/procurement/suppliers'))
  await page.getByRole('button', { name: 'สร้างผู้ขาย', exact: true }).click()
  expect((await supplierCreated).ok()).toBe(true)
  await expect(status).toContainText(`สร้างผู้ขาย ${supplierCode} แล้ว`)
  await expect(page.getByRole('row').filter({ hasText: supplierCode })).toContainText('5 วัน')

  // The purchase order: five boxes at 20 and a freight line at 100.
  await page.getByRole('link', { name: 'Purchase Orders' }).click()
  await expect(page).toHaveURL(/\/procurement\/purchase-orders$/)
  await expect(page.getByRole('heading', { name: 'ใบสั่งซื้อ (Purchase Orders)', exact: true })).toBeVisible()
  await page.getByLabel('ผู้ขาย', { exact: true }).selectOption({ label: `${supplierCode} · ผู้ขาย e2e` })
  await page.getByLabel('สินค้า 1', { exact: true }).selectOption({ label: `${sku} · Bought box` })
  await page.getByLabel('จำนวน 1', { exact: true }).fill('5')
  await page.getByLabel('ต้นทุน 1', { exact: true }).fill('20')
  await page.getByRole('button', { name: '+ เพิ่มรายการ', exact: true }).click()
  await page.getByLabel('รายการ 2', { exact: true }).fill('ค่าขนส่ง')
  await page.getByLabel('จำนวน 2', { exact: true }).fill('1')
  await page.getByLabel('ต้นทุน 2', { exact: true }).fill('100')
  const created = page.waitForResponse((r) => r.request().method() === 'POST' && r.url().endsWith('/api/procurement/purchase-orders'))
  await page.getByRole('button', { name: 'สร้างใบสั่งซื้อ', exact: true }).click()
  expect((await created).ok()).toBe(true)
  await expect(status).toContainText(/สร้างใบสั่งซื้อ PO-\d{8}-\d{3} ยอดรวม 200\.00 บาท/)
  const code = (await status.textContent()).match(/PO-\d{8}-\d{3}/)[0]

  const row = () => page.getByRole('row').filter({ hasText: code })
  await expect(row()).toContainText('ร่าง')
  await row().getByRole('button', { name: 'ส่งให้ผู้ขาย', exact: true }).click()
  await expect(row()).toContainText('ส่งผู้ขายแล้ว')

  // First receipt: three boxes — partially received, the Warehouse holds three.
  await row().getByRole('button', { name: code }).click()
  await page.getByLabel('รับเข้า 1', { exact: true }).fill('3')
  await page.getByLabel('เลขที่ใบส่งของ', { exact: true }).fill(`DN-${tag}-1`)
  const firstReceipt = page.waitForResponse((r) => r.request().method() === 'POST' && r.url().includes('/receipts'))
  await page.getByRole('button', { name: 'บันทึกรับของ', exact: true }).click()
  expect((await firstReceipt).ok()).toBe(true)
  await expect(status).toContainText(/บันทึกรับของ GRN-\d{8}-\d{3} · PO-\d{8}-\d{3} รับบางส่วน/)
  await expect(row()).toContainText('รับบางส่วน')

  // Second receipt: the last two boxes and the freight — the order is received and leaves the open list.
  await page.getByLabel('รับเข้า 1', { exact: true }).fill('2')
  await page.getByLabel('รับเข้า 2', { exact: true }).fill('1')
  const secondReceipt = page.waitForResponse((r) => r.request().method() === 'POST' && r.url().includes('/receipts'))
  await page.getByRole('button', { name: 'บันทึกรับของ', exact: true }).click()
  expect((await secondReceipt).ok()).toBe(true)
  await expect(status).toContainText('รับครบ')
  await expect(row()).toHaveCount(0)
  await page.getByRole('button', { name: 'ทั้งหมด', exact: true }).click()
  await expect(row()).toContainText('รับของครบแล้ว')
  await expect(page.locator('p[role="alert"]')).toHaveCount(0)
  await page.screenshot({ path: 'output/playwright/fr160-procurement.png', fullPage: true })

  // The Warehouse counts what the two receipts posted, recomputed from the ledger.
  await bar.getByRole('link', { name: 'Warehouse' }).click()
  await expect(page).toHaveURL(/\/inventory$/)
  await expect(page.getByRole('row').filter({ hasText: sku })).toContainText('5 EA')
})
