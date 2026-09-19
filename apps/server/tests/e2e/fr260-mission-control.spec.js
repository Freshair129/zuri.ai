const { test, expect } = require('@playwright/test')
const { PrismaClient } = require('@prisma/client')
const { randomUUID } = require('node:crypto')
const { e2eTarget } = require('./e2e-target')
const { E2E_PASSWORD } = require('./e2e-auth')

// @req FR-260 — an installation operator reads the Mission Control projection.
// @req FR-261 — absent PORL data is visibly UNKNOWN/NOT RUN.
// @req FR-262 — blocker and merge-gate traces are read-only.
// @req FR-264 — the board remains usable at 390x844 and 430x932 without
// document-level horizontal overflow.
// @spec ADR-048 D1-D3, ADR-086 D1/D7, ADR-092 D3
// @tested tests/e2e/fr260-mission-control.spec.js

const prisma = new PrismaClient({ datasources: { db: { url: e2eTarget().databaseUrl } } })
const grantIds = []

test.afterAll(async () => {
  await prisma.platformGrant.updateMany({ where: { id: { in: grantIds } }, data: { status: 'REVOKED', revokedAt: new Date() } })
  await prisma.$disconnect()
})

test('operator reads fail-closed Mission Control at supported mobile widths', async ({ page }, testInfo) => {
  const signup = await page.request.post('/api/auth/signup', { data: {
    email: 'fr260-' + randomUUID() + '@example.test', displayName: 'FR-260 operator', password: E2E_PASSWORD,
  } })
  expect(signup.status()).toBe(201)
  const { user } = await signup.json()

  const forbidden = await page.goto('/control/mission-control')
  expect(forbidden?.status()).toBe(404)

  const grant = await prisma.platformGrant.create({
    data: { personId: user.id, capability: 'OPERATOR', status: 'ACTIVE', expiresAt: new Date(Date.now() + 3600000) },
  })
  grantIds.push(grant.id)

  for (const [width, height] of [[390, 844], [430, 932]]) {
    await page.setViewportSize({ width, height })
    await page.goto('/control/mission-control')
    await expect(page.getByTestId('mission-control-view')).toBeVisible()
    await expect(page.getByRole('heading', { name: 'DAG orchestration observability' })).toBeVisible()
    await expect(page.getByTestId('mission-control-porl')).toContainText('UNKNOWN')
    await expect(page.getByTestId('mission-control-porl')).toContainText('NOT RUN')
    await expect(page.getByTestId('mission-control-blockers')).toContainText('TASK-ZAI-081')
    await expect(page.getByTestId('mission-control-blockers')).toContainText('TASK-ZAI-100')
    await expect(page.getByTestId('mission-control-gates')).toContainText('CANDIDATE PARALLEL')
    await expect(page.getByTestId('mission-control-view').getByRole('button')).toHaveCount(0)

    const overflow = await page.evaluate(() => ({
      documentWidth: document.documentElement.scrollWidth,
      viewportWidth: window.innerWidth,
    }))
    expect(overflow.documentWidth).toBeLessThanOrEqual(overflow.viewportWidth + 1)

    const summary = page.getByTestId('mission-control-waves').locator('summary').first()
    await summary.focus()
    await expect(summary).toBeFocused()

    if (width === 390) {
      await testInfo.attach('mission-control-390x844', { body: await page.screenshot({ fullPage: true }), contentType: 'image/png' })
    }
  }
})
