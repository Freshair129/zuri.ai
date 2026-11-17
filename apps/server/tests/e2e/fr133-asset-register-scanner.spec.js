// @req FR-133, FR-135, FR-137, FR-138 — reviewed intake to register and scanner verification.
// @spec BR-025, SDD-080, SDD-081, SDD-082, SEC-024
// @tested tests/e2e/fr133-asset-register-scanner.spec.js
const { randomUUID } = require('node:crypto')
const { test, expect } = require('@playwright/test')
const { loginAsOwner, readScope } = require('./e2e-auth')

test('registers a reviewed intake and verifies it through the manual scanner', async ({ page }) => {
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  await loginAsOwner(page)
  await page.getByRole('button', { name: /Open Business Business 01/ }).click()
  await expect(page).toHaveURL(/\/overview$/)
  const scope = await readScope(page.request)
  const business = scope.businesses.find(row => row.name === 'Business 01')
  expect(business).toBeTruthy()

  const tag = randomUUID().replace(/-/g, '').slice(0, 12).toUpperCase()
  const name = `Scanner E2E ${tag}`
  const assetCode = `AST-E2E-${tag}`
  const headers = { 'x-zuri-business-id': business.id }
  const post = async (url, data) => {
    const response = await page.request.fetch(url, { method: 'POST', headers, data })
    const body = await response.text()
    expect(response.ok(), `${url}: HTTP ${response.status()} ${body}`).toBeTruthy()
    return JSON.parse(body)
  }

  // URL FileAssets are isolated metadata fixtures; no object storage or OCR is
  // contacted. Intake validation and human review still use the real APIs.
  const photo = await post('/api/files', {
    businessId: business.id, storageKind: 'EXTERNAL_URL',
    externalUrl: `https://example.invalid/${tag}/asset.jpg`,
    name: `asset-${tag}.jpg`, mime: 'image/jpeg', size: 0,
  })
  const payment = await post('/api/files', {
    businessId: business.id, storageKind: 'EXTERNAL_URL',
    externalUrl: `https://example.invalid/${tag}/receipt.pdf`,
    name: `receipt-${tag}.pdf`, mime: 'application/pdf', size: 0,
  })
  const created = await post('/api/assets/intakes', {
    schemaVersion: '1.0', source: { channel: 'WEB', correlationId: `scanner-e2e-${tag}` },
    businessId: business.id, origin: 'PROCUREMENT_PURCHASE',
    item: { name, categoryCode: 'IT', quantity: 1, expiryControlled: false },
    evidence: [
      { fileAssetId: photo.id, role: 'ASSET_PHOTO' },
      { fileAssetId: payment.id, role: 'PAYMENT_PROOF' },
    ],
    procurementRefs: [
      { type: 'PR', system: 'ERP', value: `PR-${tag}` },
      { type: 'PO', system: 'ERP', value: `PO-${tag}` },
    ],
    lot: null, responsibilities: [], location: null, projectAllocation: null,
    depreciation: {
      method: 'STRAIGHT_LINE', acquisitionAmount: '12345.67', residualValue: '0.00',
      usefulLifeMonths: 36, startDate: '2026-01-01', currency: 'USD',
    },
  })
  expect(created.validation.ok).toBe(true)
  expect(created.intake.status).toBe('NEEDS_REVIEW')
  expect(created.intake.evidence).toHaveLength(2)
  for (const [index, evidence] of created.intake.evidence.entries()) {
    const review = await post(`/api/assets/evidence/${evidence.id}/review`, {
      decision: 'ACCEPT', corrections: [], note: 'E2E fixture review',
    })
    expect(review.evidence.status).toBe('REVIEWED')
    expect(review.intakeStatus).toBe(index === 0 ? 'NEEDS_REVIEW' : 'READY_FOR_REGISTRATION')
  }

  await page.goto('/assets/register')
  await expect(page.getByRole('heading', { name: 'รายการรับเข้าที่พร้อมลงทะเบียน' })).toBeVisible()
  const intakeRow = page.getByRole('listitem').filter({ hasText: name })
  await expect(intakeRow).toBeVisible()
  await expect(intakeRow).toContainText('12345.67 USD')
  await intakeRow.getByLabel(`รหัสทรัพย์สินสำหรับ ${name}`).fill(assetCode)
  await page.screenshot({ path: `output/playwright/fr133-ready-${tag}.png`, fullPage: true })
  const [registration] = await Promise.all([
    page.waitForResponse(response => new URL(response.url()).pathname === '/api/assets/register'
      && response.request().method() === 'POST'),
    intakeRow.getByRole('button', { name: 'ลงทะเบียนทรัพย์สิน', exact: true }).click(),
  ])
  expect(registration.status(), await registration.text()).toBe(201)
  const { asset } = await registration.json()
  expect(asset.assetCode).toBe(assetCode)
  await expect(page.getByRole('status')).toContainText(assetCode)
  await expect(intakeRow).toHaveCount(0)
  const registeredRow = page.getByRole('row').filter({ hasText: assetCode })
  await expect(registeredRow).toContainText(name)

  const detail = await page.request.get(`/api/assets/register/${asset.id}?businessId=${business.id}`)
  expect(detail.ok(), await detail.text()).toBeTruthy()
  const persisted = (await detail.json()).asset
  expect(persisted.acquisitionAmount).toBe('12345.67')
  expect(persisted.currency).toBe('USD')

  await page.goto('/assets/scanner')
  await page.getByPlaceholder('เช่น AST-2026-00001').fill(assetCode)
  await page.getByRole('button', { name: 'ค้นหา', exact: true }).click()
  await expect(page.getByRole('heading', { name, exact: true })).toBeVisible()
  const [verification] = await Promise.all([
    page.waitForResponse(response => new URL(response.url()).pathname === `/api/assets/register/${asset.id}/verify`
      && response.request().method() === 'POST'),
    page.getByRole('button', { name: 'ยืนยันข้อมูล & บันทึกตรวจนับ', exact: true }).click(),
  ])
  expect(verification.status(), await verification.text()).toBe(200)
  await expect(page.getByText('✅ บันทึกการยืนยันตัวตนและการตรวจนับสำเร็จ', { exact: true })).toBeVisible()
  await page.screenshot({ path: `output/playwright/fr133-scanner-${tag}.png`, fullPage: true })
  expect(errors).toEqual([])
  expect(await page.locator('[data-nextjs-dialog]').count()).toBe(0)
})
