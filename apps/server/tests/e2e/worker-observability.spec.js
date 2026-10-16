const { test, expect } = require('@playwright/test')
const { PrismaClient } = require('@prisma/client')
const { randomUUID } = require('node:crypto')
const { e2eTarget } = require('./e2e-target')
const { E2E_PASSWORD } = require('./e2e-auth')

const prisma = new PrismaClient({ datasources: { db: { url: e2eTarget().databaseUrl } } })
const grantIds = []

test.afterAll(async () => {
  await prisma.platformGrant.updateMany({ where: { id: { in: grantIds } }, data: { status: 'REVOKED', revokedAt: new Date() } })
  await prisma.$disconnect()
})

test('operator opens the Workers view, reads protected local status, and can use tabs by keyboard', async ({ page }) => {
  const signup = await page.request.post('/api/auth/signup', { data: {
    email: `worker-view-${randomUUID()}@example.test`, displayName: 'Worker view operator', password: E2E_PASSWORD,
  } })
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
  for (const forbidden of ['Worker view operator', user.email, 'private-owner-id', 'memory receipt content', 'C:\\Users\\']) {
    expect(projected).not.toContain(forbidden)
  }

  await workersTab.focus()
  await page.keyboard.press('ArrowLeft')
  await expect(page.getByRole('tab', { name: 'Domain map & inventory' })).toHaveAttribute('aria-selected', 'true')
  await page.keyboard.press('ArrowRight')
  await expect(workersTab).toHaveAttribute('aria-selected', 'true')
})

test('member roadmap stays redacted and cannot read worker telemetry', async ({ page }) => {
  const signup = await page.request.post('/api/auth/signup', { data: {
    email: `worker-view-member-${randomUUID()}@example.test`, displayName: 'Worker view member', password: E2E_PASSWORD,
  } })
  expect(signup.status()).toBe(201)
  await page.goto('/roadmap')
  await expect(page.getByRole('tab', { name: 'Workers & activity' })).toHaveCount(0)
  const response = await page.request.get('/api/platform/worker-observability')
  expect(response.status()).toBe(403)
  expect(response.headers()['cache-control']).toBe('private, no-store')
})

test('Workers view stays within 390x844 and 430x932 viewports', async ({ page }) => {
  const signup = await page.request.post('/api/auth/signup', { data: {
    email: `worker-view-mobile-${randomUUID()}@example.test`, displayName: 'Worker view mobile', password: E2E_PASSWORD,
  } })
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
