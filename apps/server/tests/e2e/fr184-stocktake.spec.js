const { test, expect } = require('@playwright/test')
const { PrismaClient } = require('@prisma/client')
const { e2eTarget } = require('./e2e-target')
const { loginAsOwner } = require('./e2e-auth')

// @req FR-184 — physical counts use real located/lot identities, reject stale
// previews, survive response loss/reload, and never carry a prior Business over.
// @spec ADR-074; BR-008; SEC-001
// @tested tests/e2e/fr184-stocktake.spec.js
const prisma = new PrismaClient({ datasources: { db: { url: e2eTarget().databaseUrl } } })
let fixture

test.beforeAll(async () => {
  const tag = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
  const owner = await prisma.person.findUnique({ where: { code: 'PER-OWNER' } })
  const tenant = await prisma.tenant.findUnique({ where: { code: 'TNT-001' } })
  const business = await prisma.business.create({ data: { code: `COUNT-${tag}`, name: 'Stocktake browser fixture', tenantId: tenant.id } })
  const other = await prisma.business.create({ data: { code: `COUNT-B-${tag}`, name: 'Stocktake second fixture', tenantId: tenant.id } })
  for (const row of [business, other]) await prisma.membership.create({ data: { personId: owner.id, tenantId: tenant.id, businessId: row.id, role: 'OWNER', status: 'ACTIVE', domainKeysJson: '["inventory"]' } })
  const category = await prisma.inventoryCategory.create({ data: { code: `CAT-${tag}`, nameTh: 'สินค้าตรวจนับ', nameEn: 'Stocktake fixture', tenantId: tenant.id, businessId: business.id } })
  const master = await prisma.productMaster.create({ data: { code: `MASTER-${tag}`, nameTh: 'สินค้าตรวจนับ', nameEn: 'Stocktake fixture', tenantId: tenant.id, businessId: business.id, categoryId: category.id } })
  const scope = { tenantId: tenant.id, businessId: business.id }
  const product = await prisma.product.create({ data: { ...scope, code: `SKU-${tag}`, name: 'สินค้านับชิ้น', productMasterId: master.id, stockPolicy: 'TRACKED', trackingMode: 'NONE' } })
  const trackedLot = await prisma.product.create({ data: { ...scope, code: `LOT-SKU-${tag}`, name: 'สินค้านับล็อต', productMasterId: master.id, stockPolicy: 'TRACKED', trackingMode: 'LOT' } })
  const location = await prisma.warehouseLocation.create({ data: { ...scope, code: `LOC-${tag}`, name: 'คลังตรวจนับ', type: 'TH_FINISHED_GOODS' } })
  const lot = await prisma.productLot.create({ data: { ...scope, productId: trackedLot.id, code: `LOT-${tag}`, receivedQty: 4 } })
  await prisma.stockMovement.createMany({ data: [
    { ...scope, productId: product.id, kind: 'RECEIPT', quantity: 5, targetLocationId: location.id },
    { ...scope, productId: product.id, kind: 'RECEIPT', quantity: 2 },
    { ...scope, productId: trackedLot.id, lotId: lot.id, kind: 'RECEIPT', quantity: 4, targetLocationId: location.id },
  ] })
  fixture = { business, other, product, trackedLot, location, lot }
})
test.afterAll(async () => prisma.$disconnect())

async function enter(page, business = fixture.business) {
  await loginAsOwner(page)
  await page.getByRole('button', { name: `Open Business ${business.name}`, exact: true }).filter({ hasText: business.code }).click()
  await expect(page).toHaveURL(/\/overview$/)
  await page.goto('/inventory/stocktakes')
  await expect(page.getByRole('heading', { name: 'ตรวจนับสต็อก', exact: true })).toBeVisible()
}
async function addLine(page, product, locationId, count, lotId = null) {
  await page.getByLabel('สินค้าที่ตรวจนับ', { exact: true }).selectOption(product.id)
  await page.getByLabel('จุดจัดเก็บที่ตรวจนับ', { exact: true }).selectOption(locationId || 'UNLOCATED')
  if (lotId) await page.getByLabel('ล็อตที่ตรวจนับ', { exact: true }).selectOption(lotId)
  await page.getByLabel('จำนวนที่นับได้', { exact: true }).fill(String(count))
  await page.getByRole('button', { name: 'เพิ่มรายการนับ', exact: true }).click()
}

