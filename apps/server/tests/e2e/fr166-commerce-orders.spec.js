const { test, expect } = require('@playwright/test')
const { loginAsOwner, readScope } = require('./e2e-auth')
const { signUpBusinessActor, switchBusinessActor } = require('./e2e-business-actor')

// @req FR-166 — the owner creates a sales order on the real Commerce page,
//   confirms it and completes it.
// @req FR-163 — records a payment against it, verifies it, and sees the order
//   turn PAID and the dashboard count the verified money.
// @req FR-196 — self-verification requires explicit per-payment attestation; another actor needs none.
// @spec ADR-065; SEC-001
// @tested tests/e2e/fr166-commerce-orders.spec.js

test('FR-166/FR-163 — an order is created, paid, verified and completed on the Commerce pages', async ({ page, request }) => {
  test.setTimeout(120000)
  await loginAsOwner(page)
  await page.getByRole('button', { name: /Open Business Business 01/ }).click()
  await expect(page).toHaveURL(/\/overview$/)

  const bar = page.getByRole('navigation', { name: 'Domains' })
  // ADR-069: the bar holds one SCM slot that opens on Inventory; Order
  // Management is a sibling in the sidebar beside it.
  await bar.getByRole('link', { name: 'SCM' }).click()
  await page.getByRole('link', { name: 'Order Management', exact: true }).click()
  await expect(page).toHaveURL(/\/commerce$/)
  await expect(page.getByRole('heading', { name: /ยอดขายและการชำระเงิน/ })).toBeVisible()
  // Scoped to the sidebar (`<aside>`): FR-170's in-canvas tab bar repeats this
  // exact label too, so `exact: true` alone (which only rules out a substring
  // match against `Purchase Orders`, ADR-069) is no longer enough on its own.
  await page.locator('aside').getByRole('link', { name: 'Orders', exact: true }).click()
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

  // Open the order and record two payments so consent must remain bound to one.
  await row().getByRole('button', { name: code }).click()
  await page.getByLabel('จำนวนเงิน', { exact: true }).fill('500')
  // Not the order code: the payments table would then match the order-row filter below.
  await page.getByLabel('อ้างอิงธนาคาร', { exact: true }).fill(`E2E-REF-1-${Date.now()}`)
  const recorded = page.waitForResponse((r) => r.request().method() === 'POST' && r.url().includes('/payments'))
  await page.getByRole('button', { name: 'บันทึกการชำระ', exact: true }).click()
  expect((await recorded).ok()).toBe(true)
  await expect(status).toContainText(/บันทึก PAY-\d{8}-\d{3}/)
  const firstPaymentCode = (await status.textContent()).match(/PAY-\d{8}-\d{3}/)[0]
  await page.getByLabel('จำนวนเงิน', { exact: true }).fill('500')
  await page.getByLabel('อ้างอิงธนาคาร', { exact: true }).fill(`E2E-REF-2-${Date.now()}`)
  const secondRecorded = page.waitForResponse((r) => r.request().method() === 'POST' && r.url().includes('/payments'))
  await page.getByRole('button', { name: 'บันทึกการชำระ', exact: true }).click()
  expect((await secondRecorded).ok()).toBe(true)
  await expect(status).toContainText(/บันทึก PAY-\d{8}-\d{3}/)
  const secondPaymentCode = (await status.textContent()).match(/PAY-\d{8}-\d{3}/)[0]
  await expect(row()).toContainText('รอ 1,000.00')

  const paymentRow = (paymentCode) => page.getByRole('row').filter({ hasText: paymentCode })
  const selfVerify = (paymentCode) => page.getByRole('checkbox', { name: `ยืนยันตรวจการชำระ ${paymentCode} ด้วยตนเอง` })
  await expect(selfVerify(firstPaymentCode)).not.toBeChecked()
  await expect(selfVerify(secondPaymentCode)).not.toBeChecked()

  // The recorder's default verification is refused, with no hidden opt-in.
  const defaultSelfVerify = page.waitForResponse((r) => r.request().method() === 'PATCH' && r.url().includes('/api/commerce/payments/'))
  await paymentRow(firstPaymentCode).getByRole('button', { name: 'ตรวจแล้ว', exact: true }).click()
  const refusedSelfVerify = await defaultSelfVerify
  expect(refusedSelfVerify.status()).toBe(409)
  expect(refusedSelfVerify.request().postDataJSON()).not.toHaveProperty('selfVerifyAttested')
  await expect(page.locator('p[role="alert"]')).toContainText('ให้ผู้ใช้อื่นตรวจสอบ')
  await expect(selfVerify(firstPaymentCode)).not.toBeChecked()

  // Opting into the first payment does not select the second payment's control.
  await selfVerify(firstPaymentCode).check()
  const explicitSelfVerify = page.waitForResponse((r) => r.request().method() === 'PATCH' && r.url().includes('/api/commerce/payments/'))
  await paymentRow(firstPaymentCode).getByRole('button', { name: 'ตรวจแล้ว', exact: true }).click()
  const verifiedSelfPayment = await explicitSelfVerify
  expect(verifiedSelfPayment.ok()).toBe(true)
  expect(verifiedSelfPayment.request().postDataJSON()).toMatchObject({ action: 'VERIFY', selfVerifyAttested: true })
  await expect(paymentRow(firstPaymentCode)).toContainText('ตรวจแล้ว')
  await expect(selfVerify(secondPaymentCode)).not.toBeChecked()

  // The same recorder is still refused on the other payment; no record choice carried over.
  const secondDefaultVerify = page.waitForResponse((r) => r.request().method() === 'PATCH' && r.url().includes('/api/commerce/payments/'))
  await paymentRow(secondPaymentCode).getByRole('button', { name: 'ตรวจแล้ว', exact: true }).click()
  const refusedSecondVerify = await secondDefaultVerify
  expect(refusedSecondVerify.status()).toBe(409)
  expect(refusedSecondVerify.request().postDataJSON()).not.toHaveProperty('selfVerifyAttested')
  await expect(page.locator('p[role="alert"]')).toContainText('ให้ผู้ใช้อื่นตรวจสอบ')

  // FR-196: a separate authenticated person verifies the recorded payment.
  const scope = await readScope(page.request)
  const verifier = await signUpBusinessActor(request, scope.businesses.find((b) => b.code === 'BUS-001').id)
  await switchBusinessActor(page, verifier)
  await row().getByRole('button', { name: code }).click()
  await expect(selfVerify(secondPaymentCode)).not.toBeChecked()
  const otherActorVerify = page.waitForResponse((r) => r.request().method() === 'PATCH' && r.url().includes('/api/commerce/payments/'))
  await paymentRow(secondPaymentCode).getByRole('button', { name: 'ตรวจแล้ว', exact: true }).click()
  const verifiedOtherPayment = await otherActorVerify
  expect(verifiedOtherPayment.ok()).toBe(true)
  expect(verifiedOtherPayment.request().postDataJSON()).not.toHaveProperty('selfVerifyAttested')
  await expect(status).toContainText('ชำระครบ')
  await expect(row()).toContainText('ชำระครบ')

  await row().getByRole('button', { name: 'เสร็จสิ้น', exact: true }).click()
  await expect(status).toContainText('เสร็จสิ้น')
  await expect(row()).toHaveCount(0)
  await page.getByRole('button', { name: 'ทั้งหมด', exact: true }).click()
  await expect(row()).toContainText('เสร็จสิ้น')
  await expect(page.locator('p[role="alert"]')).toHaveCount(0)

  // The dashboard counts the verified money today. Under SCM each child's
  // Dashboard entry is named after the child, so four of them can share one
  // menu without four links called Dashboard (ADR-069).
  await page.getByRole('link', { name: 'Order Management', exact: true }).click()
  await expect(page).toHaveURL(/\/commerce$/)
  await page.getByRole('button', { name: 'วันนี้', exact: true }).click()
  await expect(page.getByText('รายได้ที่ตรวจสอบแล้ว (สุทธิ)')).toBeVisible()
  await expect(page.getByText(/฿1,000\.00/).first()).toBeVisible()
  await page.screenshot({ path: 'output/playwright/fr166-commerce-orders.png', fullPage: true })
})
