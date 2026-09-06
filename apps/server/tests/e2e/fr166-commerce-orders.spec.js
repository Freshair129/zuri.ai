const { test, expect } = require('@playwright/test')
const { loginAsOwner } = require('./e2e-auth')

// @req FR-166 — the owner creates a sales order on the real Commerce page,
//   confirms it and completes it.
// @req FR-163 — records a payment against it, verifies it, and sees the order
//   turn PAID and the dashboard count the verified money.
// @spec ADR-065; SEC-001
// @tested tests/e2e/fr166-commerce-orders.spec.js

test('FR-166/FR-163 — an order is created, paid, verified and completed on the Commerce pages', async ({ page }) => {
  await loginAsOwner(page)
  await page.getByRole('button', { name: /Open Business Business 01/ }).click()
  await expect(page).toHaveURL(/\/overview$/)

  const bar = page.getByRole('navigation', { name: 'Domains' })
  await bar.getByRole('link', { name: 'Commerce' }).click()
  await expect(page).toHaveURL(/\/commerce$/)
  await expect(page.getByRole('heading', { name: /ยอดขายและการชำระเงิน/ })).toBeVisible()
  await page.getByRole('link', { name: 'Orders' }).click()
  await expect(page).toHaveURL(/\/commerce\/orders$/)
  await expect(page.getByRole('heading', { name: 'ออเดอร์ (Orders)', exact: true })).toBeVisible()

  const item = `ชุดของขวัญผู้บริหาร ${Date.now().toString().slice(-6)}`
  await page.getByLabel('รายการ 1', { exact: true }).fill(item)
  await page.getByLabel('จำนวน 1', { exact: true }).fill('2')
  await page.getByLabel('ราคา 1', { exact: true }).fill('500')
  const created = page.waitForResponse((r) => r.request().method() === 'POST' && r.url().endsWith('/api/commerce/orders'))
  await page.getByRole('button', { name: 'สร้างออเดอร์', exact: true }).click()
  expect((await created).ok()).toBe(true)
  const status = page.getByRole('status')
  await expect(status).toContainText(/สร้างออเดอร์ ORD-\d{8}-\d{3} ยอดรวม 1,000\.00 บาท/)
  const code = (await status.textContent()).match(/ORD-\d{8}-\d{3}/)[0]

  const row = () => page.getByRole('row').filter({ hasText: code })
  await expect(row()).toContainText('ยังไม่ชำระ')
  await row().getByRole('button', { name: 'ยืนยัน', exact: true }).click()
  await expect(row()).toContainText('ยืนยันแล้ว')

  // Open the order, record a transfer of the full amount, verify it.
  await row().getByRole('button', { name: code }).click()
  await page.getByLabel('จำนวนเงิน', { exact: true }).fill('1000')
  // Not the order code: the payments table would then match the order-row filter below.
  await page.getByLabel('อ้างอิงธนาคาร', { exact: true }).fill(`E2E-REF-${Date.now()}`)
  const recorded = page.waitForResponse((r) => r.request().method() === 'POST' && r.url().includes('/payments'))
  await page.getByRole('button', { name: 'บันทึกการชำระ', exact: true }).click()
  expect((await recorded).ok()).toBe(true)
  await expect(status).toContainText(/บันทึก PAY-\d{8}-\d{3}/)
  await expect(row()).toContainText('รอ 1,000.00')
  await page.getByRole('button', { name: 'ตรวจแล้ว', exact: true }).click()
  await expect(status).toContainText('ชำระครบ')
  await expect(row()).toContainText('ชำระครบ')

  await row().getByRole('button', { name: 'เสร็จสิ้น', exact: true }).click()
  await expect(status).toContainText('เสร็จสิ้น')
  await expect(row()).toHaveCount(0)
  await page.getByRole('button', { name: 'ทั้งหมด', exact: true }).click()
  await expect(row()).toContainText('เสร็จสิ้น')
  await expect(page.locator('p[role="alert"]')).toHaveCount(0)

  // The dashboard counts the verified money today.
  await page.getByRole('link', { name: 'Dashboard' }).click()
  await expect(page).toHaveURL(/\/commerce$/)
  await page.getByRole('button', { name: 'วันนี้', exact: true }).click()
  await expect(page.getByText('รายได้ที่ตรวจสอบแล้ว (สุทธิ)')).toBeVisible()
  await expect(page.getByText(/฿1,000\.00/).first()).toBeVisible()
  await page.screenshot({ path: 'output/playwright/fr166-commerce-orders.png', fullPage: true })
})
