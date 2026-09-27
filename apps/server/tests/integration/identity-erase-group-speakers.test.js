import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import prisma from '@/lib/db'
import { createPortfolio, createTenant, createBusiness } from '../factories/scope'
import { registerIntegrationProvider, createIntegrationConnection, LINE_OA_PROVIDER_CODE } from '@/platform/integrations/core/integration-registry'
import { admitLineConversation, runtimeSenderAuthority } from '@/modules/line-oa-studio/application/line-conversation-jobs'
import { redactLineConversationJobs } from '@/modules/line-oa-studio/application/line-job-erasure'
import { appendOutbound } from '@/modules/crm/reply-record-service'
import { CUSTOMER_ERASURE_TOMBSTONE } from '@/modules/crm/conversation-redaction-service'
import { erasePrincipal } from '@/modules/identity/erase-principal'

// @req FR-022 — PDPA erasure follows the speaker in a shared LINE group or room thread.
// A group Conversation belongs to the Customer of its FIRST speaker (A). Erasing any other
// speaker (B) must still redact B's own lines, jobs, trace inputs, the replies to B and the
// raw payloads of B's messages; erasing A must redact only A's, leaving B's content and B's
// in-flight turn exactly as they were. A direct chat keeps the reference behaviour: the
// whole thread is erased.
// @spec SEC-001, SEC-005, ADR-061, ADR-106 D3
// @tested tests/integration/identity-erase-group-speakers.test.js

const sealKey = '6e'.repeat(32)
let tenant, business, account, runtimeAccount, connection, provider
let sequence = 0

const next = label => `${label}-${++sequence}`

async function admit({ thread, speaker, text, type = 'group', via = account }) {
  const eventId = next('synthetic-erase-grp-event')
  const source = type === 'group' ? { type: 'group', groupId: thread, userId: speaker }
    : type === 'room' ? { type: 'room', roomId: thread, userId: speaker } : { type: 'user', userId: speaker }
  const event = { type: 'message', webhookEventId: eventId, replyToken: `synthetic-reply-${eventId}`, timestamp: Date.now(),
    source, message: { type: 'text', id: `synthetic-line-msg-${eventId}`, text } }
  const current = await prisma.lineOaAccount.findUnique({ where: { id: via.id } })
  const result = await admitLineConversation({ db: prisma, account: current, env: { ZURI_LINE_REPLY_SEAL_KEY: sealKey },
    correlationId: eventId, now: new Date(), event })
  return { ...result, lineMessageId: event.message.id }
}

async function reply(inboundMessageId, text) {
  const outbound = await appendOutbound({ db: prisma, tenantId: tenant.id, businessId: business.id,
    channelAccountId: account.bindingCode, receipt: { inboundMessageId, text, source: 'STACK' } })
  return outbound.messageId
}

async function rawRecord(externalId, text) {
  return prisma.rawExternalRecord.create({ data: {
    tenantId: tenant.id, businessId: business.id, connectionId: connection.id, provider: 'LINE', lane: 'WEBHOOK',
    entityType: 'message', externalId, sourceType: 'WEBHOOK', schemaVersion: '1',
    payloadJson: JSON.stringify({ text }), payloadHash: next('hash'), idempotencyKey: next('raw-idem'), receivedAt: new Date(),
  } })
}

async function personOf(subject) {
  const identity = await prisma.channelIdentity.findFirst({ where: { tenantId: tenant.id, providerSubject: subject } })
  return identity.personId
}

/**
 * One group thread: A speaks first (so A's Customer owns the Conversation), then B; each
 * has an unmentioned line and a mention that gets an answer job and a recorded reply.
 * B's job is left in flight (CLAIMED). B also has a direct chat with the OA.
 */
