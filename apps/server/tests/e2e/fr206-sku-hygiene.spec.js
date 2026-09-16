const { test, expect } = require('@playwright/test')
const { loginAsOwner } = require('./e2e-auth')

// @req FR-201 — from the real dashboard the owner creates a SERVICE master;
//   with it selected the SKU form offers no stock policy at all and the SKU
//   it creates is a service (บริการ), while a GOOD master still offers
//   counted / uncounted and never SERVICE.
// @req FR-206 — the SKU Hygiene tab renders the report for the active
//   Business, computed by the server, with the lifecycle form and the
//   replenishment card beside it.
// @req FR-205 — a PHASE_OUT run from the hygiene tab's form lands on the
//   server and the dashboard shows the new status.
// @spec SEC-001
// @tested tests/e2e/fr206-sku-hygiene.spec.js

test('FR-201/FR-205/FR-206 — a service master narrows the SKU form, and the SKU Hygiene tab reports and acts', async ({ page }) => {
  await loginAsOwner(page)
  await page.getByRole('button', { name: /Open Business Business 01/ }).click()
  await expect(page).toHaveURL(/\/overview$/)

  const bar = page.getByRole('navigation', { name: 'Domains' })
  await bar.getByRole('link', { name: 'SCM' }).click()
  await expect(page).toHaveURL(/\/inventory$/)
  await expect(page.getByRole('heading', { name: 'คลังสินค้า' })).toBeVisible()

  const tag = `${Date.now()}`.slice(-6)
  const category = `svc-cat-${tag}`
  const goodMaster = `PM-G-${tag}`
  const serviceMaster = `PM-S-${tag}`
  const goodSku = `SKU-G-${tag}`
  const serviceSku = `SKU-S-${tag}`

  await page.getByLabel('รหัส', { exact: true }).first().fill(category)
  await page.getByLabel('ชื่อ (ไทย)', { exact: true }).first().fill('หมวด hygiene')
  await page.getByLabel('ชื่อ (อังกฤษ)', { exact: true }).first().fill('Hygiene category')
  await page.getByRole('button', { name: 'สร้างหมวดหมู่', exact: true }).click()
  await expect(page.getByRole('status')).toContainText(`สร้างหมวดหมู่ ${category} แล้ว`)

  // A GOOD master that declares one variant axis.
  await page.getByLabel('รหัส', { exact: true }).nth(1).fill(goodMaster)
  await page.getByLabel('หมวดหมู่', { exact: true }).selectOption({ label: `${category} · หมวด hygiene` })
  await page.getByLabel('ชื่อ (ไทย)', { exact: true }).nth(1).fill('แก้ว')
  await page.getByLabel('ชื่อ (อังกฤษ)', { exact: true }).nth(1).fill('Tumbler')
  await page.getByLabel('แกน variant (คั่นด้วยจุลภาค เช่น color, size)', { exact: true }).fill('color')
  await page.getByRole('button', { name: 'สร้างสินค้าหลัก', exact: true }).click()
  await expect(page.getByRole('status')).toContainText(`สร้างสินค้าหลัก ${goodMaster} แล้ว · สินค้า (good)`)

  // A SERVICE master: the axis field disappears once บริการ is chosen.
  await page.getByLabel('รหัส', { exact: true }).nth(1).fill(serviceMaster)
  await page.getByLabel('หมวดหมู่', { exact: true }).selectOption({ label: `${category} · หมวด hygiene` })
  await page.getByLabel('ชื่อ (ไทย)', { exact: true }).nth(1).fill('บริการสลัก')
  await page.getByLabel('ชื่อ (อังกฤษ)', { exact: true }).nth(1).fill('Engraving')
  await page.getByLabel('ประเภทสินค้าหลัก', { exact: true }).selectOption('SERVICE')
  await expect(page.getByLabel('แกน variant (คั่นด้วยจุลภาค เช่น color, size)', { exact: true })).toHaveCount(0)
  await page.getByRole('button', { name: 'สร้างสินค้าหลัก', exact: true }).click()
  await expect(page.getByRole('status')).toContainText(`สร้างสินค้าหลัก ${serviceMaster} แล้ว · บริการ (service)`)

  // Under the GOOD master the form offers counted / uncounted and one field per axis; SERVICE is never an option.
  await page.getByLabel('สินค้าหลัก', { exact: true }).selectOption({ label: `${goodMaster} · แก้ว` })
  const policy = page.getByLabel('นโยบายสต๊อก', { exact: true })
  await expect(policy).toBeVisible()
  await expect(policy.locator('option[value="SERVICE"]')).toHaveCount(0)
  await page.getByLabel('รหัส SKU', { exact: true }).fill(goodSku)
  await page.getByLabel('ชื่อ SKU', { exact: true }).fill('Tumbler black')
  await page.getByLabel('variant: color', { exact: true }).fill('Black')
  await page.getByRole('button', { name: 'สร้าง SKU', exact: true }).click()
  await expect(page.getByRole('status')).toContainText(`สร้าง SKU ${goodSku} (นับสต๊อก) แล้ว`)

  // Under the SERVICE master there is no policy to choose: the master decided.
  await page.getByLabel('สินค้าหลัก', { exact: true }).selectOption({ label: `${serviceMaster} · บริการสลัก` })
  await expect(page.getByLabel('นโยบายสต๊อก', { exact: true })).toHaveCount(0)
  await expect(page.getByText('SKU ทุกตัวใต้มันเป็นบริการ')).toBeVisible()
  await page.getByLabel('รหัส SKU', { exact: true }).fill(serviceSku)
  await page.getByLabel('ชื่อ SKU', { exact: true }).fill('Engraving service')
  await page.getByRole('button', { name: 'สร้าง SKU', exact: true }).click()
  await expect(page.getByRole('status')).toContainText(`สร้าง SKU ${serviceSku} (บริการ) แล้ว`)
  await expect(page.getByRole('row').filter({ hasText: serviceSku })).toContainText('บริการ')

  // The SKU Hygiene tab: the report, the lifecycle form and the replenishment card.
  await page.getByRole('link', { name: 'SKU Hygiene', exact: true }).first().click()
  await expect(page).toHaveURL(/\/inventory\/hygiene$/)
  await expect(page.getByRole('heading', { name: 'SKU Hygiene' })).toBeVisible()
  await expect(page.getByText('ข้อค้นพบทั้งหมด')).toBeVisible()
  await expect(page.getByText('ควรสั่งซื้อ').first()).toBeVisible()
  // The counted SKU has no barcode yet, so the report names it.
  await expect(page.getByRole('row').filter({ hasText: goodSku }).first()).toContainText('ไม่มีบาร์โค้ด/รหัสคู่ค้า')

  // PHASE_OUT from the form: the action lands on the server and the dashboard shows it.
  await page.getByLabel('การกระทำ', { exact: true }).selectOption('PHASE_OUT')
  await page.getByLabel('SKU', { exact: true }).selectOption({ label: `${goodSku} · Tumbler black · ใช้งาน` })
  await page.getByLabel('เหตุผล', { exact: true }).fill('e2e phase-out')
  const acted = page.waitForResponse((response) => response.request().method() === 'PATCH' && response.url().includes('/api/inventory/products/'))
  await page.getByRole('button', { name: 'ดำเนินการ', exact: true }).click()
  expect((await acted).ok()).toBe(true)
  await expect(page.getByRole('status')).toContainText(`เลิกขาย (PHASE_OUT) ${goodSku} แล้ว`)
  await expect(page.locator('p[role="alert"]')).toHaveCount(0)

  await page.getByRole('link', { name: 'Dashboard', exact: true }).first().click()
  await expect(page).toHaveURL(/\/inventory$/)
  await expect(page.getByRole('row').filter({ hasText: goodSku })).toContainText('เลิกขาย')
  await page.screenshot({ path: 'output/playwright/fr206-sku-hygiene.png', fullPage: true })
})
