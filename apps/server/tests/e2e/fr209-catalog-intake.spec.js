const { test, expect } = require('@playwright/test')
const ExcelJS = require('exceljs')
const { PrismaClient } = require('@prisma/client')
const { e2eTarget } = require('./e2e-target')
const { loginAsOwner } = require('./e2e-auth')

// @req FR-209 — from the real console the owner downloads this Business's
//   workbook template through the API, fills it, uploads it on the Import tab,
//   reads a preview in which one row matches an existing SKU by its barcode,
//   one creates a SKU and one is invalid, cannot confirm while a row is
//   invalid, uploads the corrected file and confirms the batch.
// @req FR-208 — the committed batch created exactly one SKU and added the
//   barcode to the matched one without renaming it; a pasted JSON preview is
//   cancelled and writes nothing.
// @spec ADR-084 D1..D3; BR-041; SEC-001
// @tested tests/e2e/fr209-catalog-intake.spec.js
const prisma = new PrismaClient({ datasources: { db: { url: e2eTarget().databaseUrl } } })
let fixture

function gtin13(twelveDigits) {
  const sum = twelveDigits.split('').map(Number).reverse().reduce((acc, d, i) => acc + d * (i % 2 === 0 ? 3 : 1), 0)
  return `${twelveDigits}${(10 - (sum % 10)) % 10}`
}

test.beforeAll(async () => {
  const tag = `${Date.now()}`.slice(-9)
  const tenant = await prisma.tenant.findUnique({ where: { code: 'TNT-001' } })
  const business = await prisma.business.findFirst({ where: { tenantId: tenant.id, code: 'BUS-001' } })
  const scope = { tenantId: tenant.id, businessId: business.id }
  const category = await prisma.inventoryCategory.create({ data: { ...scope, code: `CI-CAT-${tag}`, nameTh: 'หมวดนำเข้า', nameEn: 'Intake fixture' } })
  const master = await prisma.productMaster.create({ data: { ...scope, code: `CI-PM-${tag}`, nameTh: 'แก้วนำเข้า', nameEn: 'Intake cups', categoryId: category.id } })
  const existing = await prisma.product.create({ data: { ...scope, code: `CI-OLD-${tag}`, name: 'แก้วเดิม', productMasterId: master.id, stockPolicy: 'TRACKED', trackingMode: 'NONE', unit: 'EA', safetyStock: 0 } })
  const existingGtin = gtin13(`884${tag}`)
  await prisma.productIdentifier.create({ data: { ...scope, productId: existing.id, kind: 'GTIN', value: existingGtin, status: 'ACTIVE' } })
  fixture = { tag, business, master, existing, existingGtin }
})
test.afterAll(async () => prisma.$disconnect())

/** Fill the downloaded template's Products sheet by header name, never by position. */
async function filledWorkbook(templateBuffer, rows) {
  const workbook = new ExcelJS.Workbook()
  await workbook.xlsx.load(templateBuffer)
  const sheet = workbook.getWorksheet('Products')
  const headers = []
  sheet.getRow(2).eachCell({ includeEmpty: false }, (cell, column) => { headers[column] = String(cell.value).replace(/\*$/, '') })
  rows.forEach((values, i) => {
    const row = sheet.getRow(3 + i)
    for (const [key, value] of Object.entries(values)) {
      const column = headers.indexOf(key)
      if (column < 1) throw new Error(`template has no column ${key}`)
      row.getCell(column).value = value
    }
  })
  return Buffer.from(await workbook.xlsx.writeBuffer())
}