async function scene(type = 'group') {
  const A = next(`Usynthetic-erase-a-${type}`)
  const B = next(`Usynthetic-erase-b-${type}`)
  const thread = next(type === 'group' ? 'Csynthetic-erase-grp' : 'Rsynthetic-erase-room')
  const aLine = await admit({ type, thread, speaker: A, text: 'A private group line' })
  const bLine = await admit({ type, thread, speaker: B, text: 'B private group line' })
  const aAsk = await admit({ type, thread, speaker: A, text: 'ซูริ A asks about order A-1' })
  const bAsk = await admit({ type, thread, speaker: B, text: 'ซูริ B asks about order B-1' })
  const aReply = await reply(aAsk.inboundMessageId, 'Reply to A about order A-1')
  const bReply = await reply(bAsk.inboundMessageId, 'Reply to B about order B-1')
  await prisma.lineConversationJob.update({ where: { id: aAsk.jobId }, data: { status: 'READY', answerText: 'answer for A' } })
  await prisma.lineConversationJob.update({ where: { id: bAsk.jobId }, data: {
    status: 'CLAIMED', claimantId: 'synthetic-in-flight', leaseExpiresAt: new Date(Date.now() + 60_000) } })
  const bDirect = await admit({ type: 'user', thread: B, speaker: B, text: 'B direct private line' })
  const bDirectReply = await reply(bDirect.inboundMessageId, 'Direct reply to B')
  const groupConversationId = (await prisma.message.findUnique({ where: { id: aLine.inboundMessageId } })).conversationId
  const directConversationId = (await prisma.message.findUnique({ where: { id: bDirect.inboundMessageId } })).conversationId
  const raw = {
    a: await rawRecord(aLine.lineMessageId, 'A private group line'),
    b: await rawRecord(bLine.lineMessageId, 'B private group line'),
  }
  const analysis = await prisma.conversationAnalysis.create({ data: { conversationId: groupConversationId,
    analyzedDate: new Date(), contactType: 'CUSTOMER', state: 'OPEN', tags: '[]', summary: 'mixes A and B' } })
  return {
    A, B, thread, aLine, bLine, aAsk, bAsk, aReply, bReply, bDirect, bDirectReply, raw, analysisId: analysis.id,
    groupConversationId, directConversationId,
    personA: await personOf(A), personB: await personOf(B),
  }
}

const body = async id => (await prisma.message.findUnique({ where: { id } })).body
const job = id => prisma.lineConversationJob.findUnique({ where: { id } })
const trace = turnId => prisma.agentTraceEvent.findMany({ where: { turnId }, orderBy: [{ occurredAt: 'asc' }, { id: 'asc' }] })
const payloadOf = async id => (await prisma.rawExternalRecord.findUnique({ where: { id } })).payloadJson

async function expectJobErased(id) {
  expect(await job(id)).toMatchObject({ status: expect.stringMatching(/^(CANCELLED|UNKNOWN)$/), errorCode: 'PDPA_ERASURE',
    answerText: null, recipientId: '[erased]', sourceUserId: '[erased]', sealedReplyToken: null, claimantId: null })
  const events = await trace(id)
  expect(events.filter(event => event.kind === 'RETENTION_TOMBSTONE')).toHaveLength(1)
  for (const event of events.filter(event => event.kind !== 'RETENTION_TOMBSTONE')) {
    expect(event.payloadJson).toBe('{"redacted":true}')
  }
}

async function expectTraceIntact(id, text) {
  const events = await trace(id)
  expect(events.some(event => event.kind === 'RETENTION_TOMBSTONE')).toBe(false)
  expect(events.find(event => event.kind === 'TURN_RECEIVED').payloadJson).toContain(text)
}

beforeAll(async () => {
  const portfolio = await createPortfolio({ name: 'Group speaker erasure fixture', code: 'PF-ERASE-GRP' })
  tenant = await createTenant({ portfolioId: portfolio.id, name: 'Group speaker erasure tenant', code: 'TNT-ERASE-GRP' })
  business = await createBusiness({ tenantId: tenant.id, name: 'Group speaker erasure business', code: 'BUS-ERASE-GRP' })
  provider = await registerIntegrationProvider({ code: LINE_OA_PROVIDER_CODE, name: 'LINE OA' })
  connection = await createIntegrationConnection({ tenantId: tenant.id, businessId: business.id, providerId: provider.id,
    name: 'Synthetic erasure connection', externalAccountId: 'synthetic-erase-grp-destination', status: 'ACTIVE' })
  account = await prisma.lineOaAccount.create({ data: { tenantId: tenant.id, businessId: business.id,
    integrationConnectionId: connection.id, code: 'erase-grp', displayName: 'Synthetic erasure OA',
    bindingCode: 'erase-grp-binding', status: 'CONNECTED', serverEnabled: true, transportMode: 'CLOUD',
    allowDelayedPush: true } })
  const runtimeConnection = await createIntegrationConnection({ tenantId: tenant.id, businessId: business.id, providerId: provider.id,
    name: 'Synthetic erasure runtime connection', externalAccountId: 'synthetic-erase-grp-runtime-destination', status: 'ACTIVE' })
  runtimeAccount = await prisma.lineOaAccount.create({ data: { tenantId: tenant.id, businessId: business.id,
    integrationConnectionId: runtimeConnection.id, code: 'erase-grp-runtime', displayName: 'Synthetic erasure runtime OA',
    bindingCode: 'erase-grp-runtime-binding', status: 'CONNECTED', serverEnabled: true, transportMode: 'CLOUD',
    allowDelayedPush: true, runtimeOwner: 'CONVERSATION_RUNTIME' } })
})

