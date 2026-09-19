const { test, expect } = require('@playwright/test')
const { PrismaClient } = require('@prisma/client')
const { randomUUID } = require('node:crypto')
const { e2eTarget } = require('./e2e-target')
const { E2E_PASSWORD } = require('./e2e-auth')

// @req FR-216 — an operator reads each phase card's planned figures and its
//   measured row, and done/review cards carry their tint.
// @req FR-219 — task cards show evidence badges and a subtask progress bar.
// @req FR-218 — a report posted without the deployment bearer is refused.
// @req FR-240 — the phase card's detail row shows the token split and tool calls.
// @req FR-241 — the operator route keeps its Agent devices control usable at mobile width.
// @spec ADR-086 D1, D5, D6; ADR-048 D2
// @tested tests/e2e/fr216-programme-delivery-telemetry.spec.js
const prisma = new PrismaClient({ datasources: { db: { url: e2eTarget().databaseUrl } } })
const grantIds = []

test.afterAll(async () => {
  await prisma.platformGrant.updateMany({ where: { id: { in: grantIds } }, data: { status: 'REVOKED', revokedAt: new Date() } })
  await prisma.$disconnect()
})

test('an operator reads phase delivery metrics, task badges and subtask progress', async ({ page }, testInfo) => {
  const signup = await page.request.post('/api/auth/signup', { data: {
    email: `fr216-${randomUUID()}@example.test`, displayName: 'FR-216 operator', password: E2E_PASSWORD,
  } })
  expect(signup.status()).toBe(201)
  const { user } = await signup.json()
  const grant = await prisma.platformGrant.create({ data: { personId: user.id, capability: 'OPERATOR', status: 'ACTIVE', expiresAt: new Date(Date.now() + 3600000) } })
  grantIds.push(grant.id)

  await page.goto('/control/roadmap')
  await expect(page.getByRole('heading', { name: 'Phases, sprints and tasks' })).toBeVisible()
  await expect(page.getByTestId('delivery-legend')).toContainText('ต้องแก้')

  const phase01 = page.getByTestId('phase-metrics-PHASE-ZAI-01')
  await expect(phase01).toContainText('sprint')
  await expect(phase01).toContainText('28')
  await expect(phase01).toContainText('ชม. effort')
  await expect(phase01).toContainText('วัดจริง')
  // FR-240: the detail row splits tokens and shows tool calls for the measured lanes.
  const detail01 = page.getByTestId('phase-detail-PHASE-ZAI-01')
  await expect(detail01).toHaveAttribute('data-detail', 'true')
  await expect(detail01).toContainText('thinking')
  await expect(detail01).toContainText('tool call')
  // A phase no lane touches says so instead of showing zero.
  await expect(page.getByTestId('phase-metrics-PHASE-ZAI-06')).toContainText('ยังไม่วัด')

  // PHASE-ZAI-01 is open by default: done and review task cards are tinted.
  const doneTask = page.locator('#task-TASK-ZAI-005')
  await expect(doneTask).toHaveAttribute('data-status', 'done')
  const doneBackground = await doneTask.evaluate((el) => getComputedStyle(el).backgroundColor)
  const reviewBackground = await page.locator('#task-TASK-ZAI-001').evaluate((el) => getComputedStyle(el).backgroundColor)
  expect(doneBackground).not.toBe(reviewBackground)

  const badges = page.getByTestId('task-badges-TASK-ZAI-005')
  for (const key of ['DOC', 'CODE', 'TEST', 'FR', 'NFR', 'FEAT']) await expect(badges.locator(`[data-badge="${key}"]`)).toHaveCount(1)
  await expect(badges.locator('[data-badge="FR"]')).toHaveAttribute('data-tone', 'done')
  await expect(badges.locator('[data-badge="PRIORITY"]')).toHaveText(/^P\d$/)

  await expect(page.getByTestId('task-subtasks-TASK-ZAI-066')).toContainText('subtask')
  await expect(page.getByTestId('task-subtasks-TASK-ZAI-066').getByRole('progressbar')).toBeVisible()

  await page.locator('#task-TASK-ZAI-066').getByRole('button').first().click()
  await expect(page.getByTestId('task-telemetry-TASK-ZAI-066')).toContainText('LANE-DELIVERY-TELEMETRY')

  await page.setViewportSize({ width: 390, height: 844 })
  const devicesTab = page.getByRole('tab', { name: 'Agent devices' })
  await expect(devicesTab).toBeVisible()
  await expect(devicesTab).toHaveAttribute('aria-controls', 'roadmap-panel-devices')
  expect(await page.evaluate(() => Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) - window.innerWidth)).toBeLessThanOrEqual(1)

  await testInfo.attach('programme-telemetry', { body: await page.screenshot({ fullPage: true }), contentType: 'image/png' })

  const refused = await page.request.post('/api/platform/programme-usage-reports', { data: { source: 'codex' } })
  expect(refused.status()).toBe(401)
})
