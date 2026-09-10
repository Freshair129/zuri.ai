const { test, expect } = require('@playwright/test')
const { loginAsOwner, readScope } = require('./e2e-auth')

// @req FR-165 — actual receiving intake, persisted printable detail and paged registry.
// @spec ADR-066; SEC-001
// @tested tests/e2e/fr165-receipt-workstation.spec.js
test('receipt workstation posts actual quantities and reloads the persisted voucher', async ({ page }) => {
  await loginAsOwner(page)
  await page.getByRole('button', { name: /Open Business Business 01/ }).click()
  await expect(page).toHaveURL(/\/overview$/)
  const scope = await readScope(page.request)
  const businessId = scope.businesses.find(row => row.name === 'Business 01').id
  const tag = Date.now().toString()
  const send = async (url, data, method = 'POST') => {
    const response = await page.request.fetch(url, { method, data })
    expect(response.ok(), await response.text()).toBeTruthy()
    return response.json()
  }
  const supplier = await send('/api/procurement/suppliers', { businessId, code: `GRN-E2E-${tag}`, name: 'Receipt fixture supplier' })
  const order = await send('/api/procurement/purchase-orders', { businessId, supplierId: supplier.id, lines: [{ description: `Packing ${tag}`, qty: 3, unitCost: 10 }] })
  await send(`/api/procurement/purchase-orders/${order.id}`, { action: 'SEND', version: order.version }, 'PATCH')
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  await page.goto('/procurement/receipts')
  await page.getByLabel('ใบสั่งซื้อสำหรับรับสินค้า').selectOption(order.id)
  const qty = page.getByLabel(`จำนวนรับ Packing ${tag}`)
  await expect(qty).toHaveValue('')
  await qty.fill('2')
  await page.getByLabel('เลขที่ใบส่งของ', { exact: true }).fill(`DO-${tag}`)
  await page.getByRole('button', { name: 'บันทึกรับของ', exact: true }).click()
  await expect(page.getByRole('status')).toContainText('บันทึกรับสินค้า GRN-')
  const voucher = page.locator('.receipt-print')
  await expect(voucher).toContainText(order.code)
  await expect(voucher).toContainText(`Packing ${tag}`)
  await expect(voucher).toContainText('รายการไม่นับสต๊อก')
  await expect(voucher).not.toContainText('เข้าคลังแล้ว')
  const code = (await voucher.getByRole('heading').textContent()).match(/GRN-\d+-\d+/)[0]
  const day = code.split('-')[1]
  await expect(voucher).toContainText(`${day.slice(0, 4)}-${day.slice(4, 6)}-${day.slice(6, 8)}`)
  await page.reload()
  await page.getByRole('button', { name: code, exact: true }).click()
  await expect(voucher).toContainText(`DO-${tag}`)
  await page.getByLabel('ใบสั่งซื้อสำหรับรับสินค้า').selectOption(order.id)
  await expect(page.locator('legend').filter({ hasText: `Packing ${tag}` })).toContainText('ค้างรับ 1')
  await page.screenshot({ path: 'output/playwright/fr165-receipt-workstation.png', fullPage: true })
  await voucher.screenshot({ path: 'output/playwright/fr165-receipt-voucher.png' })
  expect(errors).toEqual([])
  expect(await page.locator('[data-nextjs-dialog]').count()).toBe(0)
})

test('late receipt response cannot populate a newly selected Business', async ({ page }) => {
  const { PrismaClient } = require('@prisma/client')
  const { e2eTarget } = require('./e2e-target')
  const db = new PrismaClient({ datasources: { db: { url: e2eTarget().databaseUrl } } })
  const second = await db.business.findUniqueOrThrow({ where: { code: 'BUS-002' } })
  const person = await db.person.findUniqueOrThrow({ where: { code: 'PER-OWNER' } })
  // Arrange real membership in the isolated e2e database. The server resolves
  // both entry and viewer grants; no hand-built viewer or scope is substituted.
  const grant = await db.membership.create({ data: { personId: person.id, tenantId: second.tenantId, businessId: second.id, role: 'OWNER' } })
  let releaseFirst = () => {}
  try {
  await loginAsOwner(page)
  await expect(page).toHaveURL(/\/businesses$/)
  const scope = await readScope(page.request)
  const first = scope.businesses.find(row => row.name === 'Business 01')
  expect(scope.businesses.some(row => row.id === second.id)).toBeTruthy()
  // Delay only receipt read projections to exercise stale UI responses.
  const delay = new Promise(resolve => { releaseFirst = resolve })
  let firstRequested
  const requested = new Promise(resolve => { firstRequested = resolve })
  let firstDelivered
  const delivered = new Promise(resolve => { firstDelivered = resolve })
  await page.route('**/api/procurement/receipts?**', async route => {
    const isFirst = new URL(route.request().url()).searchParams.get('businessId') === first.id
    if (isFirst) { firstRequested(); await delay }
    await route.fulfill({ json: { receipts: [{ id: isFirst ? 'fixture-a' : 'fixture-b', code: isFirst ? 'GRN-STALE-A' : 'GRN-CURRENT-B',
      purchaseOrder: { code: 'PO-FIXTURE', supplier: { name: 'Scope fixture' } }, receivedAt: '2026-09-10T18:00:00Z' }], hasMore: false } })
    if (isFirst) firstDelivered()
  })
  await page.reload()
  await page.getByRole('button', { name: /Open Business Business 01/ }).click()
  await page.goto('/procurement/receipts')
  await requested
  await page.getByRole('link', { name: 'Select Business from Organization' }).click()
  await page.getByRole('button', { name: /Open Business Business 02/ }).click()
  await page.getByRole('link', { name: 'SCM', exact: true }).click()
  await page.getByRole('link', { name: 'Procurement', exact: true }).click()
  await page.getByRole('link', { name: 'Goods Receipts', exact: true }).click()
  await expect(page.getByRole('button', { name: 'GRN-CURRENT-B' })).toBeVisible()
  releaseFirst()
  await delivered
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
  await expect(page.getByRole('button', { name: 'GRN-STALE-A' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'GRN-CURRENT-B' })).toBeVisible()
  } finally {
    releaseFirst()
    await db.membership.delete({ where: { id: grant.id } })
    await db.$disconnect()
  }
})
