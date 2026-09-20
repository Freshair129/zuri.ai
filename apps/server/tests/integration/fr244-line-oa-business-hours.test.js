import { beforeAll, describe, expect, it } from 'vitest'
import prisma from '@/lib/db'
import { createPortfolio, createTenant, createBusiness } from '../factories/scope'
import { makeViewer } from '../factories/viewer'
import { VIEWER_DOMAINS } from '@/modules/identity/viewer-domains'
import { registerIntegrationProvider, createIntegrationConnection, LINE_OA_PROVIDER_CODE } from '@/platform/integrations/core/integration-registry'
import { admitLineConversation } from '@/modules/line-oa-studio/application/line-conversation-jobs'
import { applyLineOaAccountAction } from '@/modules/line-oa-studio/application/line-oa-account-service'

// @req FR-244 — business hours reach production behaviour: a publisher declares
//   them through a versioned action, an inbound message outside them is answered
//   with the fixed reply and no execution ever claims the job.
// @req FR-265 — the model-residency directive this requirement also shipped is
//   withdrawn with EDGE execution (ADR-100 D2); declared business hours are not.
// @spec ADR-094 D6 option A; ADR-061; ADR-100 D2; SEC-001
// @tested tests/integration/fr244-line-oa-business-hours.test.js

const env = { ZURI_LINE_REPLY_SEAL_KEY: 'e6'.repeat(32) }
let tenant, business, provider, owner, sequence = 0

async function makeAccount(over = {}) {
  const id = ++sequence
  const connection = await createIntegrationConnection({
    tenantId: tenant.id, businessId: business.id, providerId: provider.id,
    name: `Hours connection ${id}`, externalAccountId: `hours-oa-${id}`, status: 'ACTIVE',
  })
  return prisma.lineOaAccount.create({ data: {
    tenantId: tenant.id, businessId: business.id, integrationConnectionId: connection.id,
    code: `hours-account-${id}`, displayName: `Hours OA ${id}`, bindingCode: `hours-binding-${id}`,
    transportMode: 'CLOUD', serverEnabled: true, status: 'CONNECTED', executionMode: 'SERVER',
    modelAccess: 'EXTERNAL_MODEL_ALLOWED', ...over,
  } })
}

const admit = (account, user, id, at) => admitLineConversation({
  account, correlationId: 'corr-business-hours', env, now: at, ingressReceivedAt: at,
  event: {
    type: 'message', webhookEventId: `hours-event-${id}`, replyToken: `hours-token-${id}`,
    timestamp: at.getTime(), source: { type: 'user', userId: user },
    message: { id: `hours-msg-${id}`, type: 'text', text: `ข้อความ ${id}` },
  },
})

beforeAll(async () => {
  const portfolio = await createPortfolio({ name: 'Business hours', code: 'PF-BUSINESS-HOURS' })
  tenant = await createTenant({ portfolioId: portfolio.id, name: 'Business hours tenant', code: 'TNT-BUSINESS-HOURS' })
  business = await createBusiness({ tenantId: tenant.id, name: 'Business hours business', code: 'BUS-BUSINESS-HOURS' })
  provider = await registerIntegrationProvider({ code: LINE_OA_PROVIDER_CODE, name: 'LINE OA' })
  owner = makeViewer({ role: 'OWNER', visibleBusinessIds: [business.id], ownedBusinessIds: [business.id], visibleDomains: [...VIEWER_DOMAINS] })
})

describe('FR-244 CONFIGURE_BUSINESS_HOURS', () => {
  it('declares hours and a reply together, and clears all three together', async () => {
    const account = await makeAccount()
    const declared = await applyLineOaAccountAction(account.id, {
      action: 'CONFIGURE_BUSINESS_HOURS', version: account.version,
      businessHoursOpen: '09:00', businessHoursClose: '18:00', outOfHoursReplyText: 'ขณะนี้ปิดทำการ กรุณาติดต่อใหม่ในเวลาทำการ',
    }, { db: prisma, viewer: owner })
    expect(declared.businessHoursOpen).toBe('09:00')
    expect(declared.outOfHoursReplyText).toContain('ปิดทำการ')

    const audit = await prisma.auditEvent.findFirst({ where: { entityId: account.id }, orderBy: { occurredAt: 'desc' } })
    expect(audit.payloadJson).toContain('businessHours')

    const cleared = await applyLineOaAccountAction(account.id, { action: 'CONFIGURE_BUSINESS_HOURS', version: declared.version, clearBusinessHours: true }, { db: prisma, viewer: owner })
    expect(cleared.businessHoursOpen).toBeNull()
    expect(cleared.businessHoursClose).toBeNull()
    expect(cleared.outOfHoursReplyText).toBeNull()
  })

  it('refuses a value that does not change, same as the session timeout action', async () => {
    const account = await makeAccount()
    await expect(applyLineOaAccountAction(account.id, { action: 'CONFIGURE_BUSINESS_HOURS', version: account.version, clearBusinessHours: true }, { db: prisma, viewer: owner }))
      .rejects.toMatchObject({ status: 409, message: 'LINE_OA_BUSINESS_HOURS_UNCHANGED' })
  })

  it('never fences queued transport work, unlike a transport-mode switch', async () => {
    const account = await makeAccount()
    const before = account.transportEpoch
    const updated = await applyLineOaAccountAction(account.id, {
      action: 'CONFIGURE_BUSINESS_HOURS', version: account.version,
      businessHoursOpen: '09:00', businessHoursClose: '18:00', outOfHoursReplyText: 'ปิดทำการ',
    }, { db: prisma, viewer: owner })
    const row = await prisma.lineOaAccount.findUnique({ where: { id: account.id } })
    expect(row.transportEpoch).toBe(before)
    expect(updated.transportEpoch).toBe(before)
  })
})

