const { test, expect } = require('@playwright/test')
const { randomUUID } = require('node:crypto')
const { PrismaClient } = require('@prisma/client')
const { e2eTarget } = require('./e2e-target')
const { loginRequest, readScope, E2E_PASSWORD } = require('./e2e-auth')
const { signUpBusinessActor } = require('./e2e-business-actor')

// @req FR-253 — actual persisted policy/formula edits, server preview and OWNER activation.
// @spec ADR-098; SEC-001
// @tested tests/e2e/fr253-pricing-rules.spec.js

const FIXTURE_TENANT_CODE = 'TNT-FR253-PRICING'
const FIXTURE_TENANT_NAME = 'FR-253 pricing E2E tenant'
const FIXTURE_BUSINESS_CODE = 'BUS-SMARTGIFT'
const FIXTURE_BUSINESS_NAME = 'FR-253 pricing E2E Business'
const prisma = new PrismaClient({ datasources: { db: { url: e2eTarget().databaseUrl } } })
let fixture

async function removePricingFixture() {
  const tenant = await prisma.tenant.findUnique({ where: { code: FIXTURE_TENANT_CODE } })
  if (!tenant) return
  if (tenant.name !== FIXTURE_TENANT_NAME) throw new Error('Refusing to remove a Tenant outside the FR-253 E2E fixture')

  const business = await prisma.business.findUnique({ where: { code: FIXTURE_BUSINESS_CODE } })
  if (!business) {
    if (await prisma.business.count({ where: { tenantId: tenant.id } })) {
      throw new Error('Refusing to remove a Tenant with Businesses outside the FR-253 E2E fixture')
    }
    await prisma.tenant.delete({ where: { id: tenant.id } })
    return
  }
  if (business.tenantId !== tenant.id || business.name !== FIXTURE_BUSINESS_NAME) {
    throw new Error('Refusing to remove a Business outside the FR-253 E2E fixture')
  }

  const memberships = await prisma.membership.findMany({
    where: { businessId: business.id },
    include: { person: { select: { email: true } } },
  })
  if (memberships.some(({ person }) => !person.email?.startsWith('sod-'))) {
    throw new Error('Refusing to remove a non-test member from the FR-253 E2E fixture')
  }
  const actorIds = memberships.map(({ personId }) => personId)
  const ruleSets = await prisma.pricingRuleSet.findMany({ where: { businessId: business.id }, select: { id: true, sourceRuleSetId: true } })
  const tenantBusinesses = await prisma.business.count({ where: { tenantId: tenant.id } })
  if (tenantBusinesses !== 1) throw new Error('Refusing to remove a Tenant with Businesses outside the FR-253 E2E fixture')

  await prisma.pricingCalculation.deleteMany({ where: { businessId: business.id } })
  // Remove cloned drafts before their source because rule lineage is restrictive.
  let remaining = ruleSets
  while (remaining.length) {
    const leaves = remaining.filter(({ id }) => !remaining.some((candidate) => candidate.sourceRuleSetId === id))
    if (!leaves.length) throw new Error('FR-253 pricing fixture has an unexpected cyclic rule lineage')
    await prisma.pricingRuleSet.deleteMany({ where: { id: { in: leaves.map(({ id }) => id) } } })
    const deletedIds = new Set(leaves.map(({ id }) => id))
    remaining = remaining.filter(({ id }) => !deletedIds.has(id))
  }
  await prisma.auditEvent.deleteMany({ where: { businessId: business.id } })
  await prisma.membership.deleteMany({ where: { businessId: business.id } })
  if (actorIds.length) await prisma.person.deleteMany({ where: { id: { in: actorIds } } })
  await prisma.stockMovement.deleteMany({ where: { businessId: business.id } })
  await prisma.product.deleteMany({ where: { businessId: business.id } })
  await prisma.productMaster.deleteMany({ where: { businessId: business.id } })
  await prisma.inventoryCategory.deleteMany({ where: { businessId: business.id } })
  await prisma.business.delete({ where: { id: business.id } })
  await prisma.tenant.delete({ where: { id: tenant.id } })
}

