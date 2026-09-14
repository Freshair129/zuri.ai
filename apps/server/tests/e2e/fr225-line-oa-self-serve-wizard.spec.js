const { test, expect } = require('@playwright/test')
const { loginAsOwner, E2E_USERNAME } = require('./e2e-auth')
const { PrismaClient } = require('@prisma/client')
const { e2eTarget } = require('./e2e-target')

// @req FR-225 — the Thai self-serve wizard on the real console: the
// deployment-secret field is gone, the Channel ID / Channel secret fields are
// there, and — because this suite must never call the real LINE API — the one
// submission behaviour it proves end to end is the one that is guaranteed to
// return before any LINE call is made: the AAL2 step-up gate refuses a Person
// with no MFA factor first (`credential-write-gate.js`, FR-224), so this
// e2e run never reaches `api.line.me`. The full connect→validate→store→DRAFT
// path is proven without a network dependency in
// tests/integration/fr225-line-oa-self-serve-onboarding.test.js.
// @spec ADR-089 D2, D4, D7; SEC-030
// @tested tests/e2e/fr225-line-oa-self-serve-wizard.spec.js

// This is the first e2e spec to enrol MFA for the shared e2e owner; clean up
// afterwards so a later run of this spec (or any other) still finds no factor.
test.afterEach(async () => {
  const db = new PrismaClient({ datasources: { db: { url: e2eTarget().databaseUrl } } })
  try {
    const person = await db.person.findFirst({ where: { email: E2E_USERNAME } })
    if (person) await db.mfaFactor.deleteMany({ where: { personId: person.id } })
  } finally {
    await db.$disconnect()
  }
})

test('the wizard has no deployment-secret field, and a Person with no MFA factor is sent to enrolment before any LINE call', async ({ page }) => {
  await loginAsOwner(page)
  await page.getByRole('button', { name: /Open Business Business 01/ }).click()
  await expect(page).toHaveURL(/overview/)
  await page.goto('/line-oa?tab=edge-connection')
  await expect(page.getByRole('heading', { name: 'เชื่อมต่อ LINE Official Account' })).toBeVisible()

  // FR-225 exit criterion: the Studio form no longer accepts a deployment-secret reference.
  await expect(page.getByLabel(/Deployment secret reference/)).toHaveCount(0)
  await expect(page.getByLabel(/LINE bot destination/)).toHaveCount(0)
  await expect(page.getByLabel(/Channel ID/)).toBeVisible()
  await expect(page.getByLabel(/Channel secret/)).toBeVisible()

  await page.getByLabel(/ชื่อการเชื่อมต่อ/).fill('e2e wizard channel')
  await page.getByLabel(/Channel ID/).fill('1234567890')
  // Pattern-valid but not a real channel — this request never reaches LINE
  // (the AAL2/MFA gate in credential-write-gate.js runs first and refuses it).
  await page.getByLabel(/Channel secret/).fill('0123456789abcdef0123456789abcdef')

  const connectResponse = page.waitForResponse((response) => response.url().includes('/api/line-oa/connections') && response.request().method() === 'POST')
  await page.getByRole('button', { name: 'ตรวจสอบกับ LINE และบันทึก', exact: true }).click()
  const response = await connectResponse
  expect(response.status()).toBe(403)
  expect((await response.json()).error).toBe('MFA_FACTOR_REQUIRED')

  // The wizard's inline enrolment step opens — this calls only this server's
  // own /api/auth/mfa/totp/* routes, never LINE.
  await expect(page.getByText('ยังไม่ได้ตั้งค่าการยืนยันตัวตนสองขั้นตอน')).toBeVisible()
  const secretCode = page.locator('code')
  await expect(secretCode).toBeVisible()
  const secret = await secretCode.textContent()
  expect(secret?.trim().length).toBeGreaterThan(0)

  // The channel secret field is cleared once the submit that carried it
  // returned — FR-225's "no secret remains in page state after submit".
  await expect(page.getByLabel(/Channel secret/)).toHaveCount(0)
})
