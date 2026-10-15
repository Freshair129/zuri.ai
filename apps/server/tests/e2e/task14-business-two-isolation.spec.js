const { test, expect } = require('@playwright/test')
const { PrismaClient } = require('@prisma/client')
const { e2eTarget } = require('./e2e-target')
const { loginAsOwner } = require('./e2e-auth')

// @req TASK-ZAI-014 — a disposable Tenant OWNER creates a second Business in
// the same Tenant, then switches through the real pre-shell Business router.
// Persisted FR-285 configuration is checked as data; this does not exercise or
// claim live agent/provider activation.
// @spec FR-046, FR-074, FR-091, FR-285, FR-286; BR-001; SEC-001, SEC-008
// @tested tests/e2e/task14-business-two-isolation.spec.js

const target = e2eTarget()
const prisma = new PrismaClient({ datasources: { db: { url: target.databaseUrl } } })
let fixture

function suffix() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`
}

async function createConversation({ businessId, displayName, label }) {
  const key = suffix()
  const person = await prisma.person.create({ data: { code: `PER-T14-${key}`, displayName } })
  const customer = await prisma.customer.create({
    data: {
      code: `CUS-T14-${key}`,
      tenantId: fixture.tenant.id,
      businessId,
      personId: person.id,
      displayName,
    },
  })
  const conversation = await prisma.conversation.create({
    data: {
      tenantId: fixture.tenant.id,
      businessId,
      customerId: customer.id,
      channel: 'LINE',
      channelAccountId: `TASK14:${key}`,
      externalThreadId: `TASK14-${label}-${key}`,
    },
  })
  await prisma.message.create({
    data: { conversationId: conversation.id, direction: 'INBOUND', body: `${label} marker` },
  })
  return conversation
}

async function prepareFixture() {
  const owner = await prisma.person.findUnique({ where: { code: 'PER-OWNER' } })
  if (!owner) throw new Error('Task14 E2E seed owner is unavailable')
  const portfolio = await prisma.portfolio.findFirst({ orderBy: { code: 'asc' } })
  if (!portfolio) throw new Error('Task14 E2E seed Portfolio is unavailable')

  const key = suffix()
  const tenant = await prisma.tenant.create({
    data: { code: `T14-${key}`, name: `Task14 disposable Tenant ${key}`, portfolioId: portfolio.id },
  })
  const businessOne = await prisma.business.create({
    data: { code: `T14A-${key}`, name: `Task14 Business One ${key}`, tenantId: tenant.id },
  })
  // This Membership exists only in Playwright's isolated database. It is the
  // same persisted authority the resolver reads; the test does not grant access
  // to the local UAT account or any external Tenant.
  await prisma.membership.create({
    data: {
      personId: owner.id,
      tenantId: tenant.id,
      businessId: null,
      scopeType: 'TENANT',
      role: 'OWNER',
      status: 'ACTIVE',
      domainKeysJson: JSON.stringify([]),
    },
  })
  const membershipsBeforeCreate = await prisma.membership.count({ where: { tenantId: tenant.id } })
  fixture = {
    tenant,
    businessOne,
    businessTwoName: `Task14 Business Two ${key}`,
    membershipsBeforeCreate,
    sharedCustomerName: `Task14 shared CRM ${key}`,
    businessOneCustomerName: `Task14 Business One CRM ${key}`,
  }
  fixture.sharedConversation = await createConversation({
    businessId: null,
    displayName: fixture.sharedCustomerName,
    label: `shared-${key}`,
  })
  fixture.businessOneConversation = await createConversation({
    businessId: businessOne.id,
    displayName: fixture.businessOneCustomerName,
    label: `business-one-${key}`,
  })
}

test.beforeAll(async () => { await prepareFixture() })
test.afterAll(async () => { await prisma.$disconnect() })

test('Tenant OWNER creates and switches to Business two while shared CRM stays shared', async ({ page }) => {
  await loginAsOwner(page)
  const entryResponse = await page.request.get('/api/entry')
  expect(entryResponse.ok()).toBe(true)
  const entry = await entryResponse.json()
  const firstEntry = entry.businesses.find((business) => business.id === fixture.businessOne.id)
  expect(firstEntry).toMatchObject({ canCreateBusiness: true, tenant: { id: fixture.tenant.id } })
  expect(entry).not.toHaveProperty('ownedTenantIds')

  await expect(page.getByRole('heading', { name: 'Choose a Business' })).toBeVisible()
  await page.locator('#same-tenant-business-tenant').selectOption(fixture.tenant.id)
  await page.locator('#same-tenant-business-name').fill(fixture.businessTwoName)
  const createResponsePromise = page.waitForResponse((response) =>
    response.request().method() === 'POST' && response.url().endsWith('/api/scope'))
  await page.getByRole('button', { name: 'Create Business in this Tenant', exact: true }).click()
  const createResponse = await createResponsePromise
  expect(createResponse.ok()).toBe(true)
  expect(createResponse.request().postDataJSON()).toMatchObject({
    entity: 'business',
    data: { tenantId: fixture.tenant.id, name: fixture.businessTwoName },
  })
  const businessTwo = await createResponse.json()
  fixture.businessTwo = businessTwo
  await expect(page).toHaveURL(/\/overview$/)
  await expect.poll(() => page.evaluate(() => {
    const saved = JSON.parse(localStorage.getItem('zuri-v2-scope') || '{}')
    return saved.businessId
  })).toBe(businessTwo.id)

  const spaces = await prisma.workspace.findMany({ where: { businessId: businessTwo.id } })
  expect(spaces).toHaveLength(1)
  expect(spaces[0]).toMatchObject({
    scopeType: 'BUSINESS',
    tenantId: fixture.tenant.id,
    businessId: businessTwo.id,
  })
  expect(spaces[0].provisioningKey).toBeTruthy()
  expect(businessTwo.provisioningTemplateId).toBeTruthy()
  expect(await prisma.businessAgentConfig.findUnique({ where: { businessId: businessTwo.id } }))
    .toMatchObject({ tenantId: fixture.tenant.id, businessId: businessTwo.id, delegationPolicy: 'DENY' })
  expect(await prisma.membership.count({ where: { tenantId: fixture.tenant.id } }))
    .toBe(fixture.membershipsBeforeCreate)

  await page.goto('/businesses')
  await page.getByRole('button', { name: `Open Business ${fixture.businessOne.name}`, exact: true }).click()
  await expect(page).toHaveURL(/\/overview$/)
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('zuri-v2-scope') || '{}').businessId))
    .toBe(fixture.businessOne.id)
  await page.goto('/customer/conversations')
  await expect(page.getByRole('heading', { name: 'Inbox', exact: true })).toBeVisible()
  const businessOneInbox = await page.request.get(`/api/crm/conversations?businessId=${encodeURIComponent(fixture.businessOne.id)}`)
  expect(businessOneInbox.ok()).toBe(true)
  const businessOneRows = (await businessOneInbox.json()).conversations
  expect(businessOneRows.map((row) => row.id)).toContain(fixture.sharedConversation.id)
  expect(businessOneRows.map((row) => row.id)).toContain(fixture.businessOneConversation.id)
  const businessOneList = page.getByRole('list', { name: 'ห้องสนทนา' })
  await expect(businessOneList.getByText(fixture.sharedCustomerName, { exact: true })).toBeVisible()
  await expect(businessOneList.getByText(fixture.businessOneCustomerName, { exact: true })).toBeVisible()

  await page.goto('/businesses')
  await page.getByRole('button', { name: `Open Business ${businessTwo.name}`, exact: true }).click()
  await expect(page).toHaveURL(/\/overview$/)
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('zuri-v2-scope') || '{}').businessId))
    .toBe(businessTwo.id)
  await page.goto('/customer/conversations')
  await expect(page.getByRole('heading', { name: 'Inbox', exact: true })).toBeVisible()
  const businessTwoInbox = await page.request.get(`/api/crm/conversations?businessId=${encodeURIComponent(businessTwo.id)}`)
  expect(businessTwoInbox.ok()).toBe(true)
  const businessTwoRows = (await businessTwoInbox.json()).conversations
  expect(businessTwoRows.map((row) => row.id)).toContain(fixture.sharedConversation.id)
  expect(businessTwoRows.map((row) => row.id)).not.toContain(fixture.businessOneConversation.id)
  const businessTwoList = page.getByRole('list', { name: 'ห้องสนทนา' })
  await expect(businessTwoList.getByText(fixture.sharedCustomerName, { exact: true })).toBeVisible()
  await expect(businessTwoList.getByText(fixture.businessOneCustomerName, { exact: true })).toHaveCount(0)
})