test('FR-208/FR-209 — a workbook is previewed row by row, fixed, and committed all at once from the Import tab', async ({ page }) => {
  const { tag, business, master, existing, existingGtin } = fixture
  await loginAsOwner(page)
  await page.getByRole('button', { name: /Open Business Business 01/ }).click()
  await expect(page).toHaveURL(/\/overview$/)

  await page.goto('/inventory/catalog-intake')
  await expect(page.getByRole('heading', { name: 'นำเข้าสินค้า' })).toBeVisible()
  const templateLink = page.getByRole('link', { name: 'ดาวน์โหลดแม่แบบ' })
  await expect(templateLink).toHaveAttribute('href', `/api/inventory/catalog-intakes/template?businessId=${business.id}`)

  // The real template, downloaded with the owner's session, lists this Business's own master.
  const download = await page.request.get(`/api/inventory/catalog-intakes/template?businessId=${business.id}`)
  expect(download.ok()).toBe(true)
  expect(download.headers()['content-type']).toContain('spreadsheetml')
  const template = await download.body()
  const lookups = new ExcelJS.Workbook()
  await lookups.xlsx.load(template)
  const lookupValues = lookups.getWorksheet('Lookups').getSheetValues().filter(Boolean).map((r) => r[2])
  expect(lookupValues).toContain(master.code)

  const newCode = `CI-NEW-${tag}`
  const badCode = `CI-BAD-${tag}`
  const newGtin = gtin13(`883${tag}`)
  const withInvalidRow = await filledWorkbook(template, [
    { sku_code: `CI-RENAMED-${tag}`, sku_name: 'ชื่อใหม่ในไฟล์', master_code: master.code, gtin: existingGtin, supplier_code: `SUP-${tag}` },
    { sku_code: newCode, sku_name: 'แก้วใหม่จาก Excel', master_code: master.code, gtin: newGtin, unit_conversions: 'BOX12=12' },
    { sku_code: badCode, master_code: master.code, safety_stock: 'many' },
  ])

  await page.getByLabel('ไฟล์ .xlsx ที่กรอกแล้ว', { exact: true }).setInputFiles({ name: 'catalog.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', buffer: withInvalidRow })
  await page.getByRole('button', { name: 'ตรวจไฟล์', exact: true }).click()
  await expect(page.getByRole('status')).toContainText('ยังไม่มีอะไรถูกบันทึก')
  const rowOf = (text) => page.getByRole('row').filter({ hasText: text })
  await expect(rowOf('แถว 3')).toContainText('พบของเดิม · เพิ่มข้อมูล')
  await expect(rowOf('แถว 3')).toContainText('ตรงบาร์โค้ด/รหัสคู่ค้า')
  await expect(rowOf('แถว 3').getByRole('link', { name: existing.code })).toBeVisible()
  await expect(rowOf('แถว 3')).toContainText('ไม่แก้ข้อมูลของ SKU ที่มีอยู่')
  await expect(rowOf('แถว 4')).toContainText('สร้างใหม่')
  await expect(rowOf('แถว 5')).toContainText('ข้อมูลผิด')
  await expect(rowOf('แถว 5')).toContainText('sku.safetyStock')
  await expect(page.getByRole('button', { name: 'ยืนยันบันทึกทั้งชุด', exact: true })).toBeDisabled()
  await expect(page.getByText('ระบบบันทึกทั้งชุดหรือไม่บันทึกเลย').first()).toBeVisible()
  expect(await prisma.product.count({ where: { businessId: business.id, code: { in: [newCode, badCode] } } })).toBe(0)

  // The corrected file is different bytes, so it previews as a new intake — and this one can be confirmed.
  const corrected = await filledWorkbook(template, [
    { sku_code: `CI-RENAMED-${tag}`, sku_name: 'ชื่อใหม่ในไฟล์', master_code: master.code, gtin: existingGtin, supplier_code: `SUP-${tag}` },
    { sku_code: newCode, sku_name: 'แก้วใหม่จาก Excel', master_code: master.code, gtin: newGtin, unit_conversions: 'BOX12=12' },
  ])
  await page.getByLabel('ไฟล์ .xlsx ที่กรอกแล้ว', { exact: true }).setInputFiles({ name: 'catalog-fixed.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', buffer: corrected })
  await page.getByRole('button', { name: 'ตรวจไฟล์', exact: true }).click()
  await expect(rowOf('แถว 5')).toHaveCount(0)
  const confirm = page.getByRole('button', { name: 'ยืนยันบันทึกทั้งชุด', exact: true })
  await expect(confirm).toBeEnabled()
  const committed = page.waitForResponse((response) => response.request().method() === 'POST' && response.url().includes('/api/inventory/catalog-intakes/commit'))
  await confirm.click()
  expect((await committed).ok()).toBe(true)
  await expect(page.getByRole('status')).toContainText('สร้าง SKU ใหม่ 1 · เพิ่มข้อมูลให้ SKU เดิม 1')
  await expect(page.locator('p[role="alert"]')).toHaveCount(0)
  await expect(rowOf('แถว 4').getByRole('link', { name: newCode })).toBeVisible()

  // What the database now holds: one new SKU with its barcode and pack; the matched SKU kept its code and name.
  const created = await prisma.product.findFirst({ where: { businessId: business.id, code: newCode }, include: { identifiers: true, unitConversions: true } })
  expect(created.identifiers.map((i) => i.value)).toEqual([newGtin])
  expect(created.unitConversions.map((c) => [c.unit, c.factor])).toEqual([['BOX12', 12]])
  const kept = await prisma.product.findUnique({ where: { id: existing.id }, include: { identifiers: true } })
  expect(kept).toMatchObject({ code: existing.code, name: 'แก้วเดิม' })
  expect(kept.identifiers.map((i) => i.value).sort()).toEqual([existingGtin, `SUP-${tag}`].sort())
  expect(await prisma.product.count({ where: { businessId: business.id, code: `CI-RENAMED-${tag}` } })).toBe(0)

  // A pasted JSON preview is its own intake; cancelling it writes nothing.
  const jsonCode = `CI-JSON-${tag}`
  await page.getByLabel('รายการ (JSON)', { exact: true }).fill(JSON.stringify([{ sku: { code: jsonCode, name: 'จาก JSON' }, master: { code: master.code } }]))
  await page.getByRole('button', { name: 'ตรวจ JSON', exact: true }).click()
  await expect(rowOf(jsonCode)).toContainText('สร้างใหม่')
  await page.getByRole('button', { name: 'ยกเลิก', exact: true }).click()
  await expect(page.getByRole('status')).toContainText('ไม่มีอะไรถูกบันทึก')
  expect(await prisma.product.count({ where: { businessId: business.id, code: jsonCode } })).toBe(0)
  const recent = page.getByRole('row').filter({ hasText: 'ยกเลิกแล้ว' })
  await expect(recent.first()).toBeVisible()
  await page.screenshot({ path: 'output/playwright/fr209-catalog-intake.png', fullPage: true })
})
