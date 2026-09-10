// @req FR-080 — Platform Integrations keeps model metadata and secret references
//   inside the selected Business scope, including delayed browser responses.
// @spec ADR-032 D1-D4, SDD-044
// @tested tests/e2e/fr080-integration-scope-switch.spec.js
const { test, expect } = require('@playwright/test')
const { loginAsOwner, readScope } = require('./e2e-auth')

async function grantBusinessTwoMembership() {
  const { PrismaClient } = require('@prisma/client')
  const { e2eTarget } = require('./e2e-target')
  const db = new PrismaClient({ datasources: { db: { url: e2eTarget().databaseUrl } } })
  const second = await db.business.findUniqueOrThrow({ where: { code: 'BUS-002' } })
  const person = await db.person.findUniqueOrThrow({ where: { code: 'PER-OWNER' } })
  const existing = await db.membership.findFirst({
    where: { personId: person.id, tenantId: second.tenantId, businessId: second.id },
  })
  const grant = existing || await db.membership.create({
    data: { personId: person.id, tenantId: second.tenantId, businessId: second.id, role: 'OWNER' },
  })
  return {
    second,
    async cleanup() {
      try {
        if (!existing) await db.membership.delete({ where: { id: grant.id } })
      } finally {
        await db.$disconnect()
      }
    },
  }
}

function businessesFrom(scope, secondId) {
  const businessA = scope.businesses.find((business) => business.code === 'BUS-001')
  const businessB = scope.businesses.find((business) => business.id === secondId || business.code === 'BUS-002')
  expect(businessA).toBeTruthy()
  expect(businessB).toBeTruthy()
  return { businessA, businessB }
}

async function flushBrowser(page) {
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))))
}