test('stocktake previews NONE/LOT, rejects stale counts, and retries one committed operation after response loss', async ({ page }) => {
  test.setTimeout(180000)
  await page.setViewportSize({ width: 390, height: 844 })
  const pageErrors = []
  page.on('pageerror', error => pageErrors.push(error.message))
  await enter(page)
  await page.getByLabel('สินค้าที่ตรวจนับ', { exact: true }).selectOption(fixture.product.id)
  await expect(page.getByTestId('located-summary')).toContainText('ยังไม่ระบุจุดจัดเก็บ: 2')
  await expect(page.getByLabel('จำนวนที่นับได้', { exact: true })).toHaveValue('')
  await addLine(page, fixture.product, fixture.location.id, 3)
  await page.getByRole('button', { name: 'ตรวจสอบยอดก่อนบันทึก', exact: true }).click()
  await expect(page.getByTestId('stocktake-preview')).toContainText('ยังนับไม่ครบ')
  await expect(page.getByRole('button', { name: 'ยืนยันบันทึกยอดนับ', exact: true })).toBeDisabled()
  await addLine(page, fixture.product, null, 2)
  await addLine(page, fixture.trackedLot, fixture.location.id, 5, fixture.lot.id)
  await addLine(page, fixture.trackedLot, null, 0, fixture.lot.id)
  await page.getByRole('button', { name: 'ตรวจสอบยอดก่อนบันทึก', exact: true }).click()
  await expect(page.getByRole('button', { name: 'ยืนยันบันทึกยอดนับ', exact: true })).toBeEnabled()
  const movement = await page.request.post('/api/inventory/stock-movements', { data: { businessId: fixture.business.id, productId: fixture.product.id, kind: 'RECEIPT', quantity: 1, targetLocationId: fixture.location.id } })
  expect(movement.ok(), await movement.text()).toBe(true)
  await page.getByRole('button', { name: 'ยืนยันบันทึกยอดนับ', exact: true }).click()
  await expect(page.getByRole('alert').filter({ hasText: 'ยอดสต็อกเปลี่ยนแล้ว' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'ยืนยันบันทึกยอดนับ', exact: true })).toBeDisabled()
  await page.getByRole('button', { name: 'ตรวจสอบยอดก่อนบันทึก', exact: true }).click()
  await expect(page.getByRole('button', { name: 'ยืนยันบันทึกยอดนับ', exact: true })).toBeEnabled()
  const keys = []
  let committed
  await page.route('**/api/inventory/stocktakes/commit', async route => {
    keys.push(route.request().postDataJSON().idempotencyKey)
    if (keys.length === 1) {
      const response = await route.fetch()
      expect(response.ok(), await response.text()).toBe(true)
      committed = await response.json()
      await route.abort('failed')
    } else await route.continue()
  })
  await page.getByRole('button', { name: 'ยืนยันบันทึกยอดนับ', exact: true }).click()
  await expect(page.getByRole('alert').filter({ hasText: 'ยังยืนยันการบันทึกไม่ได้' })).toBeVisible()
  await page.getByRole('button', { name: 'ยืนยันบันทึกยอดนับ', exact: true }).click()
  await expect(page.getByRole('status').filter({ hasText: 'บันทึกยอดนับแล้ว' })).toBeVisible()
  expect(keys).toHaveLength(2)
  expect(keys[0]).toBe(keys[1])
  expect(committed.result.movementCount).toBe(2)
  expect(await prisma.stockMovement.count({ where: { reference: `STOCKTAKE:${committed.previewId}` } })).toBe(2)
  await expect(page).toHaveURL(new RegExp(`previewId=${committed.previewId}`))
  await page.reload()
  await expect(page.getByRole('status').filter({ hasText: 'บันทึกยอดนับแล้ว' })).toBeVisible()
  await expect(page.getByTestId('stocktake-preview')).toContainText(fixture.lot.code)
  await expect(page.getByTestId('stocktake-preview')).toContainText('ยอดหลังบันทึก: 3')
  await expect(page.getByLabel('จำนวนที่นับได้', { exact: true })).toHaveCount(0)
  await page.screenshot({ path: 'output/playwright/fr184-stocktake-mobile.png', fullPage: true })
  expect(pageErrors).toEqual([])
})

test('a delayed Business A preview cannot appear after selecting Business B', async ({ page }) => {
  test.setTimeout(120000)
  await enter(page)
  await addLine(page, fixture.product, fixture.location.id, 3)
  await addLine(page, fixture.product, null, 2)
  let release
  let started
  const reached = new Promise(resolve => { started = resolve })
  const gate = new Promise(resolve => { release = resolve })
  await page.route('**/api/inventory/stocktakes/preview', async route => {
    const response = await route.fetch()
    started()
    await gate
    await route.fulfill({ response })
  })
  await page.getByRole('button', { name: 'ตรวจสอบยอดก่อนบันทึก', exact: true }).click()
  await reached
  await page.goto('/businesses')
  await page.getByRole('button', { name: `Open Business ${fixture.other.name}`, exact: true }).filter({ hasText: fixture.other.code }).click()
  await expect(page).toHaveURL(/\/overview$/)
  await page.goto('/inventory/stocktakes')
  release()
  await expect(page.getByRole('heading', { name: 'ตรวจนับสต็อก', exact: true })).toBeVisible()
  await expect(page.getByTestId('stocktake-preview')).toHaveCount(0)
  await expect(page.getByLabel('สินค้าที่ตรวจนับ', { exact: true })).not.toContainText(fixture.product.name)
  await expect(page).not.toHaveURL(/previewId=/)
})

test('returning to the blank desk while a saved preview loads releases the editor', async ({ page }) => {
  await enter(page)
  const response = await page.request.post('/api/inventory/stocktakes/preview', { data: { businessId: fixture.business.id, lines: [
    { productId: fixture.product.id, locationId: fixture.location.id, lotId: null, countedQuantity: 3 },
    { productId: fixture.product.id, locationId: null, lotId: null, countedQuantity: 2 },
  ] } })
  expect(response.ok()).toBe(true)
  const saved = await response.json()
  let release
  let started
  const reached = new Promise(resolve => { started = resolve })
  const gate = new Promise(resolve => { release = resolve })
  await page.route(`**/api/inventory/stocktakes/${saved.previewId}?*`, async route => {
    const result = await route.fetch()
    started()
    await gate
    await route.fulfill({ response: result })
  })
  await page.evaluate(id => {
    window.history.pushState(null, '', `/inventory/stocktakes?previewId=${id}`)
    window.dispatchEvent(new PopStateEvent('popstate'))
  }, saved.previewId)
  await reached
  await page.evaluate(() => {
    window.history.replaceState(null, '', '/inventory/stocktakes')
    window.dispatchEvent(new PopStateEvent('popstate'))
  })
  await expect(page.getByLabel('สินค้าที่ตรวจนับ', { exact: true })).toBeEnabled()
  release()
  await expect(page.getByTestId('stocktake-preview')).toHaveCount(0)
  await expect(page.getByLabel('จำนวนที่นับได้', { exact: true })).toBeEnabled()
})
