const { expect } = require('@playwright/test')
const { PrismaClient } = require('@prisma/client')
const { randomUUID } = require('node:crypto')
const { e2eTarget } = require('./e2e-target')
const { E2E_PASSWORD } = require('./e2e-auth')

// @req FR-196 — distinct authenticated actors in SoD success-path fixtures.
// @spec ADR-079, SEC-008
// @tested tests/e2e/fr164-procurement.spec.js, tests/e2e/fr165-receipt-workstation.spec.js, tests/e2e/fr166-commerce-orders.spec.js
async function signUpBusinessActor(request, businessId) {
  const email = `sod-${randomUUID()}@example.test`
  const signup = await request.post('/api/auth/signup', { data: {
    email, displayName: 'Independent business actor', password: E2E_PASSWORD,
  } })
  expect(signup.status()).toBe(201)
  const body = await signup.json()
  expect(body.session).toBe(true)
  const db = new PrismaClient({ datasources: { db: { url: e2eTarget().databaseUrl } } })
  try {
    const business = await db.business.findUniqueOrThrow({ where: { id: businessId } })
    const owner = await db.person.findUniqueOrThrow({ where: { code: 'PER-OWNER' } })
    expect(body.user.id).not.toBe(owner.id)
    await db.membership.create({ data: { personId: body.user.id, tenantId: business.tenantId, businessId, scopeType: 'BUSINESS', role: 'OWNER', status: 'ACTIVE' } })
  } finally { await db.$disconnect() }
  return { id: body.user.id, email }
}

async function switchBusinessActor(page, actor) {
  const login = await page.request.post('/api/auth/login', { data: { username: actor.email, password: E2E_PASSWORD } })
  expect(login.ok()).toBe(true)
  await page.reload()
}

module.exports = { signUpBusinessActor, switchBusinessActor }
