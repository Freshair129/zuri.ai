// @req FR-004, FR-009, FR-046 — the global Operations view stays inside the
// selected Business, uses PM progress read-only, and links back to its owner.
const { test, expect } = require('@playwright/test')
const { PrismaClient } = require('@prisma/client')
const { e2eTarget } = require('./e2e-target')
const { loginAsOwner } = require('./e2e-auth')

async function fixture() {
  const db = new PrismaClient({ datasources: { db: { url: e2eTarget().databaseUrl } } })
  const [businessOne, businessTwo, businessThree, owner, project, workstream, item] = await Promise.all([
    db.business.findUniqueOrThrow({ where: { code: 'BUS-001' } }),
    db.business.findUniqueOrThrow({ where: { code: 'BUS-002' } }),
    db.business.findUniqueOrThrow({ where: { code: 'BUS-003' } }),
    db.person.findUniqueOrThrow({ where: { code: 'PER-OWNER' } }),
    db.project.findUniqueOrThrow({ where: { code: 'PRJ-B01-TRANSFORM' } }),
    db.workstream.findUniqueOrThrow({ where: { code: 'WST-OPS' } }),
    db.workItem.findUniqueOrThrow({ where: { code: 'OPS-CHK-STOCK' } }),
  ])
  const existingMembership = await db.membership.findFirst({
    where: { personId: owner.id, businessId: businessTwo.id, status: 'ACTIVE' },
  })
  const membership = existingMembership || await db.membership.create({
    data: { personId: owner.id, tenantId: businessTwo.tenantId, businessId: businessTwo.id, role: 'OWNER', status: 'ACTIVE' },
  })
  const originalTargetAt = item.targetAt
  await db.workItem.update({ where: { id: item.id }, data: { targetAt: new Date('2026-11-15T00:00:00.000Z') } })

  return {
    db,
    businessOne,
    businessTwo,
    businessThree,
    project,
    workstream,
    async cleanup() {
      try {
        await db.workItem.update({ where: { id: item.id }, data: { targetAt: originalTargetAt } })
        if (!existingMembership) await db.membership.delete({ where: { id: membership.id } })
      } finally {
        await db.$disconnect()
      }
    },
  }
}

async function openBusiness(page, name) {
  await page.goto('/businesses')
  await page.getByRole('button', { name: new RegExp(`Open Business ${name}`) }).click()
  await expect(page).toHaveURL(/\/overview$/)
}

function isWorkstreamRead(request, businessId) {
  const url = new URL(request.url())
  return request.method() === 'GET'
    && url.pathname === '/api/workstreams'
    && url.searchParams.get('businessId') === businessId
}

