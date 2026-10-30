const { test, expect } = require('@playwright/test')
const { randomUUID } = require('node:crypto')
const { loginAsOwner } = require('./e2e-auth')

// CRM-READ-01 browser acceptance. The Playwright global setup binds this run to
// its own e2e-${E2E_PORT}.db; fixtures below never leave that disposable SQLite.
let prisma
let businessId
let siblingBusinessId
let ownerPersonId
let runId
let firstLabel
let secondLabel
let missingLabel
let first
let second
let sibling
let missing

async function makeConversation(label, targetBusinessId, { consentStatus = 'GRANTED', summary = null } = {}) {
  const suffix = randomUUID().slice(0, 8)
  const person = await prisma.person.create({
    data: { code: `PER-E2E-${suffix}`, displayName: label },
  })
  const customer = await prisma.customer.create({
    data: {
      code: `CUS-E2E-${suffix}`,
      tenantId: (await prisma.business.findUnique({ where: { id: targetBusinessId }, select: { tenantId: true } })).tenantId,
      businessId: targetBusinessId,
      personId: person.id,
      displayName: label,
      consentStatus,
      ...(consentStatus === 'GRANTED' ? { consentRecordedAt: new Date(), consentRecordedByPersonId: ownerPersonId } : {}),
    },
  })
  const conversation = await prisma.conversation.create({
    data: {
      tenantId: customer.tenantId,
      businessId: targetBusinessId,
      customerId: customer.id,
      channel: 'LINE',
      externalThreadId: `TH-E2E-${suffix}`,
    },
  })
  if (summary) {
    await prisma.conversationAnalysis.create({
      data: {
        conversationId: conversation.id,
        analyzedDate: new Date(),
        contactType: 'NEW_LEAD',
        state: 'HOT',
        cta: `CTA ${label}`,
        tags: JSON.stringify([`tag-${label}`]),
        summary,
        rawOutputJson: '{"privateMarker":"MUST_NOT_RENDER"}',
      },
    })
  }
  return { customerId: customer.id, conversationId: conversation.id, summary }
}

test.beforeAll(async () => {
  runId = randomUUID().slice(0, 8)
  firstLabel = `CRM E2E ${runId} first`
  secondLabel = `CRM E2E ${runId} second`
  missingLabel = `CRM E2E ${runId} missing analysis`
  const port = Number(process.env.E2E_PORT || 3100)
  process.env.DATABASE_URL = `file:./e2e-${port}.db`
  const { PrismaClient } = require('@prisma/client')
  prisma = new PrismaClient()
  const business = await prisma.business.findUnique({ where: { code: 'BUS-001' } })
  if (!business) throw new Error('Disposable E2E seed lacks BUS-001')
  businessId = business.id
  const ownerMembership = await prisma.membership.findFirst({
    where: { businessId, role: 'OWNER', status: 'ACTIVE' },
    select: { personId: true },
  })
  if (!ownerMembership) throw new Error('Disposable E2E seed lacks a Business 01 owner')
  ownerPersonId = ownerMembership.personId
  const siblingRecord = await prisma.business.create({
    data: {
      code: `BUS-E2E-SIBLING-${randomUUID().slice(0, 8)}`,
      name: 'CRM E2E sibling Business',
      tenantId: business.tenantId,
    },
  })
  siblingBusinessId = siblingRecord.id
  first = await makeConversation(firstLabel, businessId, { summary: 'FIRST SAFE SUMMARY' })
  second = await makeConversation(secondLabel, businessId, { summary: 'SECOND SAFE SUMMARY' })
  sibling = await makeConversation(`CRM E2E ${runId} sibling`, siblingBusinessId, { summary: 'SIBLING PRIVATE SUMMARY' })
  missing = await makeConversation(missingLabel, businessId)
})

test.afterAll(async () => {
  if (prisma) await prisma.$disconnect()
})

