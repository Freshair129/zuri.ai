const { test, expect } = require('@playwright/test')
const { PrismaClient } = require('@prisma/client')
const { randomUUID } = require('node:crypto')
const { e2eTarget } = require('./e2e-target')
const { loginAsOwner } = require('./e2e-auth')

// @req FR-193 — adding Employment keeps the member in the separate access list.
// @spec ADR-078 D1, BR-034
// @tested tests/e2e/fr193-access-members.spec.js
const prisma = new PrismaClient({ datasources: { db: { url: e2eTarget().databaseUrl } } })
let business, member, membership

test.beforeAll(async () => {
  const suffix = randomUUID().slice(0, 8)
  const tenant = await prisma.tenant.findUnique({ where: { code: 'TNT-001' } })
  const owner = await prisma.person.findUnique({ where: { code: 'PER-OWNER' } })
  business = await prisma.business.create({ data: { code: `E2E-HR-${suffix}`, name: `HR Members ${suffix}`, tenantId: tenant.id } })
  member = await prisma.person.create({ data: { code: `E2E-HR-P-${suffix}`, displayName: `HR Member ${suffix}` } })
  await prisma.membership.create({ data: { personId: owner.id, tenantId: tenant.id, businessId: business.id, scopeType: 'BUSINESS', role: 'OWNER', status: 'ACTIVE' } })
  membership = await prisma.membership.create({ data: { personId: member.id, tenantId: tenant.id, businessId: business.id, scopeType: 'BUSINESS', role: 'MEMBER', status: 'ACTIVE' } })
})
test.afterAll(async () => { await prisma.$disconnect() })

test('member remains listed after an Employment is created and the page is reloaded', async ({ page }) => {
  await loginAsOwner(page)
  await page.getByRole('button', { name: `Open Business ${business.name}`, exact: true }).click()
  await expect(page).toHaveURL(/\/overview$/)
  await page.goto('/people')
  const memberRow = page.getByRole('listitem').filter({ hasText: member.displayName })
  await expect(memberRow).toContainText('No open Employment')
  await page.getByRole('button', { name: `Add Employment for ${member.displayName}`, exact: true }).click()
  const dialog = page.getByRole('dialog')
  await expect(dialog).toBeVisible()
  await dialog.getByPlaceholder('เช่น ผู้จัดการร้าน').fill('HR browser fixture')
  const response = page.waitForResponse((res) => res.request().method() === 'POST' && new URL(res.url()).pathname === '/api/people/employment')
  await dialog.getByRole('button', { name: 'Create record', exact: true }).click()
  expect((await response).ok()).toBe(true)
  await expect(dialog).not.toBeVisible()
  await expect(memberRow).toContainText('Employment: ACTIVE')
  await expect(memberRow.getByRole('button')).toHaveCount(0)
  const employmentRow = page.getByRole('row').filter({ hasText: member.displayName })
  await expect(employmentRow).toContainText('HR browser fixture')
  await page.reload()
  await expect(memberRow).toContainText('Employment: ACTIVE')
  await expect(employmentRow).toContainText('HR browser fixture')
  expect(await prisma.membership.findUnique({ where: { id: membership.id } })).toEqual(membership)
})