test.describe('FR-080 Platform Integrations Business scope', () => {
  test('does not publish a delayed A save into the B form', async ({ page }) => {
    const membership = await grantBusinessTwoMembership()
    try {
      await loginAsOwner(page)
      await expect(page.getByRole('button', { name: /Open Business Business 01/ })).toBeVisible()
      const scope = await readScope(page.request)
      const { businessA, businessB } = businessesFrom(scope, membership.second.id)

      await page.getByRole('button', { name: new RegExp(`Open Business ${businessA.name}`) }).click()
      await expect(page).toHaveURL(/overview/)
      await page.goto('/platform/integrations')
      const businessSelect = page.getByLabel('Business', { exact: true })
      await expect(businessSelect).toHaveValue(businessA.id)
      await page.getByRole('button', { name: 'Settings', exact: true }).first().click()
      await expect(page.getByRole('heading', { name: 'AI Model & Provider Settings' })).toBeVisible()

      await page.getByLabel('ชื่อ connection', { exact: true }).fill('A pending connection')
      await page.getByLabel('Model', { exact: true }).fill('a-model')
      await page.getByLabel('Supabase Vault reference', { exact: true }).fill('supabase-vault:123e4567-e89b-12d3-a456-426614174000')

      let releaseA
      let resolveSeen
      let resolveSettled
      const holdA = new Promise((resolve) => { releaseA = resolve })
      const aPostSeen = new Promise((resolve) => { resolveSeen = resolve })
      const aPostSettled = new Promise((resolve) => { resolveSettled = resolve })
      let postBody
      const aPostResponse = page.waitForResponse((response) => response.request().method() === 'POST' && new URL(response.url()).pathname === '/api/platform/integrations')

      await page.route('**/api/platform/integrations**', async (route) => {
        const request = route.request()
        const pathname = new URL(request.url()).pathname
        if (request.method() === 'POST' && pathname === '/api/platform/integrations') {
          postBody = request.postDataJSON()
          resolveSeen()
          await holdA
          await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ id: 'connection-a' }) })
          resolveSettled()
          return
        }
        await route.continue()
      })

      await page.getByRole('button', { name: 'บันทึก metadata', exact: false }).click()
      await aPostSeen
      expect(postBody.businessId).toBe(businessA.id)
      await expect(page.getByRole('button', { name: /กำลังบันทึก/ })).toBeVisible()

      await page.getByRole('button', { name: 'Back to Connectors', exact: true }).click()
      const catalogBusinessSelect = page.getByLabel('Business', { exact: true })
      await catalogBusinessSelect.selectOption(businessB.id)
      await expect(catalogBusinessSelect).toHaveValue(businessB.id)
      await page.getByRole('button', { name: 'Settings', exact: true }).first().click()
      await expect(page.getByRole('heading', { name: 'AI Model & Provider Settings' })).toBeVisible()
      await expect(page.getByText(`Business ปัจจุบัน: ${businessB.name}`, { exact: true })).toBeVisible()
      await expect(page.getByLabel('ชื่อ connection', { exact: true })).toHaveValue('Phase 1 LLM')
      await expect(page.getByLabel('Model', { exact: true })).toHaveValue('')
      await expect(page.getByLabel('Supabase Vault reference', { exact: true })).toHaveValue('')
      await page.getByLabel('ชื่อ connection', { exact: true }).fill('B pending connection')
      await page.getByLabel('Model', { exact: true }).fill('b-model')
      await page.getByLabel('Supabase Vault reference', { exact: true }).fill('supabase-vault:123e4567-e89b-12d3-a456-426614174001')

      releaseA()
      await aPostSettled
      await aPostResponse
      await flushBrowser(page)
      await expect(page.getByLabel('ชื่อ connection', { exact: true })).toHaveValue('B pending connection')
      await expect(page.getByLabel('Model', { exact: true })).toHaveValue('b-model')
      await expect(page.getByLabel('Supabase Vault reference', { exact: true })).toHaveValue('supabase-vault:123e4567-e89b-12d3-a456-426614174001')
      await expect(page.getByText('บันทึก connection metadata แล้ว', { exact: true })).toHaveCount(0)
      await expect(page.getByLabel('Business', { exact: true })).toHaveCount(0)
      await page.unroute('**/api/platform/integrations**')
    } finally {
      await membership.cleanup()
    }
  })

  test('drops a delayed A read after the B read becomes current', async ({ page }) => {
    const membership = await grantBusinessTwoMembership()
    try {
      await loginAsOwner(page)
      await expect(page.getByRole('button', { name: /Open Business Business 01/ })).toBeVisible()
      const scope = await readScope(page.request)
      const { businessA, businessB } = businessesFrom(scope, membership.second.id)

      await page.getByRole('button', { name: new RegExp(`Open Business ${businessA.name}`) }).click()
      await expect(page).toHaveURL(/overview/)

    let releaseA
    let resolveASeen
    let resolveBSeen
    let resolveASettled
    const holdA = new Promise((resolve) => { releaseA = resolve })
    const aReadSeen = new Promise((resolve) => { resolveASeen = resolve })
    const bReadSeen = new Promise((resolve) => { resolveBSeen = resolve })
    const aReadSettled = new Promise((resolve) => { resolveASettled = resolve })
    const aReadResponse = page.waitForResponse((response) => {
      const url = new URL(response.url())
      return response.request().method() === 'GET' && url.pathname === '/api/platform/integrations' && url.searchParams.get('businessId') === businessA.id
    })
    const delayedA = [{
      id: 'connection-a',
      kind: 'MODEL_PROVIDER',
      provider: 'openrouter',
      providerName: 'OpenRouter',
      name: 'A only',
      model: 'a-model',
      status: 'DRAFT',
      secretConfigured: false,
      secretRefMasked: null,
      credentialVersion: null,
      expiresAt: null,
      health: { state: 'DEGRADED', reasons: [], evidence: {} },
    }]

    await page.route('**/api/platform/integrations**', async (route) => {
      const request = route.request()
      const url = new URL(request.url())
      if (request.method() !== 'GET' || url.pathname !== '/api/platform/integrations') {
        await route.continue()
        return
      }
      if (url.searchParams.get('businessId') === businessA.id) {
        resolveASeen()
        await holdA
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(delayedA) })
        resolveASettled()
        return
      }
      if (url.searchParams.get('businessId') === businessB.id) {
        await route.fulfill({ status: 200, contentType: 'application/json', body: '[]' })
        resolveBSeen()
        return
      }
      await route.continue()
    })

    await page.goto('/platform/integrations')
    const businessSelect = page.getByLabel('Business', { exact: true })
    await expect(businessSelect).toHaveValue(businessA.id)
    await aReadSeen

    await businessSelect.selectOption(businessB.id)
    await expect(businessSelect).toHaveValue(businessB.id)
    await bReadSeen
    await page.getByRole('button', { name: 'Settings', exact: true }).first().click()
    await expect(page.getByRole('heading', { name: 'AI Model & Provider Settings' })).toBeVisible()
    await expect(page.getByText('ยังไม่มี connection ในขอบเขตนี้', { exact: true })).toBeVisible()

    releaseA()
    await aReadSettled
    await aReadResponse
    await flushBrowser(page)
    await expect(page.getByText('A only', { exact: true })).toHaveCount(0)
    await expect(page.getByText('ยังไม่มี connection ในขอบเขตนี้', { exact: true })).toBeVisible()
      await page.unroute('**/api/platform/integrations**')
    } finally {
      await membership.cleanup()
    }
  })
})
