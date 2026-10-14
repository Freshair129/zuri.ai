const { test, expect } = require('@playwright/test')
const { loginAsOwner, readScope } = require('./e2e-auth')
const { signUpBusinessActor, switchBusinessActor } = require('./e2e-business-actor')

// @req FR-164 — the owner creates a supplier on the Procurement dashboard, a
//   purchase order against it on the real console (one line naming a counted
//   SKU, one free-text line) and sends it.
// @req FR-165 — posts two goods receipts against it, sees the order go from
//   partially received to received, and sees the Warehouse's on-hand for the
//   SKU rise by exactly what was received — recomputed from the ledger.
// @spec ADR-066; SEC-001
// @tested tests/e2e/fr164-procurement.spec.js

test('FR-164/FR-165 — a supplier, a purchase order and two receipts on the Procurement pages, landing in the Warehouse', async ({ page, request }) => {
  test.setTimeout(120000)
  await loginAsOwner(page)
  await page.getByRole('button', { name: /Open Business Business 01/ }).click()
  await expect(page).toHaveURL(/\/overview$/)
  const bar = page.getByRole('navigation', { name: 'Domains' })
  const status = page.getByRole('status')
  const tag = `${Date.now()}`.slice(-6)

  // A counted SKU to buy, created on the Inventory dashboard (FR-154). The bar
  // holds one SCM slot since ADR-069, and it opens on Inventory.
  await bar.getByRole('link', { name: 'SCM' }).click()
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

  // The supplier, on the Procurement dashboard — a sibling of Inventory in the
  // SCM sidebar rather than its own slot in the bar (ADR-069).
  await page.getByRole('link', { name: 'Procurement', exact: true }).click()
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

  // The purchase order: five boxes at 20 and a freight line at 100. Scoped to
  // the sidebar (`<aside>`): FR-170's in-canvas tab bar repeats this exact
  // label, so an unscoped locator is now ambiguous between the two.
  await page.locator('aside').getByRole('link', { name: 'Purchase Orders' }).click()
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

  // A second sent order checks that a self-receipt choice cannot carry across
  // records. It remains untouched so the final stock total comes from the first order.
  await page.getByLabel('รายการ 1', { exact: true }).fill(`ทดสอบรีเซ็ต ${tag}`)
  await page.getByLabel('ต้นทุน 1', { exact: true }).fill('1')
  const secondOrderCreated = page.waitForResponse((r) => r.request().method() === 'POST' && r.url().endsWith('/api/procurement/purchase-orders'))
  await page.getByRole('button', { name: 'สร้างใบสั่งซื้อ', exact: true }).click()
  expect((await secondOrderCreated).ok()).toBe(true)
  const secondCode = (await status.textContent()).match(/PO-\d{8}-\d{3}/)[0]
  const secondRow = () => page.getByRole('row').filter({ hasText: secondCode })
  await secondRow().getByRole('button', { name: 'ส่งให้ผู้ขาย', exact: true }).click()
  await expect(secondRow()).toContainText('ส่งผู้ขายแล้ว')

  const attestation = (poCode) => page.getByRole('checkbox', { name: `ยืนยันรับของใบสั่งซื้อ ${poCode} ด้วยตนเอง` })
  await row().getByRole('button', { name: code }).click()
  await expect(attestation(code)).not.toBeChecked()
  await attestation(code).check()
  await secondRow().getByRole('button', { name: secondCode }).click()
  await expect(attestation(secondCode)).not.toBeChecked()
  await row().getByRole('button', { name: code }).click()
  await expect(attestation(code)).not.toBeChecked()

  // FR-196: the creator's default receipt attempt is refused with no opt-in.
  await page.getByLabel('รับเข้า 1', { exact: true }).fill('1')
  await page.getByLabel('เลขที่ใบส่งของ', { exact: true }).fill(`DN-${tag}-SELF`)
  const defaultSelfReceipt = page.waitForResponse((r) => r.request().method() === 'POST' && r.url().includes('/receipts'))
  await page.getByRole('button', { name: 'บันทึกรับของ', exact: true }).click()
  const refusedReceipt = await defaultSelfReceipt
  expect(refusedReceipt.status()).toBe(409)
  expect(refusedReceipt.request().postDataJSON()).not.toHaveProperty('selfVerifyAttested')
  await expect(page.locator('p[role="alert"]')).toContainText('ให้ผู้ใช้อื่นบันทึกรับของ')
  await expect(attestation(code)).not.toBeChecked()

  // Explicit consent applies to this one receipt and is cleared after posting.
  await attestation(code).check()
  const selfReceipt = page.waitForResponse((r) => r.request().method() === 'POST' && r.url().includes('/receipts'))
  await page.getByRole('button', { name: 'บันทึกรับของ', exact: true }).click()
  const postedSelfReceipt = await selfReceipt
  expect(postedSelfReceipt.ok()).toBe(true)
  expect(postedSelfReceipt.request().postDataJSON()).toMatchObject({ selfVerifyAttested: true })
  await expect(status).toContainText(/บันทึกรับของ GRN-\d{8}-\d{3} · PO-\d{8}-\d{3} รับบางส่วน/)
  await expect(attestation(code)).not.toBeChecked()

  const scope = await readScope(page.request)
  const receiver = await signUpBusinessActor(request, scope.businesses.find((b) => b.code === 'BUS-001').id)
  await switchBusinessActor(page, receiver)

  // The separate receiver posts three boxes without consent.
  await row().getByRole('button', { name: code }).click()
  await page.getByLabel('รับเข้า 1', { exact: true }).fill('3')
  await page.getByLabel('เลขที่ใบส่งของ', { exact: true }).fill(`DN-${tag}-1`)
  const firstReceipt = page.waitForResponse((r) => r.request().method() === 'POST' && r.url().includes('/receipts'))
  await page.getByRole('button', { name: 'บันทึกรับของ', exact: true }).click()
  const postedOtherReceipt = await firstReceipt
  expect(postedOtherReceipt.ok()).toBe(true)
  expect(postedOtherReceipt.request().postDataJSON()).not.toHaveProperty('selfVerifyAttested')
  await expect(status).toContainText(/บันทึกรับของ GRN-\d{8}-\d{3} · PO-\d{8}-\d{3} รับบางส่วน/)
  await expect(row()).toContainText('รับบางส่วน')

  // The last box and freight complete the order and persist all five SKU units.
  await page.getByLabel('รับเข้า 1', { exact: true }).fill('1')
  await page.getByLabel('รับเข้า 2', { exact: true }).fill('1')
  const secondReceipt = page.waitForResponse((r) => r.request().method() === 'POST' && r.url().includes('/receipts'))
  await page.getByRole('button', { name: 'บันทึกรับของ', exact: true }).click()
  const postedFinalReceipt = await secondReceipt
  expect(postedFinalReceipt.ok()).toBe(true)
  expect(postedFinalReceipt.request().postDataJSON()).not.toHaveProperty('selfVerifyAttested')
  await expect(status).toContainText('รับครบ')
  await expect(row()).toHaveCount(0)
  await page.getByRole('button', { name: 'ทั้งหมด', exact: true }).click()
  await expect(row()).toContainText('รับของครบแล้ว')
  await expect(page.locator('p[role="alert"]')).toHaveCount(0)
  await page.screenshot({ path: 'output/playwright/fr164-procurement.png', fullPage: true })

  // Inventory counts what the two receipts posted, recomputed from the ledger.
  // It is a sibling of Procurement under SCM, so the sidebar reaches it.
  await page.getByRole('link', { name: 'Inventory', exact: true }).click()
  await expect(page).toHaveURL(/\/inventory$/)
  await expect(page.getByRole('row').filter({ hasText: sku })).toContainText('5 EA')
})
