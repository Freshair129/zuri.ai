import { beforeAll, describe, expect, it } from 'vitest'
import prisma from '@/lib/db'
import { createPortfolio, createTenant, createBusiness } from '../factories/scope'
import { makeViewer } from '../factories/viewer'
import { VIEWER_DOMAINS } from '@/modules/identity/viewer-domains'
import { registerIntegrationProvider, createIntegrationConnection, LINE_OA_PROVIDER_CODE } from '@/platform/integrations/core/integration-registry'
import { admitLineConversation, listLineConversationJobs } from '@/modules/line-oa-studio/application/line-conversation-jobs'
import { applyLineOaAccountAction } from '@/modules/line-oa-studio/application/line-oa-account-service'
import { getConversationThread } from '@/modules/crm/conversation-read-model'

// @req FR-243 — the session reaches the surfaces people use (TASK-ZAI-107): the LINE
//   job carries its session, the job list filters by session code without crossing
//   accounts, the inbox thread names each message's session, and the account's idle
//   timeout is set through a versioned action bounded to 10–120 minutes that never
//   fences queued work.
// @spec ADR-094 D3, D4; SDD-102; SEC-001
// @tested tests/integration/crm-conversation-session-surfaces.test.js

const env = { ZURI_LINE_REPLY_SEAL_KEY: 'd5'.repeat(32) }
const base = Date.UTC(2026, 8, 16, 2, 0, 0)
const minute = (n) => base + n * 60_000
let tenant, business, provider, owner, sequence = 0

async function makeAccount(over = {}) {
  const id = ++sequence
  const connection = await createIntegrationConnection({
    tenantId: tenant.id, businessId: business.id, providerId: provider.id,
    name: `Surface connection ${id}`, externalAccountId: `surface-oa-${id}`, status: 'ACTIVE',
  })
  return prisma.lineOaAccount.create({ data: {
    tenantId: tenant.id, businessId: business.id, integrationConnectionId: connection.id,
    code: `surface-account-${id}`, displayName: `Surface OA ${id}`, bindingCode: `surface-binding-${id}`,
    transportMode: 'CLOUD', serverEnabled: true, status: 'CONNECTED', executionMode: 'SERVER',
    modelAccess: 'EXTERNAL_MODEL_ALLOWED', ...over,
  } })
}

const admit = (account, user, id, atMin) => admitLineConversation({
  account, correlationId: 'corr-session-surfaces', env,
  now: new Date(minute(atMin) + 1_000), ingressReceivedAt: new Date(minute(atMin) + 1_000),
  event: {
    type: 'message', webhookEventId: `surface-event-${id}`, replyToken: `surface-token-${id}`,
    timestamp: minute(atMin), source: { type: 'user', userId: user },
    message: { id: `surface-msg-${id}`, type: 'text', text: `ข้อความ ${id}` },
  },
})

beforeAll(async () => {
  const portfolio = await createPortfolio({ name: 'Session surfaces', code: 'PF-SESSION-SURFACES' })
  tenant = await createTenant({ portfolioId: portfolio.id, name: 'Session surfaces tenant', code: 'TNT-SESSION-SURFACES' })
  business = await createBusiness({ tenantId: tenant.id, name: 'Session surfaces business', code: 'BUS-SESSION-SURFACES' })
  provider = await registerIntegrationProvider({ code: LINE_OA_PROVIDER_CODE, name: 'LINE OA' })
  owner = makeViewer({ role: 'OWNER', visibleBusinessIds: [business.id], ownedBusinessIds: [business.id], visibleDomains: [...VIEWER_DOMAINS] })
})