// Leave nothing claimable for a later suite's worker in the same run.
afterEach(async () => {
  await prisma.lineConversationJob.updateMany({ where: { accountId: { in: [account.id, runtimeAccount.id] }, status: { in: ['QUEUED', 'CLAIMED', 'READY', 'SENDING'] } },
    data: { status: 'CANCELLED', errorCode: 'TEST_ERASE_GROUP_DONE', claimantId: null, leaseExpiresAt: null, version: { increment: 1 } } })
})

describe('PDPA erasure in a shared LINE group or room thread (FR-022)', () => {
  for (const type of ['group', 'room']) {
    it(`erasing a later speaker (B) in a ${type} redacts B's rows and leaves the first speaker's untouched`, async () => {
      const s = await scene(type)
      const conversation = await prisma.conversation.findUnique({ where: { id: s.groupConversationId }, include: { customer: true } })
      expect(conversation.customer.personId).toBe(s.personA)

      await erasePrincipal({ tenantId: tenant.id, personId: s.personB, reason: 'TEST_ERASURE' })

      // B's own lines and the reply to B, in a thread A's Customer owns.
      expect(await body(s.bLine.inboundMessageId)).toBe(CUSTOMER_ERASURE_TOMBSTONE)
      expect(await body(s.bAsk.inboundMessageId)).toBe(CUSTOMER_ERASURE_TOMBSTONE)
      expect(await body(s.bReply)).toBe(CUSTOMER_ERASURE_TOMBSTONE)
      // B's job row, its payloads and its trace input snapshot.
      await expectJobErased(s.bAsk.jobId)
      expect(await payloadOf(s.raw.b.id)).toContain('"redacted":true')
      // The thread's analysis is derived from B's words too, so it goes (recomputable).
      expect(await prisma.conversationAnalysis.findUnique({ where: { id: s.analysisId } })).toBeNull()
      // B's direct chat, erased whole as before.
      expect(await body(s.bDirect.inboundMessageId)).toBe(CUSTOMER_ERASURE_TOMBSTONE)
      expect(await body(s.bDirectReply)).toBe(CUSTOMER_ERASURE_TOMBSTONE)
      await expectJobErased(s.bDirect.jobId)

      // A: every row exactly as it was.
      expect(await body(s.aLine.inboundMessageId)).toBe('A private group line')
      expect(await body(s.aAsk.inboundMessageId)).toBe('ซูริ A asks about order A-1')
      expect(await body(s.aReply)).toBe('Reply to A about order A-1')
      expect(await job(s.aAsk.jobId)).toMatchObject({ status: 'READY', errorCode: null, answerText: 'answer for A',
        sourceUserId: s.A, recipientId: s.thread })
      await expectTraceIntact(s.aAsk.jobId, 'A asks about order A-1')
      expect(await payloadOf(s.raw.a.id)).toContain('A private group line')
      const after = await prisma.conversation.findUnique({ where: { id: s.groupConversationId }, include: { customer: true } })
      expect(after.customer.deletedAt).toBeNull()
      expect(after.externalThreadId).toBe(s.thread)
      expect(after.lastMessagePreview ?? '').not.toContain('B-1')
    })
  }

  it('erasing the first speaker (A) redacts only A, and does not cancel B\'s in-flight turn', async () => {
    const s = await scene('group')
    const bJobBefore = await job(s.bAsk.jobId)

    await erasePrincipal({ tenantId: tenant.id, personId: s.personA, reason: 'TEST_ERASURE' })

    expect(await body(s.aLine.inboundMessageId)).toBe(CUSTOMER_ERASURE_TOMBSTONE)
    expect(await body(s.aAsk.inboundMessageId)).toBe(CUSTOMER_ERASURE_TOMBSTONE)
    expect(await body(s.aReply)).toBe(CUSTOMER_ERASURE_TOMBSTONE)
    await expectJobErased(s.aAsk.jobId)
    expect(await payloadOf(s.raw.a.id)).toContain('"redacted":true')

    expect(await body(s.bLine.inboundMessageId)).toBe('B private group line')
    expect(await body(s.bAsk.inboundMessageId)).toBe('ซูริ B asks about order B-1')
    expect(await body(s.bReply)).toBe('Reply to B about order B-1')
    expect(await body(s.bDirect.inboundMessageId)).toBe('B direct private line')
    const bJob = await job(s.bAsk.jobId)
    expect(bJob).toEqual(bJobBefore)
    expect(bJob).toMatchObject({ status: 'CLAIMED', claimantId: 'synthetic-in-flight', errorCode: null, sourceUserId: s.B })
    await expectTraceIntact(s.bAsk.jobId, 'B asks about order B-1')
    expect(await payloadOf(s.raw.b.id)).toContain('B private group line')
    expect((await prisma.conversation.findUnique({ where: { id: s.groupConversationId } })).lastMessagePreview)
      .toContain('B-1')
  })

  it('keeps the direct-chat reference behaviour: the whole thread, both directions, and its jobs', async () => {
    const s = await scene('group')
    const directMessages = await prisma.message.findMany({ where: { conversationId: s.directConversationId } })
    expect(directMessages).toHaveLength(2)

    const result = await erasePrincipal({ tenantId: tenant.id, personId: s.personB, reason: 'TEST_ERASURE' })

    for (const message of await prisma.message.findMany({ where: { conversationId: s.directConversationId } })) {
      expect(message.body).toBe(CUSTOMER_ERASURE_TOMBSTONE)
    }
    const direct = await prisma.conversation.findUnique({ where: { id: s.directConversationId }, include: { customer: true } })
    expect(direct.lastMessagePreview).toBe(CUSTOMER_ERASURE_TOMBSTONE)
    expect(direct.customer).toMatchObject({ displayName: '[erased]', lifecycleStage: 'LOST' })
    expect(direct.customer.deletedAt).not.toBeNull()
    await expectJobErased(s.bDirect.jobId)
    // Direct thread: 2 messages + 1 job. Shared thread: B's 2 lines + the reply to B, and B's job.
    expect(result).toMatchObject({ redactedMessages: 5, redactedLineJobs: 2, revokedChannelIdentities: 1, erasedCustomers: 1 })
    const audit = await prisma.auditEvent.findFirst({ where: { entityType: 'PRINCIPAL', entityId: s.personB, action: 'ERASED' } })
    expect(JSON.parse(audit.payloadJson)).toMatchObject({ redactedMessages: 5, redactedLineJobs: 2, sharedThreads: 1 })
  })

  it('attributes a row written before the author column through the job its speaker was admitted with', async () => {
    const s = await scene('group')
    await prisma.message.updateMany({ where: { id: { in: [s.aAsk.inboundMessageId, s.bAsk.inboundMessageId] } },
      data: { authorChannelIdentityId: null } })

    await erasePrincipal({ tenantId: tenant.id, personId: s.personB, reason: 'TEST_ERASURE' })

    expect(await body(s.bAsk.inboundMessageId)).toBe(CUSTOMER_ERASURE_TOMBSTONE)
    expect(await body(s.bReply)).toBe(CUSTOMER_ERASURE_TOMBSTONE)
    expect(await body(s.aAsk.inboundMessageId)).toBe('ซูริ A asks about order A-1')
    expect(await body(s.aReply)).toBe('Reply to A about order A-1')
  })

  // W10: an unverified sender's runtime-cohort job carries Core's CHANNEL_IDENTITY_ADMITTED
  // record; erasure empties it only for the erased speaker's own jobs.
  for (const erased of ['A', 'B']) {
    it(`erasing unverified speaker ${erased} empties only ${erased}'s identity-admission record`, async () => {
      const A = next('Usynthetic-erase-unv-a')
      const B = next('Usynthetic-erase-unv-b')
      const thread = next('Csynthetic-erase-unv-grp')
      const jobs = {
        A: await admit({ via: runtimeAccount, thread, speaker: A, text: 'ซูริ unverified A asks' }),
        B: await admit({ via: runtimeAccount, thread, speaker: B, text: 'ซูริ unverified B asks' }),
      }
      const record = async id => {
        const row = await job(id)
        return prisma.agentTraceEvent.findUnique({ where: { tenantId_businessId_idempotencyKey: {
          tenantId: row.tenantId, businessId: row.businessId, idempotencyKey: `${id}:identity-admission` } } })
      }
      for (const key of ['A', 'B']) {
        expect(await job(jobs[key].jobId)).toMatchObject({ runtimeOwner: 'CONVERSATION_RUNTIME', status: 'QUEUED' })
        expect((await record(jobs[key].jobId)).payloadJson).toContain('UNVERIFIED')
      }
      const kept = erased === 'A' ? 'B' : 'A'
      const keptBefore = { job: await job(jobs[kept].jobId), record: await record(jobs[kept].jobId) }

      await erasePrincipal({ tenantId: tenant.id, personId: await personOf(erased === 'A' ? A : B), reason: 'TEST_ERASURE' })

      await expectJobErased(jobs[erased].jobId)
      expect((await record(jobs[erased].jobId)).payloadJson).toBe('{"redacted":true}')
      expect(await runtimeSenderAuthority(prisma, await job(jobs[erased].jobId))).toMatchObject({ authorized: false })
      expect(await job(jobs[kept].jobId)).toEqual(keptBefore.job)
      expect(await record(jobs[kept].jobId)).toEqual(keptBefore.record)
      expect(await runtimeSenderAuthority(prisma, await job(jobs[kept].jobId)))
        .toMatchObject({ identityState: 'UNVERIFIED', authorized: true })
    })
  }

  it('is idempotent, including after a concurrent thread erasure already tombstoned a job', async () => {
    const s = await scene('group')
    // A concurrent erasure wins B's job first (the Studio's own thread writer).
    await prisma.$transaction(tx => redactLineConversationJobs(tx, { tenantId: tenant.id,
      speakers: [{ channelAccountId: account.bindingCode, providerSubject: s.B }] }))

    const first = await erasePrincipal({ tenantId: tenant.id, personId: s.personB, reason: 'TEST_ERASURE' })
    expect(await body(s.bLine.inboundMessageId)).toBe(CUSTOMER_ERASURE_TOMBSTONE)
    expect(first.redactedMessages).toBe(5)
    const snapshot = async () => ({
      jobs: await prisma.lineConversationJob.findMany({ where: { id: { in: [s.aAsk.jobId, s.bAsk.jobId, s.bDirect.jobId] } }, orderBy: { id: 'asc' } }),
      messages: await prisma.message.findMany({ where: { conversationId: { in: [s.groupConversationId, s.directConversationId] } }, orderBy: { id: 'asc' } }),
      raw: await prisma.rawExternalRecord.findMany({ where: { id: { in: [s.raw.a.id, s.raw.b.id] } }, orderBy: { id: 'asc' } }),
    })
    const before = await snapshot()

    const second = await erasePrincipal({ tenantId: tenant.id, personId: s.personB, reason: 'TEST_ERASURE' })

    expect(second).toMatchObject({ redactedMessages: 0, redactedLineJobs: 0, tombstonedRawRecords: 0, erasedCustomers: 0 })
    expect(await snapshot()).toEqual(before)
    for (const id of [s.bAsk.jobId, s.bDirect.jobId]) {
      await expectJobErased(id)
      const erasedAudits = await prisma.auditEvent.count({ where: { entityType: 'LINE_CONVERSATION_JOB', entityId: id, action: 'CONTENT_ERASED' } })
      expect(erasedAudits).toBe(1)
    }
    await expectTraceIntact(s.aAsk.jobId, 'A asks about order A-1')
  })
})
