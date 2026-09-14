const { test, expect } = require('@playwright/test')
const { loginAsOwner, readScope } = require('./e2e-auth')
const { PrismaClient } = require('@prisma/client')
const { randomUUID } = require('node:crypto')
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
// @req FR-149 — an account created through the FR-149 deployment-secret path
//   (operator/API, unchanged) is administered on the real console: execution
//   policy, and activation requiring an explicit handoff.
// @req FR-225 — the console's own connect form is now the Thai self-serve
//   wizard, so this spec seeds its account through the API (as an operator or
//   this task's own migration would) instead of a UI field that no longer
//   exists; the wizard itself is `fr225-line-oa-self-serve-wizard.spec.js`.
// @spec ADR-061, ADR-089 D2, D7; SEC-016
// @tested tests/e2e/fr149-line-server-console.spec.js

test('LINE account onboarding persists and activation requires an explicit handoff', async ({ page }) => {
  await loginAsOwner(page)
  // The session cookie is not reliably readable by `page.request` until the
  // post-login page has actually rendered (fr080's spec establishes the same
  // synchronization point before its own `readScope` call).
  await expect(page.getByRole('button', { name: /Open Business Business 01/ })).toBeVisible()
  const scope = await readScope(page.request)
  const business = scope.businesses.find((b) => b.code === 'BUS-001')
  expect(business).toBeTruthy()

  const tag = `oa-e2e-${Date.now()}`
  createdNames.push(tag)
  // Seeded exactly as the FR-149 operator/API path still works today (deployment-secret,
  // never a browser-entered channel secret): synthetic metadata in the isolated
  // database that resolves to no real secret/provider and never activates transport.
  const destination = `U${randomUUID().replaceAll('-', '')}`
  const connectionResponse = await page.request.post('/api/line-oa/connections', {
    data: { businessId: business.id, name: tag, destination, secretRef: 'deployment-secret:synthetic-e2e-unconfigured' },
  })
  expect(connectionResponse.ok()).toBe(true)
  const connection = await connectionResponse.json()
  const accountResponse = await page.request.post('/api/line-oa/accounts', {
    data: { businessId: business.id, integrationConnectionId: connection.id, code: tag, displayName: tag },
  })
  expect(accountResponse.ok()).toBe(true)

  await page.getByRole('button', { name: /Open Business Business 01/ }).click()
  await expect(page).toHaveURL(/overview/)
  // FR-149's console is a tab of LINE Studio Enterprise now
  // (LineStudioEdgeConnection). `/line-oa` reads `?tab=` straight into the
  // shell's initial tab, so the URL selects it — and survives the reload below,
  // which a click on a tab control would not.
  await page.goto('/line-oa?tab=edge-connection')
  await expect(page.getByRole('heading', { name: 'บัญชี LINE และการตอบข้อความ' })).toBeVisible()
  await expect(page.getByRole('heading', { name: tag })).toBeVisible()
  // FR-225: the deployment-secret field is gone from this page; the wizard
  // (fr225-line-oa-self-serve-wizard.spec.js) is the only connect form now.
  await expect(page.getByLabel(/Deployment secret reference/)).toHaveCount(0)
  await expect(page.getByLabel(/Channel secret/)).toBeVisible()
  // Scope through the heading's enclosing Card without relying on its styling implementation.
  const panel = page.getByRole('heading', { name: tag }).locator('xpath=../../..')
  // Creating an account must not put it live. The card still offers the
  // activation button, and does not offer the one that exists only once server
  // transport is on — which is FR-149's "explicitly enabled" seen from the
  // console.
  await expect(panel.getByRole('button', { name: /เปิด Server Transport/ })).toBeVisible()
  await expect(panel.getByRole('button', { name: 'ปิด Server transport', exact: true })).toHaveCount(0)
  // FR-225: a mount-backed account (this one) offers the migration card, not
  // the "already in the vault" status line.
  await expect(panel.getByText('ย้ายข้อมูลรับรองเข้า Vault')).toBeVisible()
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