describe('FR-243 session on the LINE job and the job list', () => {
  it('copies the inbound message\'s session onto the job and filters the list by session code', async () => {
    const account = await makeAccount()
    const first = await admit(account, 'surface-user', 'a1', 0)
    await admit(account, 'surface-user', 'a2', 5)
    const third = await admit(account, 'surface-user', 'a3', 90)

    const firstJob = await prisma.lineConversationJob.findUnique({ where: { id: first.jobId }, include: { inbound: true } })
    const thirdJob = await prisma.lineConversationJob.findUnique({ where: { id: third.jobId }, include: { inbound: true } })
    expect(firstJob.sessionId).toBe(firstJob.inbound.sessionId)
    expect(thirdJob.sessionId).not.toBe(firstJob.sessionId)

    const session = await prisma.conversationSession.findUnique({ where: { id: firstJob.sessionId } })
    const all = await listLineConversationJobs(account.id, { viewer: owner })
    expect(all.jobs).toHaveLength(3)
    expect(all.session).toBeNull()

    const filtered = await listLineConversationJobs(account.id, { viewer: owner, sessionCode: session.code.toLowerCase() })
    expect(filtered.session).toMatchObject({ code: session.code, inboundCount: 2 })
    expect(filtered.jobs.map((job) => job.id).sort()).toEqual([first.jobId, (await prisma.lineConversationJob.findFirst({ where: { eventId: 'surface-event-a2' } })).id].sort())
    expect(filtered.jobs.every((job) => job.sessionCode === session.code)).toBe(true)
    // The DTO stays bounded: no LINE ids, tokens or text.
    expect(Object.keys(filtered.jobs[0])).not.toEqual(expect.arrayContaining(['recipientId', 'sealedReplyToken', 'answerText']))
  })

  it('answers an empty list for a session of another account and refuses a malformed code', async () => {
    const accountA = await makeAccount()
    const accountB = await makeAccount()
    const foreign = await admit(accountB, 'surface-other', 'b1', 0)
    await admit(accountA, 'surface-mine', 'c1', 0)
    const foreignJob = await prisma.lineConversationJob.findUnique({ where: { id: foreign.jobId } })
    const foreignSession = await prisma.conversationSession.findUnique({ where: { id: foreignJob.sessionId } })

    const crossed = await listLineConversationJobs(accountA.id, { viewer: owner, sessionCode: foreignSession.code })
    expect(crossed).toMatchObject({ session: null, jobs: [] })
    await expect(listLineConversationJobs(accountA.id, { viewer: owner, sessionCode: 'S-2026-bad' }))
      .rejects.toMatchObject({ status: 400, message: 'SESSION_CODE_INVALID' })
  })
})

describe('FR-243 session in the inbox thread', () => {
  it('names each message\'s session code and when that session opened', async () => {
    const account = await makeAccount()
    const first = await admit(account, 'surface-thread', 't1', 0)
    await admit(account, 'surface-thread', 't2', 100)
    const inbound = await prisma.message.findUnique({ where: { id: first.inboundMessageId } })

    const thread = await getConversationThread({ viewer: owner, businessId: business.id, conversationId: inbound.conversationId })
    expect(thread.messages).toHaveLength(2)
    const [a, b] = thread.messages
    expect(a.sessionCode).toMatch(/^S-20260916-[0-9A-Z]{6}$/)
    expect(b.sessionCode).toMatch(/^S-20260916-[0-9A-Z]{6}$/)
    expect(a.sessionId).not.toBe(b.sessionId)
    expect(a.sessionOpenedAt).toBe(new Date(minute(0)).toISOString())
    expect(b.sessionOpenedAt).toBe(new Date(minute(100)).toISOString())
  })
})

describe('FR-243 CONFIGURE_SESSION_TIMEOUT', () => {
  it('saves a timeout between 10 and 120, applies it to the next message, and never fences queued work', async () => {
    const account = await makeAccount()
    await admit(account, 'surface-timeout', 'd1', 0)

    const updated = await applyLineOaAccountAction(account.id, { action: 'CONFIGURE_SESSION_TIMEOUT', version: account.version, sessionIdleTimeoutMinutes: 120 }, { db: prisma, viewer: owner })
    expect(updated.sessionIdleTimeoutMinutes).toBe(120)
    const row = await prisma.lineOaAccount.findUnique({ where: { id: account.id } })
    expect(row.sessionIdleTimeoutMinutes).toBe(120)
    expect(row.transportEpoch).toBe(account.transportEpoch)

    await admit(row, 'surface-timeout', 'd2', 100)
    const [m1, m2] = await prisma.message.findMany({ where: { externalMessageId: { in: ['surface-msg-d1', 'surface-msg-d2'] } }, orderBy: { createdAt: 'asc' } })
    expect(m2.sessionId).toBe(m1.sessionId)

    const audit = await prisma.auditEvent.findFirst({ where: { entityId: account.id }, orderBy: { occurredAt: 'desc' } })
    expect(audit.payloadJson).toContain('sessionIdleTimeoutMinutes')
  })

  it('refuses 9, 121 and a missing value, and refuses a value that does not change', async () => {
    const account = await makeAccount()
    for (const sessionIdleTimeoutMinutes of [9, 121, 30.5]) {
      await expect(applyLineOaAccountAction(account.id, { action: 'CONFIGURE_SESSION_TIMEOUT', version: account.version, sessionIdleTimeoutMinutes }, { db: prisma, viewer: owner }))
        .rejects.toBeTruthy()
    }
    await expect(applyLineOaAccountAction(account.id, { action: 'CONFIGURE_SESSION_TIMEOUT', version: account.version }, { db: prisma, viewer: owner }))
      .rejects.toBeTruthy()
    await expect(applyLineOaAccountAction(account.id, { action: 'CONFIGURE_SESSION_TIMEOUT', version: account.version, sessionIdleTimeoutMinutes: 30 }, { db: prisma, viewer: owner }))
      .rejects.toMatchObject({ status: 409, message: 'LINE_OA_SESSION_TIMEOUT_UNCHANGED' })
    const row = await prisma.lineOaAccount.findUnique({ where: { id: account.id } })
    expect(row.sessionIdleTimeoutMinutes).toBe(30)
  })
})