describe('FR-244 out-of-hours admission', () => {
  it('answers outside declared hours with the fixed reply, no execution, recorded like any other reply', async () => {
    const account = await makeAccount()
    await applyLineOaAccountAction(account.id, {
      action: 'CONFIGURE_BUSINESS_HOURS', version: account.version,
      businessHoursOpen: '09:00', businessHoursClose: '18:00', outOfHoursReplyText: 'ขณะนี้ปิดทำการ กรุณาติดต่อใหม่ในเวลาทำการ',
    }, { db: prisma, viewer: owner })
    const row = await prisma.lineOaAccount.findUnique({ where: { id: account.id } })

    // 20:00 Bangkok = 13:00Z, an hour after this account's 18:00 close.
    const result = await admit(row, 'hours-user-out', 'out1', new Date('2026-09-16T13:00:00Z'))
    const job = await prisma.lineConversationJob.findUnique({ where: { id: result.jobId } })
    expect(job.status).toBe('READY')
    expect(job.answerText).toBe('ขณะนี้ปิดทำการ กรุณาติดต่อใหม่ในเวลาทำการ')
    // Never claimed, never executed: no claimant, no execution id, no lease ever set.
    expect(job.claimantId).toBeNull()
    expect(job.executionId).toBeNull()
    expect(job.leaseExpiresAt).toBeNull()

    const trace = await prisma.agentTraceEvent.findMany({ where: { turnId: job.id }, orderBy: { occurredAt: 'asc' } })
    expect(trace.map((event) => event.kind)).toEqual(['TURN_RECEIVED', 'ANSWER_READY'])
    const answerReady = JSON.parse(trace[1].payloadJson)
    expect(answerReady.executionEvidence).toBe('OUT_OF_HOURS_RULE')
  })

  it('answers normally (QUEUED, no answerText) inside declared hours', async () => {
    const account = await makeAccount()
    await applyLineOaAccountAction(account.id, {
      action: 'CONFIGURE_BUSINESS_HOURS', version: account.version,
      businessHoursOpen: '09:00', businessHoursClose: '18:00', outOfHoursReplyText: 'ปิดทำการ',
    }, { db: prisma, viewer: owner })
    const row = await prisma.lineOaAccount.findUnique({ where: { id: account.id } })

    // Noon Bangkok = 05:00Z, inside 09:00–18:00.
    const result = await admit(row, 'hours-user-in', 'in1', new Date('2026-09-16T05:00:00Z'))
    const job = await prisma.lineConversationJob.findUnique({ where: { id: result.jobId } })
    expect(job.status).toBe('QUEUED')
    expect(job.answerText).toBeNull()
  })

  it('answers normally with no declared hours (today\'s behaviour, unaffected)', async () => {
    const account = await makeAccount()
    const result = await admit(account, 'hours-user-undeclared', 'u1', new Date('2026-09-16T13:00:00Z'))
    const job = await prisma.lineConversationJob.findUnique({ where: { id: result.jobId } })
    expect(job.status).toBe('QUEUED')
    expect(job.answerText).toBeNull()
  })
})

// @req FR-265 — `describe('FR-244 model residency directive')` stood here. The
// directive told a compute-owned edge worker whether to hold a local model in
// VRAM; its route and service are withdrawn with EDGE execution (ADR-100 D2), and
// the aggregation rule it proved has no remaining consumer. FR-244's other half —
// the declared business hours themselves, and the out-of-hours reply created
// straight at READY without a model call — is unaffected and is covered above.
