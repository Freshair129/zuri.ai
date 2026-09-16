const { test, expect } = require('@playwright/test')
const { PrismaClient } = require('@prisma/client')
const { e2eTarget } = require('./e2e-target')
const { loginAsOwner } = require('./e2e-auth')

// @req FR-204 — from the real console the owner declares a pack size on a SKU's
//   detail page, records a receipt of two packs from the dashboard and sees
//   the ledger take 24 base units; the conversion is edited and retired from
//   the same page.
// @req FR-203 — the owner adds a pack barcode, the form refuses a GTIN whose
//   check digit fails before sending it, the server refuses the same barcode
//   on a second SKU and the page names the SKU that holds it, a retire takes
//   two clicks, and the dashboard lookup opens the SKU a barcode names.
// @spec ADR-083 D3, D4; BR-002, BR-037; SEC-001
// @tested tests/e2e/fr203-sku-identifiers-console.spec.js
const prisma = new PrismaClient({ datasources: { db: { url: e2eTarget().databaseUrl } } })
let fixture

// GS1 check digits computed here, so each run uses a fresh valid GTIN-13.
function gtin13(twelveDigits) {
  const sum = twelveDigits.split('').map(Number).reverse().reduce((acc, d, i) => acc + d * (i % 2 === 0 ? 3 : 1), 0)
  return `${twelveDigits}${(10 - (sum % 10)) % 10}`
}

test.beforeAll(async () => {
  const tag = `${Date.now()}`.slice(-9)
  const tenant = await prisma.tenant.findUnique({ where: { code: 'TNT-001' } })
  const business = await prisma.business.findFirst({ where: { tenantId: tenant.id, code: 'BUS-001' } })
  const scope = { tenantId: tenant.id, businessId: business.id }
  const category = await prisma.inventoryCategory.create({ data: { ...scope, code: `ID-CAT-${tag}`, nameTh: 'หมวดบาร์โค้ด', nameEn: 'Identifier fixture' } })
  const master = await prisma.productMaster.create({ data: { ...scope, code: `ID-PM-${tag}`, nameTh: 'น้ำดื่ม', nameEn: 'Water', categoryId: category.id } })
  const bottle = await prisma.product.create({ data: { ...scope, code: `ID-BOTTLE-${tag}`, name: 'น้ำดื่มขวด', productMasterId: master.id, stockPolicy: 'TRACKED', trackingMode: 'NONE', unit: 'EA', safetyStock: 0 } })
  const other = await prisma.product.create({ data: { ...scope, code: `ID-OTHER-${tag}`, name: 'น้ำดื่มขวดใหญ่', productMasterId: master.id, stockPolicy: 'TRACKED', trackingMode: 'NONE', unit: 'EA', safetyStock: 0 } })
  const valid = gtin13(`885${tag}`)
  const broken = `${valid.slice(0, 12)}${(Number(valid.at(-1)) + 1) % 10}`
  fixture = { business, bottle, other, valid, broken }
})
test.afterAll(async () => prisma.$disconnect())

