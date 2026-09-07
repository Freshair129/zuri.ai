const { test, expect } = require('@playwright/test')
const { loginAsOwner } = require('./e2e-auth')
const { PrismaClient } = require('@prisma/client')
const { e2eTarget } = require('./e2e-target')
const createdNames = []
test.afterEach(async () => {
  // Test-owned fixture only; do not contaminate other connector inventory specs.
  const db = new PrismaClient({ datasources: { db: { url: e2eTarget().databaseUrl } } })
  try {
    const names = createdNames.splice(0)
    await db.lineOaAccount.deleteMany({ where: { connection: { name: { in: names } } } })
    await db.integrationConnection.deleteMany({ where: { name: { in: names } } })
  }
  finally { await db.$disconnect() }
})
// @req FR-149 — owner provisions metadata, creates an account and saves execution policy in the real console.
// @spec ADR-061, SEC-016
// @tested tests/e2e/fr149-line-server-console.spec.js

test('LINE account onboarding persists and activation requires an explicit handoff', async ({ page }) => {
  await loginAsOwner(page)
  await page.getByRole('button', { name: /Open Business Business 01/ }).click()
  await expect(page).toHaveURL(/overview/)
  // FR-149's console is a tab of LINE Studio Enterprise now
  // (LineStudioEdgeConnection). `/line-oa` reads `?tab=` straight into the
  // shell's initial tab, so the URL selects it — and survives the reload below,
  // which a click on a tab control would not.
  await page.goto('/line-oa?tab=edge-connection')
  await expect(page.getByRole('heading', { name: 'บัญชี LINE และการตอบข้อความ' })).toBeVisible()
  const tag = `oa-e2e-${Date.now()}`
  createdNames.push(tag)
  // main repaired this spec independently, in the opposite direction: it
  // asserted the deactivation button was visible, i.e. that creating an account
  // puts it live. That is the behaviour the owner decided to remove, so the
  // assertions below are the ones kept; main's tighter locators are adopted.
  // One submit provisions the connection and the account together now: the
  // display name names both, and the account code, destination and secret
  // reference are derived from it unless the advanced block overrides them.
  // Only the display name is required, so that is all this fixture fills.
  await page.getByLabel(/ชื่อบัญชี LINE OA \(Display Name\)/).fill(tag)
  await page.getByRole('button', { name: 'เชื่อมต่อ LINE Official Account ทันที', exact: true }).click()
  await expect(page.getByRole('heading', { name: tag })).toBeVisible()
  // Scope through the heading's enclosing Card without relying on its styling implementation.
  const panel = page.getByRole('heading', { name: tag }).locator('xpath=../../..')
  // Creating an account must not put it live. The card still offers the
  // activation button, and does not offer the one that exists only once server
  // transport is on — which is FR-149's "explicitly enabled" seen from the
  // console. The earlier form of this check asserted the activation button was
  // disabled, but the state it read was never set by anything, so it passed
  // whatever the console did.
  await expect(panel.getByRole('button', { name: /เปิด Server Transport/ })).toBeVisible()
  await expect(panel.getByRole('button', { name: 'ปิด Server transport', exact: true })).toHaveCount(0)
  await panel.getByLabel('ประมวลผลคำตอบ', { exact: true }).selectOption('EDGE')
  const saved = page.waitForResponse(response => response.request().method() === 'PATCH' && response.url().includes('/api/line-oa/accounts/'))
  await panel.getByRole('button', { name: 'บันทึกการประมวลผล', exact: true }).click()
  expect((await saved).ok()).toBe(true)
  await expect(page.locator('p[role="alert"]')).toHaveCount(0)
  await page.reload()
  await expect(page.getByRole('heading', { name: tag })).toBeVisible()
  const restored = page.getByRole('heading', { name: tag }).locator('xpath=../../..')
  await expect(restored.getByLabel('ประมวลผลคำตอบ', { exact: true })).toHaveValue('EDGE')
  await restored.getByRole('button', { name: 'ดูสถานะข้อความ', exact: true }).click()
  await expect(restored.getByText('ยังไม่มีข้อความในคิว', { exact: true })).toBeVisible()
})