test('Inbox displays consented selected-Business analysis and clears stale responses on navigation', async ({ page }) => {
  await loginAsOwner(page)
  await page.getByRole('button', { name: /Open Business Business 01/ }).click()
  await page.goto('/customer/conversations')
  await expect(page).toHaveURL(/\/customer\/conversations$/)
  await expect(page.getByRole('heading', { name: 'Inbox' })).toBeVisible()

  const firstRow = page.getByRole('button', { name: new RegExp(firstLabel) })
  const secondRow = page.getByRole('button', { name: new RegExp(secondLabel) })
  await expect(firstRow).toBeVisible()
  await expect(secondRow).toBeVisible()

  let releaseFirstThread
  let firstThreadResponseSeen
  const firstThreadResponse = new Promise((resolve) => { firstThreadResponseSeen = resolve })
  await page.route(`**/api/crm/conversations/${first.conversationId}?*`, async (route) => {
    const response = await route.fetch()
    firstThreadResponseSeen()
    await new Promise((resolve) => { releaseFirstThread = resolve })
    await route.fulfill({ response })
  })
  await firstRow.click()
  await firstThreadResponse
  await secondRow.click()
  await expect(page.getByText('SECOND SAFE SUMMARY')).toBeVisible()
  const firstThreadSettled = page.waitForResponse((response) =>
    response.url().includes(`/api/crm/conversations/${first.conversationId}?`),
  )
  releaseFirstThread()
  await firstThreadSettled
  await expect(page.getByText('SECOND SAFE SUMMARY')).toBeVisible()
  await expect(page.getByText(firstLabel, { exact: true })).toHaveCount(1)
  await expect(page.getByText(secondLabel, { exact: true })).toHaveCount(2)
  await page.unroute(`**/api/crm/conversations/${first.conversationId}?*`)

  let releaseFirst
  let firstRequestSeen
  const firstRequest = new Promise((resolve) => { firstRequestSeen = resolve })
  await page.route(`**/api/crm/conversations/${first.conversationId}/analysis?*`, async (route) => {
    releaseFirst = async () => {
      try {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            conversationId: first.conversationId,
            analyses: [{ id: 'late-first', conversationId: first.conversationId, analyzedAt: new Date().toISOString(), contactType: 'NEW_LEAD', state: 'HOT', cta: null, tags: [], summary: 'LATE STALE SUMMARY' }],
          }),
        })
      } catch {
        // The panel aborts this request on selection change; a canceled route
        // must not turn the stale-result assertion into a teardown failure.
      }
    }
    firstRequestSeen()
  })

  await firstRow.click()
  await firstRequest
  await expect(page.getByText('กำลังโหลดผลวิเคราะห์…')).toBeVisible()
  await secondRow.click()
  await expect(page.getByText('SECOND SAFE SUMMARY')).toBeVisible()
  await expect(page.getByText('FIRST SAFE SUMMARY')).toHaveCount(0)
  await releaseFirst()
  await expect(page.getByText('LATE STALE SUMMARY')).toHaveCount(0)
  await expect(page.getByText('MUST_NOT_RENDER')).toHaveCount(0)
  await expect(page.getByText('SECOND SAFE SUMMARY')).toBeVisible()

  const siblingResponse = await page.request.get(`/api/crm/conversations/${sibling.conversationId}/analysis?businessId=${businessId}`)
  expect(siblingResponse.status()).toBe(404)
  await expect(page.getByText('SIBLING PRIVATE SUMMARY')).toHaveCount(0)
})

test('revoked consent, erased Customers, and missing analyses fail closed in the Inbox', async ({ page }) => {
  await prisma.customer.update({ where: { id: first.customerId }, data: { consentStatus: 'DECLINED' } })
  await loginAsOwner(page)
  await page.getByRole('button', { name: /Open Business Business 01/ }).click()
  await page.goto('/customer/conversations')
  const firstRow = page.getByRole('button', { name: new RegExp(firstLabel) })
  await firstRow.click()
  await expect(page.getByText('ไม่สามารถแสดงผลวิเคราะห์ได้ในสถานะ consent ปัจจุบัน')).toBeVisible()
  const revoked = await page.request.get(`/api/crm/conversations/${first.conversationId}/analysis?businessId=${businessId}`)
  expect(revoked.status()).toBe(404)
  await expect(page.getByText('FIRST SAFE SUMMARY')).toHaveCount(0)

  await prisma.customer.update({ where: { id: second.customerId }, data: { deletedAt: new Date() } })
  const erased = await page.request.get(`/api/crm/conversations/${second.conversationId}/analysis?businessId=${businessId}`)
  expect(erased.status()).toBe(404)
  await page.reload()
  await expect(page.getByRole('heading', { name: 'Inbox' })).toBeVisible()
  const erasedThread = page.getByRole('button', { name: new RegExp(secondLabel) })
  await expect(erasedThread).toHaveCount(1)
  await erasedThread.click()
  await expect(page.getByText('เปิดห้องสนทนาไม่ได้')).toBeVisible()
  await expect(page.getByText('SECOND SAFE SUMMARY')).toHaveCount(0)

  await page.reload()
  await page.getByRole('button', { name: new RegExp(missingLabel) }).click()
  await expect(page.getByText('ยังไม่มีผลวิเคราะห์สำหรับบทสนทนานี้')).toBeVisible()
  const noAnalysis = await page.request.get(`/api/crm/conversations/${missing.conversationId}/analysis?businessId=${businessId}`)
  expect(noAnalysis.ok()).toBeTruthy()
  expect((await noAnalysis.json()).analyses).toEqual([])
})