async function preparePricingFixture() {
  await removePricingFixture()
  const existingBusiness = await prisma.business.findUnique({ where: { code: FIXTURE_BUSINESS_CODE } })
  if (existingBusiness) throw new Error('BUS-SMARTGIFT is already owned outside the FR-253 E2E fixture')
  const portfolio = await prisma.portfolio.findFirst({ orderBy: { code: 'asc' } })
  if (!portfolio) throw new Error('FR-253 E2E seed Portfolio is unavailable')
  const tenant = await prisma.tenant.create({
    data: { code: FIXTURE_TENANT_CODE, name: FIXTURE_TENANT_NAME, portfolioId: portfolio.id },
  })
  const business = await prisma.business.create({
    data: { code: FIXTURE_BUSINESS_CODE, name: FIXTURE_BUSINESS_NAME, tenantId: tenant.id },
  })
  fixture = { tenant, business }
}

test.beforeAll(async () => { await preparePricingFixture() })
test.afterAll(async () => {
  try { await removePricingFixture() } finally { await prisma.$disconnect() }
})

test('FR-253 — OWNER edits variables and expressions, previews, approves and clones immutable policy', async ({ page }) => {
  const actor = await signUpBusinessActor(page.request, fixture.business.id)
  // Signup establishes the isolated actor's authenticated session; membership
  // is then added to the disposable Business before this real entry flow.
  await page.goto('/businesses')
  await page.getByRole('button', { name: `Open Business ${FIXTURE_BUSINESS_NAME}`, exact: true }).click()
  await expect(page).toHaveURL(/\/overview$/)
  const scope = await readScope(page.request)
  const scopedBusiness = scope.businesses.find((business) => business.code === FIXTURE_BUSINESS_CODE)
  expect(scopedBusiness).toMatchObject({ id: fixture.business.id, name: FIXTURE_BUSINESS_NAME })
  const businessId = scopedBusiness.id
  const fixtureCode = randomUUID().slice(0, 8)
  const createInventory = async (path, data) => {
    const response = await page.request.post(`/api/inventory/${path}`, { data: { businessId, ...data } })
    expect(response.ok(), await response.text()).toBe(true)
    return response.json()
  }
  const category = await createInventory('categories', { code: `PCAT-${fixtureCode}`, nameTh: `หมวดทดสอบราคา ${fixtureCode}`, nameEn: 'Price test category' })
  const master = await createInventory('product-masters', { code: `PM-${fixtureCode}`, categoryId: category.id, nameTh: `สินค้าทดสอบราคา ${fixtureCode}`, nameEn: 'Price test product' })
  const product = await createInventory('products', { code: `SKU-${fixtureCode}`, productMasterId: master.id, name: `สินค้าทดสอบ ${fixtureCode}` })
  await createInventory('stock-movements', { productId: product.id, kind: 'RECEIPT', quantity: 1000, costSatang: 10000 })
  await page.goto('/commerce/pricing-rules')
  await expect(page.getByRole('heading', { name: 'สูตรคำนวณราคา', exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'ร่างใหม่จากแม่แบบ', exact: true }).click()
  const name = `สูตรทดสอบ ${randomUUID().slice(0, 8)}`
  await page.getByLabel('ชื่อชุดสูตร', { exact: true }).fill(name)
  await page.getByLabel('นิพจน์ candidatePrice', { exact: true }).fill('anchorPrice * factor / anchorFactor * 1.1')
  await page.getByRole('button', { name: 'ตัวแปร', exact: true }).click()
  await page.getByText('อัตราแลกเปลี่ยน', { exact: true }).click()
  await page.getByLabel('fx / CNY → THB (THB/CNY)', { exact: true }).fill('5.5')
  const savedResponse = page.waitForResponse((r) => r.request().method() === 'POST' && r.url().endsWith('/api/commerce/pricing-rules'))
  await page.getByRole('button', { name: 'บันทึกร่าง', exact: true }).click()
  const saved = await savedResponse
  expect(saved.ok(), await saved.text()).toBe(true)
  const rule = await saved.json()
  expect(rule.rules.fx.cnyToThb).toBe('5.5')
  expect(rule.rules.formulas[0].expression).toBe('anchorPrice * factor / anchorFactor * 1.1')
  await expect(page.getByRole('status')).toContainText('บันทึกร่างแล้ว')
  await expect(page.getByRole('button', { name: 'อนุมัติรุ่นและตั้งวันมีผล', exact: true })).toBeDisabled()

  await page.getByRole('button', { name: 'ทดลองคำนวณ', exact: true }).click()
  await page.getByLabel('จำนวนทดลอง (ชิ้น)', { exact: true }).fill('500')
  await page.getByLabel('ต้นทุนโรงงานต่อชิ้น', { exact: true }).fill('32')
  await page.getByLabel('จำนวนชิ้นต่อลัง', { exact: true }).fill('20')
  await page.getByLabel('ปริมาตรลัง (m³)', { exact: true }).fill('0.108')
  await page.getByLabel('น้ำหนักลัง (kg; ไม่ทราบเว้นว่าง)', { exact: true }).fill('12')
  await page.getByRole('button', { name: 'ตรวจสูตรและทดลองคำนวณ', exact: true }).click()
  await expect(page.getByTestId('pricing-preview-result')).toContainText('ราคาขายต่อชิ้น')
  await expect(page.getByTestId('pricing-preview-result')).toContainText('ราคาตามจำนวน')
  await page.getByTestId('pricing-preview-result').scrollIntoViewIfNeeded()
  await page.screenshot({ path: 'output/playwright/fr252-pricing-preview.png', fullPage: true })
  await page.getByLabel('เหตุผลการเปลี่ยนแปลง / อนุมัติ / ถอนสิทธิ์', { exact: true }).fill('ทดสอบสูตรและต้นทุนในฐานข้อมูลแยก')
  const approvedResponse = page.waitForResponse((r) => r.request().method() === 'POST' && r.url().endsWith(`/api/commerce/pricing-rules/${rule.id}/actions`))
  await page.getByRole('button', { name: 'อนุมัติรุ่นและตั้งวันมีผล', exact: true }).click()
  const approved = await approvedResponse
  expect(approved.ok(), await approved.text()).toBe(true)
  await expect(page.getByRole('status').filter({ hasText: 'อนุมัติรุ่นแล้ว' })).toBeVisible()
  await page.reload()
  await expect(page.getByLabel('ชื่อชุดสูตร', { exact: true })).toHaveValue(name)
  await expect(page.getByLabel('ชื่อชุดสูตร', { exact: true })).toBeDisabled()
  await expect(page.getByLabel('นิพจน์ candidatePrice', { exact: true })).toBeDisabled()
  await page.getByRole('button', { name: 'ทดลองคำนวณ', exact: true }).click()
  await expect(page.getByRole('region', { name: 'ส่งราคาขายเข้า Knowledge' })).toBeVisible()
  await expect(page.getByLabel('สินค้าที่จะเผยแพร่ราคา (Inventory SKU)', { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'ยืนยันราคาขายและส่งเข้า Knowledge', exact: true })).toBeDisabled()
  await page.getByLabel('สินค้าที่จะเผยแพร่ราคา (Inventory SKU)', { exact: true }).selectOption(product.id)
  await page.getByLabel('เผยแพร่ระดับ 100 ชิ้น', { exact: true }).check()
  await page.getByLabel('เหตุผลยืนยันราคาขายเพื่อส่งเข้า Knowledge', { exact: true }).fill('ตรวจราคาทดสอบจากบัญชีต้นทุนจริงในฐานข้อมูลแยก')
  const catalogPreviewResponse = page.waitForResponse((r) => r.request().method() === 'POST' && r.url().endsWith('/api/commerce/pricing-rules/catalog') && r.request().postDataJSON()?.previewOnly === true)
  await page.getByRole('button', { name: 'ตรวจราคาจาก Inventory', exact: true }).click()
  const catalogPreview = await catalogPreviewResponse
  expect(catalogPreview.ok(), await catalogPreview.text()).toBe(true)
  const reviewedPrices = await catalogPreview.json()
  expect(reviewedPrices.publicationStatus).toBe('NOT_SUBMITTED')
  const reviewedTable = page.getByRole('table', { name: /ราคาขายจากบัญชีต้นทุนที่จะยืนยัน/ })
  const expectedBaht = new Intl.NumberFormat('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(reviewedPrices.prices[0].unitPriceSatang / 100)
  await expect(reviewedTable).toContainText(`${expectedBaht} บาท`)
  await expect(page.getByRole('button', { name: 'ยืนยันราคาขายและส่งเข้า Knowledge', exact: true })).toBeEnabled()
  await page.getByRole('region', { name: 'ส่งราคาขายเข้า Knowledge' }).scrollIntoViewIfNeeded()
  await page.screenshot({ path: 'output/playwright/fr252-pricing-catalog.png', fullPage: true })
  const catalogSubmitResponse = page.waitForResponse((r) => r.request().method() === 'POST' && r.url().endsWith('/api/commerce/pricing-rules/catalog') && !r.request().postDataJSON()?.previewOnly)
  await page.getByRole('button', { name: 'ยืนยันราคาขายและส่งเข้า Knowledge', exact: true }).click()
  const catalogSubmit = await catalogSubmitResponse
  expect(catalogSubmit.request().postDataJSON().previewHash).toBe(reviewedPrices.previewHash)
  // The isolated browser server has no production Knowledge binding. Never mock admission success.
  expect(catalogSubmit.status()).toBe(503)
  await expect(page.getByRole('region', { name: 'ส่งราคาขายเข้า Knowledge' }).getByRole('alert')).toContainText('ส่งราคาไม่ได้:')
  await expect(page.getByText('สถานะรับเข้าคิว:', { exact: false })).toHaveCount(0)

  // Persistence and immutability are real server assertions, not route mocks.
  const persisted = await page.request.get(`/api/commerce/pricing-rules?businessId=${businessId}`)
  const stored = (await persisted.json()).rules.find((entry) => entry.id === rule.id)
  expect(stored.status).toBe('APPROVED')
  expect(stored.isActive).toBe(true)
  const immutable = await page.request.patch(`/api/commerce/pricing-rules/${rule.id}`, { data: { businessId, version: stored.version, name, rules: stored.rules, reason: 'must refuse immutable edit' } })
  expect(immutable.status()).toBe(409)
  await page.getByRole('button', { name: 'คัดลอกเป็นร่างรุ่นใหม่', exact: true }).click()
  await expect(page.getByLabel('ชื่อชุดสูตร', { exact: true })).toHaveValue(`${name} (รุ่นใหม่)`)
  await expect(page.getByLabel('นิพจน์ candidatePrice', { exact: true })).toBeEnabled()
  await page.getByLabel('นิพจน์ candidatePrice', { exact: true }).fill('anchorPrice * factor / anchorFactor * 1.2')
  await page.getByRole('button', { name: 'เปรียบเทียบและประวัติ', exact: true }).click()
  await expect(page.getByRole('table').first()).toContainText('anchorPrice * factor / anchorFactor * 1.1')
  await expect(page.getByRole('table').first()).toContainText('anchorPrice * factor / anchorFactor * 1.2')
  await page.screenshot({ path: 'output/playwright/fr252-pricing-rules.png', fullPage: true })
})

test('FR-253 — authenticated outsider cannot read or create another Business pricing policy', async ({ request }) => {
  expect((await loginRequest(request)).ok()).toBe(true)
  const scope = await readScope(request)
  const businessId = scope.businesses.find((business) => business.code === 'BUS-001').id
  const templateResponse = await request.get(`/api/commerce/pricing-rules?businessId=${businessId}`)
  expect(templateResponse.ok()).toBe(true)
  const { template } = await templateResponse.json()
  // This independent fixture must not consume the other suites' loopback signup quota.
  const signup = await request.post('/api/auth/signup', { headers: { 'x-forwarded-for': '192.0.2.253' }, data: { email: `pricing-outsider-${randomUUID()}@example.test`, displayName: 'Pricing outsider', password: E2E_PASSWORD } })
  expect(signup.status()).toBe(201)
  expect((await request.get(`/api/commerce/pricing-rules?businessId=${businessId}`)).status()).toBe(404)
  expect((await request.post('/api/commerce/pricing-rules', { data: { businessId, name: 'Forbidden', rules: template } })).status()).toBe(404)
})
