// @req FR-185 — real owner-backed planning, immutable revisions, retry identity,
// and truthful read surfaces remain scoped at mobile width.
// @spec SDD-086, SEC-001, SEC-003
// @tested tests/e2e/marketing-p5.spec.js
const { test, expect } = require('@playwright/test')
const { PrismaClient } = require('@prisma/client')
const { loginAsOwner } = require('./e2e-auth')
const { e2eTarget } = require('./e2e-target')
const db = new PrismaClient({ datasources: { db: { url: e2eTarget().databaseUrl } } })
let fixture
test.beforeAll(async () => {
  const tag = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
  const owner = await db.person.findUnique({ where: { code: 'PER-OWNER' } })
  const tenant = await db.tenant.findUnique({ where: { code: 'TNT-001' } })
  const business = await db.business.create({ data: { code: `BRD-${tag}`, name: 'Broadcast browser fixture', tenantId: tenant.id } })
  const other = await db.business.create({ data: { code: `BRD-B-${tag}`, name: 'Broadcast other fixture', tenantId: tenant.id } })
  for (const row of [business, other]) await db.membership.create({ data: { personId: owner.id, tenantId: tenant.id, businessId: row.id, role: 'OWNER', status: 'ACTIVE', domainKeysJson: '["growth","line-oa","commerce","projects"]' } })
  const provider = await db.integrationProvider.upsert({ where: { code: 'LINE_OA' }, create: { code: 'LINE_OA', name: 'LINE Official Account' }, update: {} })
  const connection = await db.integrationConnection.create({ data: { tenantId: tenant.id, businessId: business.id, providerId: provider.id, name: `Planning fixture ${tag}`, externalAccountId: `fixture-${tag}`, status: 'ACTIVE' } })
  const account = await db.lineOaAccount.create({ data: { tenantId: tenant.id, businessId: business.id, integrationConnectionId: connection.id, code: `BRD-OA-${tag}`, displayName: 'บัญชีทดสอบวางแผน', status: 'CONNECTED', serverEnabled: false } })
  fixture = { business, other, account }
})
test.afterAll(async () => db.$disconnect())

async function enter(page, business = fixture.business) {
  await loginAsOwner(page)
  await page.getByRole('button', { name: `Open Business ${business.name}`, exact: true }).filter({ hasText: business.code }).click()
  await expect(page).toHaveURL(/\/overview$/)
}
async function createContent(page, title) {
  const result = await page.request.post('/api/growth/content', { data: {
    businessId: fixture.business.id, title,
    payload: { objective: 'Review a fixture plan', audience: 'Fixture reviewers', message: 'Fixture message', claims: 'Fixture only', shotList: 'Opening and close', acceptanceCriteria: 'Readable fixture', evidenceReference: 'facts://e2e/broadcast', format: 'IMAGE', channels: ['SEO'], initiativeId: null, asset: null, rights: null, production: null },
  } })
  expect(result.ok(), await result.text()).toBe(true)
  return result.json()
}

test('owner pickers create one plan after response loss, then preserve revisions and archive on reload', async ({ page }) => {
  test.setTimeout(180000)
  await enter(page)
  const content = await createContent(page, 'เนื้อหาทดสอบสำหรับแผน')
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/growth/broadcast')
  await page.getByLabel('รหัสแผน', { exact: true }).fill('BROWSER-PLAN')
  await page.getByLabel('เนื้อหาที่ใช้วางแผน', { exact: true }).selectOption(content.id)
  await page.getByLabel('บัญชี LINE OA', { exact: true }).selectOption(fixture.account.id)
  await expect(page.getByText('Content payload hash', { exact: true })).toHaveCount(0)
  const keys = []
  let saved
  await page.route('**/api/growth/broadcast-intents', async route => {
    if (route.request().method() !== 'POST') return route.continue()
    keys.push(route.request().postDataJSON().idempotencyKey)
    if (keys.length === 1) {
      const response = await route.fetch()
      expect(response.ok(), await response.text()).toBe(true)
      saved = await response.json()
      await route.abort('failed')
    } else await route.continue()
  })
  await page.getByRole('button', { name: 'บันทึกแผน', exact: true }).click()
  await expect(page.getByRole('alert').filter({ hasText: 'ยังยืนยันการบันทึกไม่ได้' })).toBeVisible()
  await page.getByRole('button', { name: 'ลองคำขอเดิมอีกครั้ง', exact: true }).click()
  await expect(page.getByTestId('broadcast-detail')).toContainText('BROWSER-PLAN')
  expect(keys).toHaveLength(2)
  expect(keys[0]).toBe(keys[1])
  expect(await db.marketingBroadcastIntent.count({ where: { businessId: fixture.business.id } })).toBe(1)
  await page.reload()
  await page.getByRole('button', { name: /BROWSER-PLAN · เวอร์ชัน 1/ }).click()
  await page.getByRole('button', { name: 'แก้ไขแผน', exact: true }).click()
  await page.getByLabel('บัญชี LINE OA', { exact: true }).selectOption('')
  await page.getByRole('button', { name: 'บันทึกแผน', exact: true }).click()
  await expect(page.getByTestId('broadcast-detail')).toContainText('เวอร์ชันแผน 2')
  expect(await db.marketingBroadcastIntentVersion.count({ where: { intentId: saved.id } })).toBe(2)
  await page.getByRole('button', { name: 'เก็บแผนเข้าคลัง', exact: true }).click()
  await expect(page.getByRole('status').filter({ hasText: 'เก็บแผนเข้าคลังแล้ว' })).toBeVisible()
  await page.reload()
  await page.getByRole('button', { name: /BROWSER-PLAN · เวอร์ชัน 2/ }).click()
  await expect(page.getByTestId('broadcast-detail')).toContainText('เวอร์ชันแผน 2')
  await expect(page.getByTestId('broadcast-detail')).toContainText('ARCHIVED')
  await expect(page.getByRole('button', { name: 'แก้ไขแผน', exact: true })).toHaveCount(0)
  const row = await db.marketingBroadcastIntent.findUnique({ where: { id: saved.id } })
  expect(row.status).toBe('ARCHIVED')
  await page.screenshot({ path: 'output/playwright/fr185-broadcast-mobile.png', fullPage: true })
})

