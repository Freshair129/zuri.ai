const { randomUUID } = require('node:crypto')
const ExcelJS = require('exceljs')
const { test, expect } = require('@playwright/test')
const { loginAsOwner, readScope } = require('./e2e-auth')

// @req FR-164, FR-154 — a supplier workbook is previewed and its Product
//   mappings are explicitly confirmed before the cost sheet is committed.
// @spec ZAI:PROPOSAL-SMARTGIFT-COST-QUOTE-ENGINE-20260913; TASK-ZAI-053; ADR-066; SEC-001
// @tested tests/e2e/fr164-supplier-cost-sheet-import.spec.js
test('imports a supplier cost sheet after confirming each Product mapping', async ({ page }, testInfo) => {
  const errors = []
  page.on('pageerror', error => errors.push(error.message))

  await loginAsOwner(page)
  await page.getByRole('button', { name: /Open Business Business 01/ }).click()
  await expect(page).toHaveURL(/\/overview$/)
  const scope = await readScope(page.request)
  const business = scope.businesses.find(row => row.name === 'Business 01')
  expect(business).toBeTruthy()

  const tag = randomUUID().replace(/-/g, '').slice(0, 12).toUpperCase()
  const headers = { 'x-zuri-business-id': business.id }
  const post = async (url, data) => {
    const response = await page.request.post(url, { headers, data })
    const body = await response.text()
    expect(response.ok(), `${url}: HTTP ${response.status()} ${body}`).toBeTruthy()
    return JSON.parse(body)
  }

  const supplier = await post('/api/procurement/suppliers', {
    businessId: business.id, code: `COST-SUP-${tag}`, name: `Cost sheet supplier ${tag}`,
  })
  expect(supplier).toMatchObject({ businessId: business.id, status: 'ACTIVE' })
  const category = await post('/api/inventory/categories', {
    businessId: business.id, code: `COST-CAT-${tag}`, nameTh: `Cost category ${tag}`, nameEn: `Cost category ${tag}`,
  })
  const master = await post('/api/inventory/product-masters', {
    businessId: business.id, code: `COST-MASTER-${tag}`, categoryId: category.id,
    nameTh: `Cost master ${tag}`, nameEn: `Cost master ${tag}`,
  })
  const matchedSku = `COST-MATCH-${tag}`
  const unmatchedSku = `COST-UNMATCHED-${tag}`
  const matchedProduct = await post('/api/inventory/products', {
    businessId: business.id, productMasterId: master.id, code: matchedSku, name: `Matched product ${tag}`,
  })
  const manualProduct = await post('/api/inventory/products', {
    businessId: business.id, productMasterId: master.id, code: `COST-MANUAL-${tag}`, name: `Manual product ${tag}`,
  })
  expect(matchedProduct).toMatchObject({ businessId: business.id, code: matchedSku, status: 'ACTIVE' })
  expect(manualProduct).toMatchObject({ businessId: business.id, status: 'ACTIVE' })

  await page.goto('/procurement/cost-sheets')
  await expect(page.getByRole('heading', { name: 'นำเข้าตารางต้นทุนผู้ขาย' })).toBeVisible()
  const supplierSelect = page.getByLabel('ผู้ขายสำหรับ Cost Sheet')
  await expect(supplierSelect.getByRole('option', { name: `${supplier.code} · ${supplier.name}` })).toHaveCount(1)
  await supplierSelect.selectOption(supplier.id)
  await page.getByLabel('อัตราแลกเปลี่ยนที่ล็อกไว้').fill('34.5')

  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: 'ดาวน์โหลดแม่แบบ .xlsx', exact: true }).click(),
  ])
  expect(download.suggestedFilename()).toMatch(/\.xlsx$/i)
  expect(await download.failure()).toBeNull()

  // Fill the authenticated endpoint's real template without changing its header.
  const templateUrl = `/api/procurement/cost-sheets/template?${new URLSearchParams({
    businessId: business.id, currency: 'USD', fxRateLocked: '34.5',
  })}`
  const template = await page.request.get(templateUrl)
  expect(template.ok(), `${templateUrl}: HTTP ${template.status()}`).toBeTruthy()
  expect(template.headers()['content-type']).toContain('spreadsheetml')
  const workbook = new ExcelJS.Workbook()
  await workbook.xlsx.load(await template.body())
  const sheet = workbook.getWorksheet('CostSheet')
  expect(sheet, 'downloaded template must contain the CostSheet worksheet').toBeTruthy()
  const columns = new Map()
  sheet.getRow(2).eachCell((cell, column) => columns.set(String(cell.value).replace(/\*$/, ''), column))
  const rows = [
    { sku: matchedSku, min_qty: 1, unit_cost_foreign: 1.25, units_per_carton: 24, carton_cbm: 0.018, carton_kg: 4.2 },
    { sku: unmatchedSku, min_qty: 5, unit_cost_foreign: 2.5, units_per_carton: 12, carton_cbm: 0.025, carton_kg: 3.1 },
  ]
  rows.forEach((values, index) => {
    for (const [name, value] of Object.entries(values)) {
      const column = columns.get(name)
      expect(column, `template column ${name}`).toBeTruthy()
      sheet.getRow(index + 3).getCell(column).value = value
    }
  })
  const workbookPath = testInfo.outputPath(`supplier-cost-${tag}.xlsx`)
  await workbook.xlsx.writeFile(workbookPath)
  await page.getByLabel('ไฟล์ต้นทุน .xlsx').setInputFiles(workbookPath)
  await expect(page.getByText(`เลือกแล้ว: supplier-cost-${tag}.xlsx`, { exact: false })).toBeVisible()

  const [previewResponse] = await Promise.all([
    page.waitForResponse(response => new URL(response.url()).pathname === '/api/procurement/cost-sheets/xlsx'
      && response.request().method() === 'POST'),
    page.getByRole('button', { name: 'อ่านไฟล์และทำ Preview', exact: true }).click(),
  ])
  const previewBody = await previewResponse.text()
  expect(previewResponse.ok(), `Preview: HTTP ${previewResponse.status()} ${previewBody}`).toBeTruthy()
  const preview = JSON.parse(previewBody)
  expect(preview.replayed).toBe(false)
  expect(preview.sheet).toMatchObject({ businessId: business.id, supplierId: supplier.id, status: 'DRAFT', lineCount: 2, lines: [] })
  expect(preview.sheet.preview.lines).toHaveLength(2)
  expect(preview.sheet.preview.lines.find(line => line.sku === matchedSku)).toMatchObject({
    mapping: { productId: matchedProduct.id, confidence: 'EXACT_PRODUCT_CODE' },
  })
  expect(preview.sheet.preview.lines.find(line => line.sku === unmatchedSku)).toMatchObject({
    mapping: { productId: null, confidence: 'UNMATCHED', candidates: [] },
  })

  const previewTable = page.getByRole('table').filter({
    has: page.getByRole('columnheader', { name: 'เลือก Product (ไม่ยืนยันอัตโนมัติ)', exact: true }),
  })
  const matchedRow = previewTable.getByRole('row').filter({ has: page.getByRole('cell', { name: matchedSku, exact: true }) })
  const unmatchedRow = previewTable.getByRole('row').filter({ has: page.getByRole('cell', { name: unmatchedSku, exact: true }) })
  const matchedSelect = matchedRow.getByLabel(`จับคู่ Product สำหรับ ${matchedSku} ขั้นต่ำ 1`)
  const unmatchedSelect = unmatchedRow.getByLabel(`จับคู่ Product สำหรับ ${unmatchedSku} ขั้นต่ำ 5`)
  await expect(matchedRow).toContainText(`พบรหัส Product ตรงกัน: ${matchedProduct.code} · ${matchedProduct.name}`)
  await expect(matchedRow).toContainText('มีคำแนะนำจากระบบ แต่ยังไม่ได้ยืนยัน')
  await expect(matchedSelect).toHaveValue('')
  await expect(unmatchedRow).toContainText('ไม่พบ Product ที่ตรงกับ SKU นี้ — กรุณาเลือกเอง')
  await expect(unmatchedSelect).toHaveValue('')
  const commit = page.getByRole('button', { name: 'ยืนยัน Cost Sheet และบันทึก', exact: true })
  await expect(commit).toBeDisabled()
  await expect(page.getByText('เลือกและยืนยัน Product ให้ครบทุก SKU ก่อนบันทึก')).toBeVisible()
  await page.screenshot({ path: `output/playwright/fr164-cost-sheet-preview-${tag}.png`, fullPage: true })

  // Selecting only the unmatched row must still leave the suggestion unconfirmed.
  await unmatchedSelect.selectOption(manualProduct.id)
  await expect(commit).toBeDisabled()
  await expect(matchedSelect).toHaveValue('')
  await matchedRow.getByRole('button', { name: `เลือกคำแนะนำ ${matchedProduct.code} · ${matchedProduct.name}`, exact: true }).click()
  await expect(matchedSelect).toHaveValue(matchedProduct.id)
  await expect(unmatchedSelect).toHaveValue(manualProduct.id)
  await expect(commit).toBeEnabled()

  const [commitResponse] = await Promise.all([
    page.waitForResponse(response => new URL(response.url()).pathname === '/api/procurement/cost-sheets/commit'
      && response.request().method() === 'POST'),
    commit.click(),
  ])
  const commitBody = await commitResponse.text()
  expect(commitResponse.ok(), `Commit: HTTP ${commitResponse.status()} ${commitBody}`).toBeTruthy()
  const submitted = commitResponse.request().postDataJSON()
  expect(submitted.mappings).toHaveLength(2)
  expect(submitted.mappings).toEqual(expect.arrayContaining([
    { sourceSku: matchedSku, productId: matchedProduct.id, confirmed: true },
    { sourceSku: unmatchedSku, productId: manualProduct.id, confirmed: true },
  ]))
  const committed = JSON.parse(commitBody)
  expect(committed.sheet).toMatchObject({ id: preview.sheet.id, status: 'CONFIRMED', lineCount: 2 })
  await expect(page.getByText('ผลบันทึก: ยืนยันแล้ว')).toBeVisible()

  const listRow = page.getByRole('row').filter({
    has: page.getByRole('button', { name: committed.sheet.code, exact: true }),
  })
  await expect(listRow).toContainText(supplier.name)
  await expect(listRow).toContainText('ยืนยันแล้ว')
  // Reload first so the detail must come from the persisted sheet, not the
  // commit response that also populates the detail pane in the current page.
  await page.reload()
  await expect(listRow).toContainText(supplier.name)
  await expect(listRow).toContainText('ยืนยันแล้ว')
  const [detailResponse] = await Promise.all([
    page.waitForResponse(response => new URL(response.url()).pathname === `/api/procurement/cost-sheets/${committed.sheet.id}`
      && response.request().method() === 'GET'),
    listRow.getByRole('button', { name: committed.sheet.code, exact: true }).click(),
  ])
  const detailBody = await detailResponse.text()
  expect(detailResponse.ok(), `Detail: HTTP ${detailResponse.status()} ${detailBody}`).toBeTruthy()
  const persisted = JSON.parse(detailBody)
  expect(persisted).toMatchObject({ id: committed.sheet.id, status: 'CONFIRMED', lineCount: 2 })
  expect(persisted.lines).toHaveLength(2)
  expect(persisted.lines).toEqual(expect.arrayContaining([
    expect.objectContaining({ sourceSku: matchedSku, productId: matchedProduct.id }),
    expect.objectContaining({ sourceSku: unmatchedSku, productId: manualProduct.id }),
  ]))
  const detailTable = page.getByRole('table').filter({ has: page.getByRole('columnheader', { name: 'Product', exact: true }) })
  const detailMatchedRow = detailTable.getByRole('row').filter({ has: page.getByRole('cell', { name: matchedSku, exact: true }) })
  const detailUnmatchedRow = detailTable.getByRole('row').filter({ has: page.getByRole('cell', { name: unmatchedSku, exact: true }) })
  await expect(detailMatchedRow).toContainText(`${matchedProduct.code} · ${matchedProduct.name}`)
  await expect(detailUnmatchedRow).toContainText(`${manualProduct.code} · ${manualProduct.name}`)
  await page.screenshot({ path: `output/playwright/fr164-cost-sheet-detail-${tag}.png`, fullPage: true })
  expect(errors).toEqual([])
  expect(await page.locator('[data-nextjs-dialog]').count()).toBe(0)
})
