const { test, expect } = require('@playwright/test')
const { PrismaClient } = require('@prisma/client')
const { randomUUID } = require('node:crypto')
const { e2eTarget } = require('./e2e-target')
const { E2E_PASSWORD } = require('./e2e-auth')

// @req FR-211 — an installation operator opens the Domain map & inventory tab on
// /control/roadmap, selects a domain and reads its features, FRs and NFRs; the
// tab is reachable by URL and the programme plan stays the default view.
// @spec ADR-048 D2-D3, SEC-020, FR-105
// @tested tests/e2e/fr211-control-domain-map.spec.js
const prisma = new PrismaClient({ datasources: { db: { url: e2eTarget().databaseUrl } } })
const grantIds = []

test.afterAll(async () => {
  await prisma.platformGrant.updateMany({ where: { id: { in: grantIds } }, data: { status: 'REVOKED', revokedAt: new Date() } })
  await prisma.$disconnect()
})

test('an operator switches to the domain map and opens one domain’s inventory', async ({ page }, testInfo) => {
  // A dedicated signed-up actor, so the shared seeded owner never gains OPERATOR.
  const signup = await page.request.post('/api/auth/signup', { data: {
    email: `fr211-${randomUUID()}@example.test`, displayName: 'FR-211 operator', password: E2E_PASSWORD,
  } })
  expect(signup.status()).toBe(201)
  const { user } = await signup.json()

  // Without the grant the control surface does not exist for this person.
  await page.goto('/control/roadmap?view=domains')
  await expect(page.getByTestId('domain-map-view')).toHaveCount(0)
  await expect(page.getByRole('tab', { name: 'Domain map & inventory' })).toHaveCount(0)

  const grant = await prisma.platformGrant.create({ data: { personId: user.id, capability: 'OPERATOR', status: 'ACTIVE', expiresAt: new Date(Date.now() + 3600000) } })
  grantIds.push(grant.id)

  await page.goto('/control/roadmap')
  await expect(page.getByRole('heading', { name: 'Phases, sprints and tasks' })).toBeVisible()
  await page.getByRole('tab', { name: 'Domain map & inventory' }).click()
  await expect(page).toHaveURL(/\/control\/roadmap\?view=domains$/)
  await expect(page.getByRole('heading', { name: 'Phases, sprints and tasks' })).toHaveCount(0)

  const tiles = page.getByRole('list', { name: 'Domains' })
  // Which lanes exist is generated; pin a floor, not today's count.
  await expect(tiles.getByTestId('domain-tile-inventory')).toBeVisible()
  expect(await tiles.getByRole('button').count()).toBeGreaterThan(10)
  await tiles.getByTestId('domain-tile-inventory').click()
  await expect(tiles.getByTestId('domain-tile-inventory')).toHaveAttribute('aria-pressed', 'true')

  const inventory = page.getByTestId('domain-inventory-inventory')
  await expect(inventory.getByRole('heading', { name: 'Inventory', exact: true })).toBeVisible()
  await expect(inventory.getByRole('table', { name: 'Inventory functional requirements' })).toContainText('FR-154')
  // Inventory's code names no NFR today, so the section states that rather than drawing an empty table.
  await expect(inventory.getByRole('heading', { name: 'Non-functional requirements' })).toBeVisible()

  const feature = inventory.getByRole('button', { name: /FEAT-020/ })
  await feature.click()
  await expect(feature).toHaveAttribute('aria-expanded', 'true')
  await expect(inventory.locator('#feature-detail-FEAT-020')).toContainText('Use case')

  await page.getByLabel('Search features and requirements').fill('FR-203')
  await expect(inventory.getByRole('table', { name: 'Inventory functional requirements' }).getByRole('row')).toHaveCount(2)

  await page.getByLabel('Search features and requirements').fill('')
  await testInfo.attach('domain-map', { body: await page.screenshot({ fullPage: true }), contentType: 'image/png' })

  // A reload keeps the view the URL names.
  await page.reload()
  await expect(page.getByTestId('domain-map-view')).toBeVisible()
})
