const { test, expect } = require('@playwright/test')
const { loginAsOwner } = require('./e2e-auth')

// @req FR-161 — the owner creates a sales task from the real CRM page, sees it
//   listed with today's due state, starts it, completes it, and finds it under
//   the closed filter. Nothing here touches Development.
// @spec ADR-064; SEC-001
// @tested tests/e2e/fr161-sales-tasks.spec.js

const todayKey = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Bangkok', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())

test('FR-161 — a sales task is created, started and completed on the CRM page', async ({ page }) => {
  await loginAsOwner(page)
  await page.getByRole('button', { name: /Open Business Business 01/ }).click()
  await expect(page).toHaveURL(/\/overview$/)

  const bar = page.getByRole('navigation', { name: 'Domains' })
  await bar.getByRole('link', { name: 'CRM' }).click()
  await page.getByRole('link', { name: 'Sales Tasks' }).click()
  await expect(page).toHaveURL(/\/customer\/sales-tasks$/)
  await expect(page.getByRole('heading', { name: /งานขาย/ })).toBeVisible()

  const title = `โทรติดตามใบเสนอราคา ${Date.now().toString().slice(-6)}`
  await page.getByLabel('ชื่องาน', { exact: true }).fill(title)
  await page.getByLabel('ประเภท', { exact: true }).selectOption('CALL')
  await page.getByLabel('ความสำคัญ', { exact: true }).selectOption('HIGH')
  await page.getByLabel('วันกำหนด', { exact: true }).fill(todayKey())
  await page.getByLabel('เวลาเริ่ม', { exact: true }).fill('14:00')
  const created = page.waitForResponse((r) => r.request().method() === 'POST' && r.url().includes('/api/crm/sales-tasks'))
  await page.getByRole('button', { name: 'สร้างงาน', exact: true }).click()
  expect((await created).ok()).toBe(true)
  await expect(page.getByRole('status')).toContainText(/สร้างงาน TSK-\d{8}-\d{3} แล้ว/)

  const row = page.getByRole('row').filter({ hasText: title })
  await expect(row).toContainText('รอทำ')
  await expect(row).toContainText('วันนี้')
  await expect(row).toContainText('14:00')

  await row.getByRole('button', { name: 'เริ่ม', exact: true }).click()
  await expect(page.getByRole('row').filter({ hasText: title })).toContainText('กำลังทำ')
  await page.getByRole('row').filter({ hasText: title }).getByRole('button', { name: 'เสร็จ', exact: true }).click()
  await expect(page.getByRole('status')).toContainText('เสร็จ')
  await expect(page.getByRole('row').filter({ hasText: title })).toHaveCount(0)

  await page.getByRole('button', { name: 'ปิดแล้ว', exact: true }).click()
  await expect(page.getByRole('row').filter({ hasText: title })).toContainText('เสร็จ')
  await expect(page.locator('p[role="alert"]')).toHaveCount(0)
  await page.screenshot({ path: 'output/playwright/fr161-sales-tasks.png', fullPage: true })
})