test('FR-203/FR-204 — barcodes and pack sizes are managed on the SKU page and used from the dashboard', async ({ page }) => {
  const { bottle, other, valid, broken } = fixture
  await loginAsOwner(page)
  await page.getByRole('button', { name: /Open Business Business 01/ }).click()
  await expect(page).toHaveURL(/\/overview$/)

  // The dashboard SKU code opens the detail page.
  await page.goto('/inventory')
  await page.getByRole('row').filter({ hasText: bottle.code }).getByRole('link', { name: bottle.code, exact: true }).click()
  await expect(page).toHaveURL(new RegExp(`/inventory/products/${bottle.id}$`))
  await expect(page.getByRole('heading', { name: bottle.code })).toBeVisible()
  await expect(page.getByText('ยังไม่มีหน่วยแปลง')).toBeVisible()

  // A pack size: 1 BOX12 = 12 EA, bought in boxes.
  await page.getByLabel('รหัสหน่วย', { exact: true }).fill('BOX12')
  await page.getByLabel('ตัวคูณ (1 หน่วยนี้ = ? EA)', { exact: true }).fill('12')
  await page.getByLabel('ชื่อหน่วย (ถ้ามี)', { exact: true }).fill('กล่อง 12 ขวด')
  await page.getByLabel('ใช้กับ', { exact: true }).selectOption('PURCHASE')
  await expect(page.getByText('1 BOX12 = 12 EA').first()).toBeVisible()
  await page.getByRole('button', { name: 'เพิ่มหน่วยแปลง', exact: true }).click()
  await expect(page.getByRole('status')).toContainText('เพิ่มหน่วยแปลง 1 BOX12 = 12 EA แล้ว')

  // A GTIN whose check digit fails is caught before it is sent.
  await page.getByLabel('ชนิดรหัส', { exact: true }).selectOption('GTIN')
  await page.getByLabel('รหัส', { exact: true }).fill(broken)
  await expect(page.getByText('เลขตรวจสอบ (check digit) ของ GTIN ไม่ถูกต้อง')).toBeVisible()
  await expect(page.getByRole('button', { name: 'เพิ่มรหัส', exact: true })).toBeDisabled()

  // The valid GTIN sits on the box.
  await page.getByLabel('รหัส', { exact: true }).fill(valid)
  await page.getByLabel('ผู้ออกรหัส (ถ้ามี)', { exact: true }).fill('GS1')
  await page.getByLabel('รหัสนี้ติดอยู่บนหน่วย', { exact: true }).selectOption('BOX12')
  await page.getByRole('button', { name: 'เพิ่มรหัส', exact: true }).click()
  await expect(page.getByRole('status')).toContainText(`เพิ่มGTIN / EAN / UPC ${valid} แล้ว`)
  await expect(page.getByRole('row').filter({ hasText: valid })).toContainText('BOX12')
  await expect(page.locator('p[role="alert"]')).toHaveCount(0)

  // The same barcode on a second SKU is refused, and the page names who holds it.
  await page.goto(`/inventory/products/${other.id}`)
  await expect(page.getByRole('heading', { name: other.code })).toBeVisible()
  await page.getByLabel('ชนิดรหัส', { exact: true }).selectOption('BARCODE')
  await page.getByLabel('รหัส', { exact: true }).fill(valid)
  await page.getByRole('button', { name: 'เพิ่มรหัส', exact: true }).click()
  await expect(page.locator('p[role="alert"]')).toContainText(`รหัสนี้เป็นของ SKU ${bottle.code} อยู่แล้ว`)
  await expect(page.getByRole('link', { name: `เปิด SKU ${bottle.code}` })).toBeVisible()

  // The dashboard lookup resolves the barcode to the SKU that holds it.
  await page.goto('/inventory')
  await page.getByLabel('บาร์โค้ดหรือรหัส', { exact: true }).fill(valid)
  await page.getByRole('button', { name: 'ค้นหา', exact: true }).click()
  await expect(page).toHaveURL(new RegExp(`/inventory/products/${bottle.id}$`))
  await page.goto('/inventory')
  await page.getByLabel('บาร์โค้ดหรือรหัส', { exact: true }).fill('NOBODY-HAS-THIS')
  await page.getByRole('button', { name: 'ค้นหา', exact: true }).click()
  await expect(page.getByText('ไม่พบ SKU ที่ใช้รหัส NOBODY-HAS-THIS')).toBeVisible()

  // A receipt of two boxes lands as 24 base units.
  await page.getByLabel('SKU', { exact: true }).selectOption({ label: `${bottle.code} · ${bottle.name}` })
  await page.getByLabel('จำนวน', { exact: true }).fill('2')
  await page.getByLabel('หน่วย', { exact: true }).selectOption('BOX12')
  await expect(page.getByText('= 24 EA ในสต๊อก')).toBeVisible()
  const recorded = page.waitForResponse((response) => response.request().method() === 'POST' && response.url().includes('/api/inventory/stock-movements'))
  await page.getByRole('button', { name: 'บันทึก', exact: true }).click()
  expect((await recorded).ok()).toBe(true)
  await expect(page.getByRole('status')).toContainText('รับเข้า 24 หน่วย (2 BOX12) · คงเหลือ 0 → 24')
  // The earlier lookup's "not found" does not linger beside the new result.
  await expect(page.getByText('ไม่พบ SKU ที่ใช้รหัส NOBODY-HAS-THIS')).toHaveCount(0)
  await expect(page.getByRole('row').filter({ hasText: bottle.code })).toContainText('24 EA')

  // Back on the SKU: edit the factor, then retire the barcode and the conversion, each in two clicks.
  await page.goto(`/inventory/products/${bottle.id}`)
  const conversionRow = page.getByRole('row').filter({ hasText: '1 BOX12 = 12 EA' })
  await conversionRow.getByRole('button', { name: 'แก้ไข', exact: true }).click()
  await page.getByLabel('ตัวคูณ (1 BOX12 = ? EA)', { exact: true }).fill('10')
  await page.getByRole('button', { name: 'บันทึกหน่วยแปลง', exact: true }).click()
  await expect(page.getByRole('status')).toContainText('บันทึกหน่วยแปลง 1 BOX12 = 10 EA แล้ว')

  const barcodeRow = page.getByRole('row').filter({ hasText: valid })
  await barcodeRow.getByRole('button', { name: 'ยกเลิก', exact: true }).click()
  await barcodeRow.getByRole('button', { name: 'ยืนยันยกเลิก', exact: true }).click()
  await expect(page.getByRole('status')).toContainText(`ยกเลิกรหัส ${valid} แล้ว`)
  await expect(page.getByRole('row').filter({ hasText: valid })).toHaveCount(0)
  await page.getByLabel('แสดงรายการที่ยกเลิกแล้ว', { exact: true }).check()
  await expect(page.getByRole('row').filter({ hasText: valid })).toContainText('ยกเลิกแล้ว')

  const boxRow = page.getByRole('row').filter({ hasText: '1 BOX12 = 10 EA' })
  await boxRow.getByRole('button', { name: 'ยกเลิก', exact: true }).click()
  await boxRow.getByRole('button', { name: 'ยืนยันยกเลิก', exact: true }).click()
  await expect(page.getByRole('status')).toContainText('ยกเลิกหน่วยแปลง BOX12 แล้ว')
  await expect(page.locator('p[role="alert"]')).toHaveCount(0)
  await page.screenshot({ path: 'output/playwright/fr203-sku-identifiers-console.png', fullPage: true })
})
