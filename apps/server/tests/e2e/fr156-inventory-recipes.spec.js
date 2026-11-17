const { randomUUID } = require('node:crypto')
const { test, expect } = require('@playwright/test')
const { loginAsOwner, readScope } = require('./e2e-auth')

// @req FR-072, FR-156, FR-177 — create a recipe in the UI, inspect its ledger-derived
//   explosion, surface a shortage, then build after stock is received.
// @spec BR-002; SEC-001
// @tested tests/e2e/fr156-inventory-recipes.spec.js
test('manages an Inventory recipe and builds it through the UI', async ({ page }) => {
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))

  await loginAsOwner(page)
  await page.getByRole('button', { name: /Open Business Business 01/ }).click()
  await expect(page).toHaveURL(/\/overview$/)
  const scope = await readScope(page.request)
  const business = scope.businesses.find((row) => row.name === 'Business 01')
  expect(business).toBeTruthy()

  const tag = randomUUID().replace(/-/g, '').slice(0, 12).toUpperCase()
  const headers = { 'x-zuri-business-id': business.id }
  const post = async (url, data) => {
    const response = await page.request.post(url, { headers, data })
    const body = await response.text()
    expect(response.ok(), url + ': HTTP ' + response.status() + ' ' + body).toBeTruthy()
    return JSON.parse(body)
  }

  const category = await post('/api/inventory/categories', {
    businessId: business.id,
    code: 'RCP-CAT-' + tag,
    nameTh: 'หมวดสูตร ' + tag,
    nameEn: 'Recipe category ' + tag,
  })
  const master = await post('/api/inventory/product-masters', {
    businessId: business.id,
    code: 'RCP-MASTER-' + tag,
    categoryId: category.id,
    nameTh: 'สินค้าสูตร ' + tag,
    nameEn: 'Recipe products ' + tag,
  })
  const output = await post('/api/inventory/products', {
    businessId: business.id,
    productMasterId: master.id,
    code: 'RCP-OUTPUT-' + tag,
    name: 'Recipe output ' + tag,
    unit: 'SET',
  })
  const component = await post('/api/inventory/products', {
    businessId: business.id,
    productMasterId: master.id,
    code: 'RCP-COMPONENT-' + tag,
    name: 'Recipe component ' + tag,
  })
  expect(output).toMatchObject({ businessId: business.id, status: 'ACTIVE', stockPolicy: 'TRACKED', trackingMode: 'NONE', unit: 'SET' })
  expect(component).toMatchObject({ businessId: business.id, status: 'ACTIVE', stockPolicy: 'TRACKED' })

  const recipeCode = 'RCP-' + tag
  await page.goto('/inventory/recipes')
  await expect(page.getByRole('heading', { name: 'สูตรการผลิต (BOM)', exact: true })).toBeVisible()
  await expect(page.getByLabel('Product ผลลัพธ์').getByRole('option', {
    name: output.code + ' · ' + output.name,
    exact: true,
  })).toHaveCount(1)
  await page.getByLabel('รหัสสูตร').fill(recipeCode)
  await page.getByLabel('ชื่อสูตร').fill('สูตรทดสอบ ' + tag)
  await page.getByLabel('Product ผลลัพธ์').selectOption(output.id)
  await page.getByLabel('ขนาด batch').fill('2')
  await page.getByLabel('ผลผลิตต่อ batch').fill('2')
  await page.getByLabel('Product ของ สูตรใหม่ Component 1').selectOption(component.id)
  await page.getByLabel('จำนวนต่อ batch ของ สูตรใหม่ Component 1').fill('3')

  const [createResponse] = await Promise.all([
    page.waitForResponse((response) => new URL(response.url()).pathname === '/api/inventory/recipes'
      && response.request().method() === 'POST'),
    page.getByRole('button', { name: 'สร้างสูตร', exact: true }).click(),
  ])
  const createBody = await createResponse.text()
  expect(createResponse.ok(), 'Create: HTTP ' + createResponse.status() + ' ' + createBody).toBeTruthy()
  const submittedRecipe = createResponse.request().postDataJSON()
  expect(submittedRecipe).toMatchObject({
    businessId: business.id,
    code: recipeCode,
    productId: output.id,
    batchSize: 2,
    yieldQty: 2,
    unit: 'SET',
    lines: [{ componentProductId: component.id, qty: 3, fixed: false }],
  })
  const created = JSON.parse(createBody)
  expect(created).toMatchObject({ businessId: business.id, code: recipeCode, status: 'ACTIVE', version: 1, unit: 'SET' })
  await expect(page.getByText('สร้างสูตร ' + recipeCode + ' แล้ว', { exact: true })).toBeVisible()
  await page.screenshot({ path: 'output/playwright/fr156-recipes-created-' + tag + '.png', fullPage: true })

  const recipeRow = page.getByRole('row').filter({ hasText: recipeCode })
  await expect(recipeRow).toContainText(output.code)
  await expect(recipeRow).toContainText('2')
  await expect(recipeRow).toContainText('ใช้งาน')
  await expect(recipeRow).toContainText('1')
  const [detailResponse] = await Promise.all([
    page.waitForResponse((response) => new URL(response.url()).pathname === '/api/inventory/recipes/' + created.id
      && response.request().method() === 'GET'),
    recipeRow.getByRole('button', { name: recipeCode, exact: true }).click(),
  ])
  expect(detailResponse.ok()).toBeTruthy()
  const initialDetail = await detailResponse.json()
  expect(initialDetail).toMatchObject({ id: created.id, batchSize: 2, requirements: { quantity: 2 } })
  await page.getByLabel('จำนวนสำหรับคำนวณ BOM').fill('4')
  const [explosionResponse] = await Promise.all([
    page.waitForResponse((response) => {
      const url = new URL(response.url())
      return url.pathname === '/api/inventory/recipes/' + created.id
        && url.searchParams.get('quantity') === '4'
        && response.request().method() === 'GET'
    }),
    page.getByRole('button', { name: 'คำนวณ BOM', exact: true }).click(),
  ])
  expect(explosionResponse.ok()).toBeTruthy()
  const explosion = await explosionResponse.json()
  expect(explosion.requirements).toMatchObject({ quantity: 4, factor: 2, producedQty: 4, canBuild: false })
  expect(explosion.requirements.lines[0]).toMatchObject({
    componentProductId: component.id,
    required: 6,
    issueQty: 6,
    onHand: 0,
    shortage: 6,
  })
  await expect(page.getByText('สต๊อกไม่พอ', { exact: true })).toBeVisible()
  await expect(page.getByText('ผลิตได้สูงสุดจาก stock ledger', { exact: true })).toBeVisible()
  await page.screenshot({ path: 'output/playwright/fr156-recipes-explosion-' + tag + '.png', fullPage: true })

  await page.getByLabel('จำนวนที่ต้องการผลิต').fill('4')
  const [shortageResponse] = await Promise.all([
    page.waitForResponse((response) => new URL(response.url()).pathname === '/api/inventory/recipes/' + created.id + '/build'
      && response.request().method() === 'POST'),
    page.getByRole('button', { name: 'Build ตามสูตร', exact: true }).click(),
  ])
  const shortageBody = await shortageResponse.json()
  expect(shortageResponse.status()).toBe(409)
  expect(shortageBody).toMatchObject({
    error: 'INVENTORY_RECIPE_SHORTAGE',
    details: [{ componentProductId: component.id, code: component.code, required: 6, onHand: 0, shortage: 6 }],
  })
  await expect(page.locator('[role="alert"]:not(#__next-route-announcer__)')).toContainText('สต๊อกส่วนประกอบไม่พอสำหรับจำนวนที่ต้องการผลิต')
  await expect(page.locator('[role="alert"]:not(#__next-route-announcer__)')).toContainText(component.code)

  const receipt = await post('/api/inventory/stock-movements', {
    businessId: business.id,
    productId: component.id,
    kind: 'RECEIPT',
    quantity: 12,
    reason: 'FR156_E2E',
  })
  expect(receipt).toMatchObject({ productId: component.id, kind: 'RECEIPT', quantity: 12 })

  const [recalculatedResponse] = await Promise.all([
    page.waitForResponse((response) => {
      const url = new URL(response.url())
      return url.pathname === '/api/inventory/recipes/' + created.id
        && url.searchParams.get('quantity') === '4'
        && response.request().method() === 'GET'
    }),
    page.getByRole('button', { name: 'คำนวณ BOM', exact: true }).click(),
  ])
  expect(recalculatedResponse.ok()).toBeTruthy()
  const recalculated = await recalculatedResponse.json()
  expect(recalculated.requirements.lines[0]).toMatchObject({ onHand: 12, shortage: 0 })

  const [buildResponse] = await Promise.all([
    page.waitForResponse((response) => new URL(response.url()).pathname === '/api/inventory/recipes/' + created.id + '/build'
      && response.request().method() === 'POST'),
    page.getByRole('button', { name: 'Build ตามสูตร', exact: true }).click(),
  ])
  const buildBody = await buildResponse.text()
  expect(buildResponse.ok(), 'Build: HTTP ' + buildResponse.status() + ' ' + buildBody).toBeTruthy()
  const submittedBuild = buildResponse.request().postDataJSON()
  expect(submittedBuild).toMatchObject({ businessId: business.id, quantity: 4 })
  const built = JSON.parse(buildBody)
  expect(built).toMatchObject({
    recipeId: created.id,
    productId: output.id,
    quantity: 4,
    factor: 2,
    producedQty: 4,
    consumed: [{ componentProductId: component.id, quantity: 6, onHandAfter: 6 }],
    produced: { productId: output.id, quantity: 4, onHandAfter: 4 },
  })
  await expect(page.getByText('Build สำเร็จ · ผลิตได้ 4 หน่วย', { exact: true })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'ผลการ Build', exact: true })).toBeVisible()
  await page.screenshot({ path: 'output/playwright/fr156-recipes-build-' + tag + '.png', fullPage: true })

  expect(errors).toEqual([])
  await expect(page.locator('[data-nextjs-dialog]')).toHaveCount(0)
})