test('an unavailable stored revision stays readable without an unsafe Edit action', async ({ page }) => {
  await enter(page)
  const content = await createContent(page, 'Malformed revision fixture')
  await page.goto('/growth/broadcast')
  await page.getByLabel('รหัสแผน', { exact: true }).fill('UNAVAILABLE-PLAN')
  await page.getByLabel('เนื้อหาที่ใช้วางแผน', { exact: true }).selectOption(content.id)
  await page.getByRole('button', { name: 'บันทึกแผน', exact: true }).click()
  await expect(page.getByTestId('broadcast-detail')).toContainText('UNAVAILABLE-PLAN')
  const intent = await db.marketingBroadcastIntent.findFirstOrThrow({ where: { businessId: fixture.business.id, code: 'UNAVAILABLE-PLAN' } })
  await db.marketingBroadcastIntentVersion.updateMany({ where: { intentId: intent.id }, data: { payloadJson: '{}' } })
  await page.reload()
  await page.getByRole('button', { name: /UNAVAILABLE-PLAN · เวอร์ชัน 1/ }).click()
  await expect(page.getByTestId('broadcast-detail')).toContainText('ข้อมูลอ้างอิงบางส่วนไม่พร้อมใช้')
  await expect(page.getByRole('button', { name: 'แก้ไขแผน', exact: true })).toBeDisabled()
  await expect(page.getByRole('button', { name: 'เก็บแผนเข้าคลัง', exact: true })).toBeEnabled()
  const response = await page.request.get(`/api/growth/broadcast-intents/${intent.id}?businessId=${fixture.business.id}`)
  expect(response.ok()).toBe(true)
  expect((await response.json()).currentVersion).toMatchObject({ state: 'UNAVAILABLE', payload: null })
})

test('paid metrics and deterministic AskMarketing preserve unavailable evidence', async ({ page }) => {
  await enter(page)
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/growth/paid-media')
  await expect(page.getByRole('heading', { name: 'Paid Media', exact: true })).toBeVisible()
  const response = await page.request.get(`/api/growth/paid-media?businessId=${fixture.business.id}`)
  expect(response.ok()).toBe(true)
  const paid = await response.json()
  expect(paid.metrics).toHaveLength(6)
  expect(paid.metrics.every(metric => metric.value === null && metric.state === 'UNAVAILABLE')).toBe(true)
  await expect(page.getByText('UNAVAILABLE', { exact: true }).first()).toBeVisible()
  await page.goto('/growth/ask-marketing')
  await page.getByLabel('Marketing question').fill('roas')
  await page.getByRole('button', { name: 'Ask', exact: true }).click()
  await expect(page.getByText('No measured answer is available for this question.')).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  await page.reload()
  await expect(page.getByRole('heading', { name: 'AskMarketing', exact: true })).toBeVisible()
})

test('a delayed owner content read cannot carry choices into another Business', async ({ page }) => {
  await enter(page)
  let release
  let started
  const reached = new Promise(resolve => { started = resolve })
  const gate = new Promise(resolve => { release = resolve })
  await page.route(`**/api/growth/content?businessId=${fixture.business.id}`, async route => {
    const response = await route.fetch()
    started()
    await gate
    await route.fulfill({ response })
  })
  await page.goto('/growth/broadcast')
  await reached
  await page.goto('/businesses')
  await page.getByRole('button', { name: `Open Business ${fixture.other.name}`, exact: true }).filter({ hasText: fixture.other.code }).click()
  await expect(page).toHaveURL(/\/overview$/)
  await page.goto('/growth/broadcast')
  release()
  await expect(page.getByLabel('เนื้อหาที่ใช้วางแผน', { exact: true })).toBeEnabled()
  await expect(page.getByLabel('เนื้อหาที่ใช้วางแผน', { exact: true }).locator('option')).toHaveCount(1)
  await expect(page.getByLabel('บัญชี LINE OA', { exact: true })).not.toContainText(fixture.account.displayName)
  await expect(page.getByTestId('broadcast-detail')).toHaveCount(0)
})
