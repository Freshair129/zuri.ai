const { test, expect } = require('@playwright/test')
const { PrismaClient } = require('@prisma/client')
const { randomUUID } = require('node:crypto')
const { e2eTarget } = require('./e2e-target')
const { E2E_PASSWORD, loginAsOwner } = require('./e2e-auth')

// @req FR-220 — a harness pairs through a signed-in browser: a member's device is
//   pending until an operator activates it, the key reports usage and nothing else,
//   and a revoked device is refused on its next report.
// @req FR-221 — the report is attributed to the approving person and shows on the
//   programme board broken down by person.
// @spec ADR-087 D1-D5; SEC-025, SEC-001
// @tested tests/e2e/fr220-harness-pairing.spec.js
const prisma = new PrismaClient({ datasources: { db: { url: e2eTarget().databaseUrl } } })
const grantIds = []

test.afterAll(async () => {
  await prisma.platformGrant.updateMany({ where: { id: { in: grantIds } }, data: { status: 'REVOKED', revokedAt: new Date() } })
  await prisma.$disconnect()
})

const report = (over = {}) => ({
  source: 'claude-code',
  sessionId: `e2e-${randomUUID()}`,
  branch: 'feat/harness-usage-plugin',
  repository: 'Freshair129/zuri.ai',
  aiAccount: 'e2e-account',
  inputTokens: 120,
  cacheWriteTokens: 3000,
  cacheReadTokens: 80000,
  outputTokens: 900,
  requestCount: 12,
  activeMinutes: 18,
  startedAt: '2026-09-14T01:00:00.000Z',
  endedAt: '2026-09-14T01:30:00.000Z',
  ...over,
})

test('a member pairs a device, an operator activates it, its report lands on the board, and revoke stops it', async ({ page, request, browser }) => {
  const deviceLabel = `E2E-HARNESS-${randomUUID().slice(0, 8)}`
  const start = await request.post('/api/platform/harness-pairing/start', { data: { harness: 'CLAUDE_CODE', deviceLabel, osUser: 'e2e' } })
  expect(start.status()).toBe(200)
  const started = await start.json()
  expect(started.approvalUrl).toContain('/harness/pair#')

  // The member (the seeded owner holds a visible Business) approves for themselves.
  await loginAsOwner(page)
  await page.goto(started.approvalUrl)
  await expect(page.getByTestId('harness-pair-check-code')).toHaveText(started.checkCode)
  await expect(page.getByTestId('harness-pair-request')).toContainText(deviceLabel)
  await page.getByRole('button', { name: 'ยืนยันจับคู่เครื่องนี้' }).click()
  await expect(page.getByTestId('harness-pair-approved')).toBeVisible()

  const poll = await request.post('/api/platform/harness-pairing/poll', { data: { requestId: started.requestId }, headers: { authorization: `Bearer ${started.deviceSecret}` } })
  const paired = await poll.json()
  expect(paired).toMatchObject({ state: 'PAIRED', pairing: { status: 'PENDING_ACTIVATION', deviceLabel } })
  const key = paired.pairing.key
  expect(key).toMatch(/^hrnk_/)
  const again = await request.post('/api/platform/harness-pairing/poll', { data: { requestId: started.requestId }, headers: { authorization: `Bearer ${started.deviceSecret}` } })
  expect(again.status()).toBe(410)

  const auth = { authorization: `Bearer ${key}` }
  const pending = await request.post('/api/platform/programme-usage-reports', { data: report(), headers: auth })
  expect(pending.status()).toBe(403)
  // The key is not a viewer anywhere else.
  expect((await request.get('/api/projects', { headers: auth })).status()).toBe(401)

  // An operator activates the device from the Agent devices tab.
  const operatorContext = await browser.newContext()
  const operator = await operatorContext.newPage()
  const signup = await operator.request.post('/api/auth/signup', { data: { email: `fr220-${randomUUID()}@example.test`, displayName: 'FR-220 operator', password: E2E_PASSWORD } })
  expect(signup.status()).toBe(201)
  const { user } = await signup.json()
  const grant = await prisma.platformGrant.create({ data: { personId: user.id, capability: 'OPERATOR', status: 'ACTIVE', expiresAt: new Date(Date.now() + 3600000) } })
  grantIds.push(grant.id)
  await operator.goto('/control/roadmap?view=devices')
  const row = operator.getByTestId(`harness-device-${paired.pairing.installationId}`)
  await expect(row).toContainText(deviceLabel)
  await expect(row).toContainText('PENDING_ACTIVATION')
  await row.getByRole('button', { name: 'เปิดใช้งาน' }).click()
  await expect(row).toContainText('ACTIVE')

  const whoami = await (await request.get('/api/platform/programme-usage-reports/whoami', { headers: auth })).json()
  expect(whoami).toMatchObject({ deviceLabel, harness: 'CLAUDE_CODE', status: 'ACTIVE' })
  const sent = report()
  const created = await request.post('/api/platform/programme-usage-reports', { data: sent, headers: auth })
  expect(created.status()).toBe(201)
  const extended = await request.post('/api/platform/programme-usage-reports', { data: { ...sent, outputTokens: 1500, requestCount: 20, endedAt: '2026-09-14T02:00:00.000Z' }, headers: auth })
  expect(await extended.json()).toMatchObject({ extended: true })

  await operator.goto('/control/roadmap')
  await expect(operator.getByTestId('phase-people-PHASE-ZAI-01')).toContainText(whoami.personDisplayName)

  // Revoke: the next report is refused.
  await operator.goto('/control/roadmap?view=devices')
  await operator.getByTestId(`harness-device-${paired.pairing.installationId}`).getByRole('button', { name: 'เพิกถอน' }).click()
  await expect(operator.getByTestId(`harness-device-${paired.pairing.installationId}`)).toContainText('REVOKED')
  expect((await request.post('/api/platform/programme-usage-reports', { data: report(), headers: auth })).status()).toBe(401)
  await operatorContext.close()
})

test('a bare signup cannot approve a pairing', async ({ page, request }) => {
  const start = await (await request.post('/api/platform/harness-pairing/start', { data: { harness: 'CODEX', deviceLabel: 'E2E-SIGNUP' } })).json()
  const signup = await page.request.post('/api/auth/signup', { data: { email: `fr220-signup-${randomUUID()}@example.test`, displayName: 'Waiting', password: E2E_PASSWORD } })
  expect(signup.status()).toBe(201)
  await page.goto(start.approvalUrl)
  await expect(page.getByTestId('harness-pair-check-code')).toHaveText(start.checkCode)
  await expect(page.getByRole('button', { name: 'ยืนยันจับคู่เครื่องนี้' })).toBeDisabled()
})
