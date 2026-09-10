const { test, expect } = require('@playwright/test')
const { PrismaClient } = require('@prisma/client')
const { randomInt } = require('node:crypto')
const { e2eTarget } = require('./e2e-target')
const { loginAsOwner } = require('./e2e-auth')

// @req FR-186 — the owner configures the authoritative seller/tax/PromptPay
// values, previews and issues a document, then reloads and reads the durable
// snapshot by id.
// @req FR-183 — the cashier completes a real browser POS checkout and sees the
// payment remain pending until the existing verifier acts.
// @spec ADR-065; BR-001; BR-002; SEC-001; ZAI:PROPOSAL-COMMERCE-BILLING-POS-20260910
// @tested tests/e2e/fr186-billing-pos.spec.js

const target = e2eTarget()
// This client points at Playwright's own isolated target. The fixture rows are
// created only in that database and are deliberately separate from the general
// seed so `db:seed` never overwrites an operator's issuer or branch settings.
const prisma = new PrismaClient({ datasources: { db: { url: target.databaseUrl } } })
let fixture

async function prepareFixture() {
  const owner = await prisma.person.findUnique({ where: { code: 'PER-OWNER' } })
  const suffix = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`
  const fixtureTaxId = `${String(Date.now()).slice(-8)}${String(randomInt(0, 100000)).padStart(5, '0')}`
  const tenant = await prisma.tenant.findUnique({ where: { code: 'TNT-001' } })
  const portfolio = await prisma.portfolio.findUnique({ where: { id: tenant.portfolioId } })
  const legalEntity = await prisma.legalEntity.create({ data: { code: `E2E-LE-${suffix}`, legalName: 'E2E Billing Fixture Co., Ltd.', legalAddress: '99 E2E Fixture Road, Bangkok', portfolioId: portfolio.id } })
  await prisma.legalEntityIdentifier.create({ data: { legalEntityId: legalEntity.id, country: 'TH', type: 'TH_TAX_ID', value: fixtureTaxId, verifiedAt: new Date('2026-01-02T00:00:00Z') } })
  const business = await prisma.business.create({ data: { code: `E2E-BILL-${suffix}`, name: 'E2E Billing Fixture', tenantId: tenant.id, legalEntityId: legalEntity.id } })
  const secondBusiness = await prisma.business.create({ data: { code: `E2E-BILL-SECOND-${suffix}`, name: 'E2E Secondary Fixture', tenantId: tenant.id } })
  await prisma.membership.create({ data: { personId: owner.id, tenantId: tenant.id, businessId: business.id, role: 'OWNER', status: 'ACTIVE', domainKeysJson: JSON.stringify(['commerce', 'inventory']) } })
  await prisma.membership.create({ data: { personId: owner.id, tenantId: tenant.id, businessId: secondBusiness.id, role: 'OWNER', status: 'ACTIVE', domainKeysJson: JSON.stringify(['commerce', 'inventory']) } })
  const branch = await prisma.branch.create({ data: { code: `E2E-BR-${suffix}`, name: 'E2E Head Office', tenantId: tenant.id, businessId: business.id, address: '99 E2E Fixture Road, Bangkok', taxBranchCode: '00000' } })
  const category = await prisma.inventoryCategory.create({ data: { code: `E2E-CAT-${suffix}`, tenantId: business.tenantId, businessId: business.id, nameTh: 'สินค้าทดสอบ POS', nameEn: 'POS browser item' } })
  const master = await prisma.productMaster.create({ data: { code: `E2E-PM-${suffix}`, tenantId: business.tenantId, businessId: business.id, categoryId: category.id, nameTh: 'สินค้าทดสอบ POS', nameEn: 'POS browser item' } })
  const product = await prisma.product.create({ data: { code: `E2E-SKU-${suffix}`, tenantId: business.tenantId, businessId: business.id, productMasterId: master.id, name: 'สินค้าทดสอบ POS', stockPolicy: 'TRACKED', trackingMode: 'NONE', safetyStock: 0 } })
  const product2 = await prisma.product.create({ data: { code: `E2E-SKU2-${suffix}`, tenantId: business.tenantId, businessId: business.id, productMasterId: master.id, name: 'สินค้าทดสอบ POS 2', stockPolicy: 'TRACKED', trackingMode: 'NONE', safetyStock: 0 } })
  const location = await prisma.warehouseLocation.create({ data: { code: `E2E-LOC-${suffix}`, tenantId: business.tenantId, businessId: business.id, name: 'คลัง POS ทดสอบ', type: 'TH_FINISHED_GOODS', isVirtual: false } })
  await prisma.stockMovement.create({ data: { tenantId: business.tenantId, businessId: business.id, productId: product.id, kind: 'RECEIPT', quantity: 4, targetLocationId: location.id, reason: 'E2E fixture', actorId: owner.id } })
  await prisma.stockMovement.create({ data: { tenantId: business.tenantId, businessId: business.id, productId: product2.id, kind: 'RECEIPT', quantity: 4, targetLocationId: location.id, reason: 'E2E fixture', actorId: owner.id } })
  fixture = { business, secondBusiness, branch, product, product2, location }
}

async function createNewerOrders() {
  const codes = []
  const baseTime = Date.now()
  await prisma.$transaction(async (tx) => {
    for (let index = 0; index < 55; index += 1) {
      const code = `${fixture.business.code}-NEW-${String(index).padStart(2, '0')}`
      codes.push(code)
      await tx.salesOrder.create({
        data: {
          code,
          tenantId: fixture.business.tenantId,
          businessId: fixture.business.id,
          origin: 'WALK_IN',
          currency: 'THB',
          orderedAt: new Date(baseTime + ((index + 1) * 1000)),
          lines: { create: [{ productId: fixture.product.id, description: 'Newer deep-link fixture order', qty: 1, unitPriceSatang: 10000 }] },
        },
      })
    }
  })
  // The list endpoint returns the newest 50; keep one known visible order for
  // the delayed-refresh selection proof while the issued order is outside it.
  fixture.newerOrderCode = codes[codes.length - 1]
}

test.beforeAll(async () => { await prepareFixture() })
test.afterAll(async () => { await prisma.$disconnect() })

test('FR-186/FR-183 — browser billing/POS flow survives reload and Business switch', async ({ page }) => {
  await loginAsOwner(page)
  await page.locator('button[aria-label="Open Business E2E Billing Fixture"]').filter({ hasText: fixture.business.code }).click()
  await expect(page).toHaveURL(/\/overview$/)

  await page.goto('/commerce/orders')
  await expect(page.getByRole('heading', { name: 'ออเดอร์ (Orders)', exact: true })).toBeVisible()
  await page.getByLabel('รายการ 1', { exact: true }).fill('Browser billing item')
  await page.getByLabel('จำนวน 1', { exact: true }).fill('1')
  await page.getByLabel('ราคา 1', { exact: true }).fill('100')
  const orderResponse = page.waitForResponse((response) => response.request().method() === 'POST' && response.url().endsWith('/api/commerce/orders'))
  await page.getByRole('button', { name: 'สร้างออเดอร์', exact: true }).click()
  const createdOrderResponse = await orderResponse
  expect(createdOrderResponse.ok()).toBe(true)
  expect(await createdOrderResponse.json()).toMatchObject({ total: 100, lines: [{ qty: 1, unitPrice: 100, lineTotal: 100 }] })

  await page.goto('/commerce/invoices')
  await expect(page.getByRole('heading', { name: 'Billing & tax documents', exact: true })).toBeVisible()
  await expect(page.getByLabel('สาขาที่ออกเอกสาร', { exact: true })).toHaveValue(fixture.branch.id)
  await page.getByLabel('จด VAT', { exact: true }).selectOption('true')
  await page.getByLabel('VAT rate (basis points)', { exact: true }).fill('700')
  await page.getByLabel('วิธีรวม VAT', { exact: true }).selectOption('EXCLUSIVE')
  await page.getByLabel('Tax policy version', { exact: true }).fill('TH-VAT-E2E-1')
  await page.getByLabel('Tax effective date', { exact: true }).fill('2026-01-01')
  await page.getByLabel('Tax verified date', { exact: true }).fill('2026-01-02')
  await page.getByLabel('เอกสารกรณีไม่จด VAT', { exact: true }).selectOption('ALLOW_INVOICE_RECEIPT')
  await page.getByLabel('ลูกค้าหน้าร้านไม่ระบุชื่อ', { exact: true }).selectOption('ALLOW_ANONYMOUS_RECEIPT')
  await page.getByLabel('ประเภท PromptPay', { exact: true }).selectOption('MOBILE')
  await page.getByLabel('PromptPay recipient', { exact: true }).fill('0812345678')
  await page.getByLabel('PromptPay verified date', { exact: true }).fill('2026-01-02')
  await page.locator('label').filter({ hasText: 'เปิดใช้ PromptPay ที่ยืนยันแล้ว' }).locator('input').check()
  const configResponse = page.waitForResponse((response) => response.request().method() === 'PATCH' && response.url().includes('/api/commerce/billing/config'))
  await page.getByRole('button', { name: 'บันทึกการตั้งค่า', exact: true }).click()
  expect((await configResponse).ok()).toBe(true)
  expect(await (await page.request.get(`/api/commerce/billing/config?businessId=${encodeURIComponent(fixture.business.id)}`)).json()).toMatchObject({ profile: { vatTreatment: 'EXCLUSIVE', vatRateBps: 700, taxPolicyVersion: 'TH-VAT-E2E-1' } })
  await expect(page.getByText('พร้อมออกเอกสาร')).toBeVisible()

  await page.getByLabel('ประเภทเอกสาร', { exact: true }).selectOption('TAX_INVOICE')
  await page.getByLabel('ชื่อผู้ซื้อ', { exact: true }).fill('Browser Buyer Co., Ltd.')
  await page.getByLabel('เลขผู้เสียภาษีผู้ซื้อ 13 หลัก', { exact: true }).fill('0105555555555')
  await page.getByLabel('รหัสสาขาผู้ซื้อ', { exact: true }).fill('00000')
  await page.getByLabel('ที่อยู่ผู้ซื้อ', { exact: true }).fill('1 Browser Road, Bangkok')
  await page.locator('label').filter({ hasText: 'แนบ PromptPay จากโปรไฟล์' }).locator('input').check()
  const previewResponse = page.waitForResponse((response) => response.request().method() === 'POST' && response.url().endsWith('/api/commerce/billing/documents/preview'))
  await page.getByRole('button', { name: 'Preview', exact: true }).click()
  expect((await previewResponse).ok()).toBe(true)
  await expect(page.getByTestId('billing-document-result')).toContainText('PREVIEW')
  await expect(page.getByText(/PromptPay QR.*107\.00 บาท/)).toBeVisible()

  const issueResponse = page.waitForResponse((response) => response.request().method() === 'POST' && response.url().endsWith('/api/commerce/billing/documents'))
  await page.getByRole('button', { name: 'ออกเอกสารจริง', exact: true }).click()
  const issuedResponse = await issueResponse
  expect(issuedResponse.ok()).toBe(true)
  const firstIssueKey = issuedResponse.request().postDataJSON().idempotencyKey
  expect(firstIssueKey).toBeTruthy()
  const issued = await issuedResponse.json()
  expect(issued.documentNumber).toMatch(/^TAX-\d{4}-\d{6}$/)
  await expect(page.getByTestId('billing-document-result')).toContainText(issued.documentNumber)
  await expect(page.getByText(/PromptPay QR.*107\.00 บาท/)).toBeVisible()

  const retryResponsePromise = page.waitForResponse((response) => response.request().method() === 'POST' && response.url().endsWith('/api/commerce/billing/documents'))
  await page.getByRole('button', { name: 'ออกเอกสารจริง', exact: true }).click()
  const retryResponse = await retryResponsePromise
  expect(retryResponse.ok()).toBe(true)
  expect(retryResponse.request().postDataJSON().idempotencyKey).toBe(firstIssueKey)
  expect(await retryResponse.json()).toMatchObject({ id: issued.id, documentNumber: issued.documentNumber })

  const issuedDocumentUrl = page.url()
  expect(new URL(issuedDocumentUrl).searchParams.get('documentId')).toBe(issued.id)
  await createNewerOrders()
  const browserReloadResponsePromise = page.waitForResponse((response) => response.request().method() === 'GET' && response.url().endsWith(`/api/commerce/billing/documents/${issued.id}`))
  await page.reload()
  const browserReloadResponse = await browserReloadResponsePromise
  expect(browserReloadResponse.ok()).toBe(true)
  expect(await browserReloadResponse.json()).toMatchObject({ id: issued.id, documentNumber: issued.documentNumber, requestHash: issued.requestHash, snapshot: { tax: { grossSatang: 10700 } } })
  const reloadedDocument = page.getByTestId('billing-document-result')
  await expect(reloadedDocument).toContainText(issued.documentNumber)
  await expect(reloadedDocument).toContainText('Browser Buyer Co., Ltd.')
  await expect(reloadedDocument).toContainText('107.00')

  let releaseRefresh
  let refreshHeld = false
  const refreshGate = new Promise((resolve) => { releaseRefresh = resolve })
  await page.route('**/api/commerce/billing/documents/*', async (route) => {
    if (!refreshHeld && route.request().method() === 'GET' && route.request().url().endsWith(`/api/commerce/billing/documents/${issued.id}`)) {
      refreshHeld = true
      await refreshGate
    }
    await route.continue()
  })
  const delayedRefreshResponsePromise = page.waitForResponse((response) => response.request().method() === 'GET' && response.url().endsWith(`/api/commerce/billing/documents/${issued.id}`))
  await page.getByRole('button', { name: 'โหลดใหม่', exact: true }).click()
  await expect.poll(() => refreshHeld).toBe(true)
  const newerOrderButton = page.locator('button').filter({ hasText: fixture.newerOrderCode }).first()
  await expect(newerOrderButton).toBeVisible()
  await newerOrderButton.click()
  expect(new URL(page.url()).searchParams.get('documentId')).toBe(null)
  await expect(page.getByTestId('billing-document-result')).toHaveCount(0)
  releaseRefresh()
  const delayedRefreshResponse = await delayedRefreshResponsePromise
  expect(delayedRefreshResponse.ok()).toBe(true)
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => resolve())))
  await expect(page.getByTestId('billing-document-result')).toHaveCount(0)
  await page.unroute('**/api/commerce/billing/documents/*')

  await page.goto('/businesses')
  await page.locator('button[aria-label="Open Business E2E Secondary Fixture"]').filter({ hasText: fixture.secondBusiness.code }).click()
  const businessBDocumentResponsePromise = page.waitForResponse((response) => response.request().method() === 'GET' && response.url().endsWith(`/api/commerce/billing/documents/${issued.id}`))
  await page.goto(issuedDocumentUrl)
  const businessBDocumentResponse = await businessBDocumentResponsePromise
  expect(businessBDocumentResponse.ok()).toBe(true)
  await expect(page.getByText('ยังไม่พร้อมใช้งาน')).toBeVisible()
  await expect(page.getByTestId('billing-document-result')).toHaveCount(0)
  await expect.poll(() => new URL(page.url()).searchParams.get('documentId')).toBe(null)
  await page.goto('/businesses')
  await page.locator('button[aria-label="Open Business E2E Billing Fixture"]').filter({ hasText: fixture.business.code }).click()

  await page.goto('/commerce/pos')
  await expect(page.getByRole('heading', { name: 'POS checkout', exact: true })).toBeVisible()
  const productRow = page.getByRole('row').filter({ hasText: fixture.product.code })
  await expect(productRow).toBeVisible()
  await productRow.getByRole('button', { name: 'เพิ่ม', exact: true }).click()
  await page.getByLabel('ราคา/หน่วย 1', { exact: true }).fill('100')
  const secondProductRow = page.getByRole('row').filter({ hasText: fixture.product2.code })
  await secondProductRow.getByRole('button', { name: 'เพิ่ม', exact: true }).click()
  const checkout = page.getByRole('button', { name: /Checkout · บันทึกการขาย/ })
  await expect(checkout).toBeDisabled()
  await page.getByLabel('ราคา/หน่วย 2', { exact: true }).fill('100')
  await page.getByLabel('รับเงินสด', { exact: true }).fill('200')
  const posResponse = page.waitForResponse((response) => response.request().method() === 'POST' && response.url().endsWith('/api/commerce/pos/checkout'))
  await checkout.click()
  const pos = await posResponse
  expect(pos.ok()).toBe(true)
  await expect(page.getByRole('status')).toContainText('รอตรวจสอบ')

  // Hold one Business A config request while changing scope. The
  // keyed page plus request guards must keep its late response out of Business
  // 02's freshly mounted workspace.
  let release
  let held = false
  const delayed = new Promise((resolve) => { release = resolve })
  await page.route('**/api/commerce/billing/config*', async (route) => {
    if (!held && route.request().url().includes(fixture.business.id)) {
      held = true
      await delayed
    }
    await route.continue()
  })
  await page.goto('/commerce/invoices', { waitUntil: 'domcontentloaded' })
  await expect.poll(() => held).toBe(true)
  await page.goto('/businesses')
  await page.locator('button[aria-label="Open Business E2E Secondary Fixture"]').filter({ hasText: fixture.secondBusiness.code }).click()
  release()
  await expect(page).toHaveURL(/\/overview$/)
  await page.goto('/commerce/invoices')
  await expect(page.getByText('ยังไม่พร้อมใช้งาน')).toBeVisible()
  await expect(page.getByTestId('billing-document-result')).toHaveCount(0)
})