test.describe('PM Business Operations read view', () => {
  test('scopes the read, calculates existing progress, shows recorded dates, and survives browser history', async ({ page }) => {
    const data = await fixture()
    const apiRequests = []

    try {
      await loginAsOwner(page)
      await openBusiness(page, data.businessOne.name)
      page.on('request', (request) => {
        const url = new URL(request.url())
        if (url.pathname.startsWith('/api/')) apiRequests.push({ method: request.method(), pathname: url.pathname })
      })

      const b1Read = page.waitForResponse((response) => isWorkstreamRead(response.request(), data.businessOne.id))
      await page.goto('/execution/operations')
      const b1Response = await b1Read
      expect(b1Response.ok()).toBe(true)
      const workstreams = await b1Response.json()
      expect(workstreams.length).toBeGreaterThan(0)
      expect(workstreams.every((row) => row.executionMode === 'OPERATIONS')).toBe(true)
      expect(workstreams.every((row) => row.project.businessId === data.businessOne.id)).toBe(true)
      await expect(page.getByRole('heading', { name: 'Operations', exact: true })).toBeVisible()

      const card = page.locator(`#workstream-${data.workstream.id}`)
      await expect(card).toBeVisible()
      await expect(card.getByText('Store Operations Q3')).toBeVisible()
      await expect(card.getByText('56.2%', { exact: true })).toBeVisible()
      await expect(card.getByRole('progressbar', { name: 'Store Operations Q3 progress' })).toHaveAttribute('aria-valuenow', '56')
      const targetLabel = await page.evaluate((value) => new Date(value).toLocaleDateString(), '2026-11-15T00:00:00.000Z')
      await expect(card).toContainText(`Earliest recorded target ${targetLabel}`)
      await expect(card.getByText('SLA checks met 98/124')).toBeVisible()
      await expect(card.getByText('Incidents 4')).toBeVisible()
      await expect(card.getByText('No linked evidence reference is exposed in the current PM record.')).toBeVisible()
      await expect(card.getByRole('button')).toHaveCount(0)
      await expect(card.locator('select')).toHaveCount(0)
      await expect(card.getByRole('link', { name: 'Open owning project' })).toHaveAttribute('href', `/projects/${data.project.id}`)
      await expect(card.getByRole('link', { name: 'Open project Workstream' })).toHaveAttribute('href', `/projects/${data.project.id}/execution/operations#workstream-${data.workstream.id}`)
      expect(apiRequests.some((request) => request.pathname.startsWith('/api/progress/workstream'))).toBe(false)
      expect(apiRequests.filter((request) => request.method !== 'GET')).toEqual([])

      await card.getByRole('link', { name: 'Open owning project' }).click()
      await expect(page).toHaveURL(new RegExp(`/projects/${data.project.id}$`))
      await page.goBack({ waitUntil: 'commit' })
      await expect(page).toHaveURL(/\/execution\/operations$/)
      await expect(page.locator(`#workstream-${data.workstream.id}`)).toBeVisible()
      await page.goForward({ waitUntil: 'commit' })
      await expect(page).toHaveURL(new RegExp(`/projects/${data.project.id}$`))

      const crossBusinessStatus = await page.evaluate(async (businessId) => {
        const response = await fetch(`/api/workstreams?businessId=${encodeURIComponent(businessId)}&executionMode=OPERATIONS`)
        return response.status
      }, data.businessThree.id)
      expect(crossBusinessStatus).toBe(404)
    } finally {
      await data.cleanup()
    }
  })

  test('shows selected Business loading, empty, and error states during repeated scope navigation', async ({ page }) => {
    const data = await fixture()
    try {
      await loginAsOwner(page)
      await openBusiness(page, data.businessOne.name)
      await openBusiness(page, data.businessTwo.name)
      const b2Read = page.waitForResponse((response) => isWorkstreamRead(response.request(), data.businessTwo.id))
      await page.goto('/execution/operations')
      const b2Response = await b2Read
      expect(b2Response.ok()).toBe(true)
      expect(await b2Response.json()).toEqual([])
      await expect(page.getByText('No Operations workstreams', { exact: true })).toBeVisible()
      await expect(page.getByText('Store Operations Q3', { exact: true })).toHaveCount(0)

      await openBusiness(page, data.businessOne.name)
      let releaseLoading
      let resolveLoadingRequest
      const loadingRequest = new Promise((resolve) => { resolveLoadingRequest = resolve })
      const hold = new Promise((resolve) => { releaseLoading = resolve })
      await page.route('**/api/workstreams?*', async (route) => {
        if (isWorkstreamRead(route.request(), data.businessOne.id)) {
          resolveLoadingRequest()
          await hold
          await route.fulfill({ status: 200, contentType: 'application/json', body: '[]' })
          return
        }
        await route.continue()
      })
      await page.goto('/execution/operations')
      await loadingRequest
      await expect(page.getByRole('status').filter({ hasText: 'Loading' })).toBeVisible()
      releaseLoading()
      await expect(page.getByText('No Operations workstreams', { exact: true })).toBeVisible()
      await page.unroute('**/api/workstreams?*')

      await page.route('**/api/workstreams?*', async (route) => {
        if (isWorkstreamRead(route.request(), data.businessOne.id)) {
          await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'Temporary Operations read failure' }) })
          return
        }
        await route.continue()
      })
      await page.goto('/execution/operations')
      await expect(page.getByText('Temporary Operations read failure', { exact: true })).toBeVisible()
      await page.unroute('**/api/workstreams?*')
    } finally {
      await data.cleanup()
    }
  })
})
