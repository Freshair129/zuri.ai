const { test, expect } = require('@playwright/test')
const { PrismaClient } = require('@prisma/client')
const { randomUUID } = require('node:crypto')
const { e2eTarget } = require('./e2e-target')
const { E2E_PASSWORD } = require('./e2e-auth')

const prisma = new PrismaClient({ datasources: { db: { url: e2eTarget().databaseUrl } } })
const grantIds = []

async function signupFromIsolatedRateLimitSource(page, sourceAddress, data) {
  return page.request.post('/api/auth/signup', {
    headers: { 'x-forwarded-for': sourceAddress },
    data,
  })
}

test.afterAll(async () => {
  await prisma.platformGrant.updateMany({ where: { id: { in: grantIds } }, data: { status: 'REVOKED', revokedAt: new Date() } })
  await prisma.$disconnect()
})

test('operator opens the Workers view, reads protected local status, and can use tabs by keyboard', async ({ page }) => {
  const signupEmail = `worker-view-${randomUUID()}@example.test`
  const signup = await signupFromIsolatedRateLimitSource(page, '198.51.100.41', {
    email: signupEmail, displayName: 'Worker view operator', password: E2E_PASSWORD,
  })
  expect(signup.status()).toBe(201)
  const { user } = await signup.json()
  const grant = await prisma.platformGrant.create({ data: { personId: user.id, capability: 'OPERATOR', status: 'ACTIVE', expiresAt: new Date(Date.now() + 3600000) } })
  grantIds.push(grant.id)

  await page.goto('/control/roadmap?view=workers')
  const workersTab = page.getByRole('tab', { name: 'Workers & activity' })
  await expect(workersTab).toBeVisible()
  await expect(workersTab).toHaveAttribute('aria-selected', 'true')
  await expect(page.getByTestId('worker-observability-panel')).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Assignments' })).toBeVisible()
  await expect(page.getByText(/NOT_CAPTURED/).first()).toBeVisible()

  const response = await page.request.get('/api/platform/worker-observability')
  expect(response.status()).toBe(200)
  expect(response.headers()['cache-control']).toBe('private, no-store')
  const snapshot = await response.json()
  expect(snapshot.schemaVersion).toBe('worker-observability/v1')
  expect(['LIVE', 'UNKNOWN']).toContain(snapshot.state)
  expect(snapshot.source.proofScope).toBe('LOCAL_ONLY')
  const projected = JSON.stringify(snapshot)
  for (const forbidden of ['Worker view operator', signupEmail, 'private-owner-id', 'memory receipt content', 'C:\\Users\\']) {
    expect(projected).not.toContain(forbidden)
  }

  await workersTab.focus()
  await page.keyboard.press('ArrowLeft')
  await expect(page.getByRole('tab', { name: 'Domain map & inventory' })).toHaveAttribute('aria-selected', 'true')
  await page.keyboard.press('ArrowRight')
  await expect(workersTab).toHaveAttribute('aria-selected', 'true')
})

test('keyboard can scroll the assignment table to its rightmost column', async ({ page }) => {
  const signup = await signupFromIsolatedRateLimitSource(page, '198.51.100.42', {
    email: `worker-scroll-${randomUUID()}@example.test`, displayName: 'Worker table operator', password: E2E_PASSWORD,
  })
  expect(signup.status()).toBe(201)
  const { user } = await signup.json()
  const grant = await prisma.platformGrant.create({ data: { personId: user.id, capability: 'OPERATOR', status: 'ACTIVE', expiresAt: new Date(Date.now() + 3600000) } })
  grantIds.push(grant.id)

  await page.setViewportSize({ width: 390, height: 844 })
  await page.route('**/api/platform/worker-observability**', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({
      schemaVersion: 'worker-observability/v1', state: 'LIVE', freshness: 'SNAPSHOT',
      observedAt: '2026-10-16T04:00:00.000Z',
      source: { kind: 'LOCAL_DELIVERY_CONTROLLER', proofScope: 'LOCAL_ONLY', controllerLiveness: 'VERIFIED', eventChain: 'VERIFIED', supervisorReceipts: 'NOT_CAPTURED', ciReceipts: 'NOT_CAPTURED' },
      summary: { activeWorkers: 1, queuedWorkers: 0, activeTasks: 1, mode: 'SOLO' },
      tasks: [], events: [], localTags: [], localTagCount: 0, localTagsTruncated: false,
      localTagSetFingerprint: 'a'.repeat(64),
      localStatus: { changedFiles: 0, fingerprint: 'b'.repeat(64), headCommit: 'c'.repeat(40), observedAt: '2026-10-16T04:00:00.000Z' },
      assignments: [{ assignmentRef: 'worker-001', taskId: 'TASK-ZAI-001', cycleNo: 1,
        role: 'worker', stage: 'WORKER_IMPLEMENTATION', state: 'RUNNING', attempt: 1,
        lease: { state: 'FRESH', ageMs: 10 }, active: true, queued: false,
        checkedHeadCommit: 'c'.repeat(40), contextMemory: { state: 'NOT_CAPTURED' } }],
    }),
  }))
  await page.goto('/control/roadmap?view=workers')
  const region = page.getByRole('region', { name: /worker assignments table/i })
  await expect(region).toBeVisible()
  await expect(region).toHaveAttribute('tabindex', '0')
  await region.focus()
  await expect(region).toBeFocused()
  await expect(region).toHaveCSS('outline-style', 'solid')
  await region.press('End')
  const contextHeaderIsVisible = await region.evaluate((container) => {
    const header = container.querySelector('th:last-child')
    const containerRect = container.getBoundingClientRect()
    const headerRect = header.getBoundingClientRect()
    return headerRect.left >= containerRect.left && headerRect.right <= containerRect.right
  })
  expect(contextHeaderIsVisible).toBe(true)
})

test('closed member roadmap stays unavailable and cannot read worker telemetry', async ({ page }) => {
  const signup = await signupFromIsolatedRateLimitSource(page, '198.51.100.43', {
    email: `worker-view-member-${randomUUID()}@example.test`, displayName: 'Worker view member', password: E2E_PASSWORD,
  })
  expect(signup.status()).toBe(201)
  const roadmap = await page.goto('/roadmap')
  expect(roadmap?.status()).toBe(404)
  await expect(page.getByRole('tab', { name: 'Workers & activity' })).toHaveCount(0)
  const response = await page.request.get('/api/platform/worker-observability')
  expect(response.status()).toBe(403)
  expect(response.headers()['cache-control']).toBe('private, no-store')
})

test('Workers view stays within 390x844 and 430x932 viewports', async ({ page }) => {
  const signup = await signupFromIsolatedRateLimitSource(page, '198.51.100.44', {
    email: `worker-view-mobile-${randomUUID()}@example.test`, displayName: 'Worker view mobile', password: E2E_PASSWORD,
  })
  expect(signup.status()).toBe(201)
  const { user } = await signup.json()
  const grant = await prisma.platformGrant.create({ data: { personId: user.id, capability: 'OPERATOR', status: 'ACTIVE', expiresAt: new Date(Date.now() + 3600000) } })
  grantIds.push(grant.id)

  for (const viewport of [{ width: 390, height: 844 }, { width: 430, height: 932 }]) {
    await page.setViewportSize(viewport)
    await page.goto('/control/roadmap?view=workers')
    await expect(page.getByTestId('worker-observability-panel')).toBeVisible()
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
    expect(overflow).toBeLessThanOrEqual(1)
  }
})
