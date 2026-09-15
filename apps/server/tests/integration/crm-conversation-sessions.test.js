import { beforeAll, describe, expect, it } from 'vitest'
import prisma from '@/lib/db'
import { createPortfolio, createTenant, createBusiness } from '../factories/scope'
import { registerIntegrationProvider, createIntegrationConnection, LINE_OA_PROVIDER_CODE } from '@/platform/integrations/core/integration-registry'
import { admitLineConversation } from '@/modules/line-oa-studio/application/line-conversation-jobs'
import { ingestLineMessage } from '@/modules/crm/line-ingest-service'
import { appendOutbound } from '@/modules/crm/reply-record-service'
import { backfillConversationSessions } from '@/modules/crm/conversation-session-backfill'

// @req FR-243 — conversation sessions end to end on the LINE admission path: a gap
//   past the account's idle timeout opens a new session, concurrent deliveries open
//   one, a reply joins the session of the message it answers, an event takes the
//   open session, and the backfill assigns existing rows by the same rule.
// @spec ADR-094 D1–D3, SDD-102
// @tested tests/integration/crm-conversation-sessions.test.js

const env = { ZURI_LINE_REPLY_SEAL_KEY: 'c4'.repeat(32) }
const base = Date.UTC(2026, 8, 15, 3, 0, 0)
const minute = (n) => base + n * 60_000
let tenant, business, provider, sequence = 0

async function makeAccount(over = {}) {
  const id = ++sequence
  const connection = await createIntegrationConnection({
    tenantId: tenant.id, businessId: business.id, providerId: provider.id,
    name: `Session connection ${id}`, externalAccountId: `session-oa-${id}`, status: 'ACTIVE',
  })
  return prisma.lineOaAccount.create({ data: {
    tenantId: tenant.id, businessId: business.id, integrationConnectionId: connection.id,
    code: `session-account-${id}`, displayName: `Session OA ${id}`, bindingCode: `session-binding-${id}`,
    transportMode: 'CLOUD', serverEnabled: true, status: 'CONNECTED', executionMode: 'SERVER',
    modelAccess: 'EXTERNAL_MODEL_ALLOWED', ...over,
  } })
}

const textEvent = (user, id, atMs, text = 'สวัสดีครับ') => ({
  type: 'message', webhookEventId: `session-event-${id}`, replyToken: `session-token-${id}`,
  timestamp: atMs, source: { type: 'user', userId: user },
  message: { id: `session-msg-${id}`, type: 'text', text },
})

// Admission clamps LINE's timestamp to its own clock, so "now" is always the later of the two.
const admit = (account, event) => admitLineConversation({
  account, event, correlationId: 'corr-sessions-01', env,
  now: new Date(event.timestamp + 1_000), ingressReceivedAt: new Date(event.timestamp + 1_000),
})

async function sessionOf(externalMessageId) {
  const message = await prisma.message.findFirst({ where: { externalMessageId }, include: { session: true } })
  return message.session
}

beforeAll(async () => {
  const portfolio = await createPortfolio({ name: 'Conversation sessions', code: 'PF-CONV-SESSIONS' })
  tenant = await createTenant({ portfolioId: portfolio.id, name: 'Sessions tenant', code: 'TNT-CONV-SESSIONS' })
  business = await createBusiness({ tenantId: tenant.id, name: 'Sessions business', code: 'BUS-CONV-SESSIONS' })
  provider = await registerIntegrationProvider({ code: LINE_OA_PROVIDER_CODE, name: 'LINE OA' })
})

describe('FR-243 session assignment on LINE admission', () => {
  it('keeps messages 29 minutes apart in one session and opens a new one past 30', async () => {
    const account = await makeAccount()
    await admit(account, textEvent('user-gap', 'gap-1', minute(0)))
    await admit(account, textEvent('user-gap', 'gap-2', minute(29)))
    await admit(account, textEvent('user-gap', 'gap-3', minute(60)))

    const first = await sessionOf('session-msg-gap-1')
    const second = await sessionOf('session-msg-gap-2')
    const third = await sessionOf('session-msg-gap-3')
    expect(second.id).toBe(first.id)
    expect(third.id).not.toBe(first.id)

    const closed = await prisma.conversationSession.findUnique({ where: { id: first.id } })
    expect(closed.inboundCount).toBe(2)
    expect(closed.closedAt.toISOString()).toBe(new Date(minute(59)).toISOString())
    expect(third.closedAt).toBeNull()
    expect(third.code).toMatch(/^S-20260915-[0-9A-Z]{6}$/)
    expect(third).toMatchObject({ tenantId: tenant.id, businessId: business.id, idleTimeoutMinutes: 30, inboundCount: 1 })
  })

  it('uses the account timeout, so a 60-minute account keeps a 45-minute gap in one session', async () => {
    const account = await makeAccount({ sessionIdleTimeoutMinutes: 60 })
    await admit(account, textEvent('user-long', 'long-1', minute(0)))
    await admit(account, textEvent('user-long', 'long-2', minute(45)))
    expect((await sessionOf('session-msg-long-2')).id).toBe((await sessionOf('session-msg-long-1')).id)
  })

  it('decides by LINE\'s timestamp, not by when the webhook was processed', async () => {
    const account = await makeAccount()
    await admit(account, textEvent('user-late', 'late-1', minute(0)))
    // Delivered 40 minutes late, but LINE says it was sent 10 minutes after the first.
    await admitLineConversation({
      account, event: textEvent('user-late', 'late-2', minute(10)), correlationId: 'corr-sessions-02', env,
      now: new Date(minute(50)), ingressReceivedAt: new Date(minute(50)),
    })
    expect((await sessionOf('session-msg-late-2')).id).toBe((await sessionOf('session-msg-late-1')).id)
  })

  it('opens exactly one session when two deliveries for the same conversation land together after a gap', async () => {
    const account = await makeAccount()
    const channelAccountId = account.bindingCode
    const ingest = (id, atMs) => ingestLineMessage({
      tenantId: tenant.id, businessId: business.id, channelAccountId, lineUserId: 'user-race', threadId: 'user-race',
      text: 'race', externalMessageId: `race-${id}`, occurredAt: new Date(atMs),
    })
    await ingest('0', minute(0))
    await Promise.all([ingest('1', minute(90)), ingest('2', minute(90))])

    const conversation = await prisma.conversation.findFirst({ where: { channelAccountId, externalThreadId: 'user-race' } })
    const sessions = await prisma.conversationSession.findMany({ where: { conversationId: conversation.id } })
    expect(sessions).toHaveLength(2)
    const late = await prisma.message.findMany({ where: { externalMessageId: { in: ['race-1', 'race-2'] } } })
    expect(new Set(late.map((m) => m.sessionId)).size).toBe(1)
  })

  it('records a reply hours later in the session of the message it answers, without opening one', async () => {
    const account = await makeAccount()
    await admit(account, textEvent('user-reply', 'reply-1', minute(0)))
    const inbound = await prisma.message.findFirst({ where: { externalMessageId: 'session-msg-reply-1' } })
    await admit(account, textEvent('user-reply', 'reply-2', minute(200)))

    await appendOutbound({
      tenantId: tenant.id, businessId: business.id, channelAccountId: account.bindingCode,
      receipt: { inboundMessageId: inbound.id, text: 'ขอบคุณครับ', source: 'STACK' },
      acceptedAt: new Date(minute(240)).toISOString(), correlationId: 'corr-sessions-03',
    })
    const reply = await prisma.message.findFirst({ where: { externalMessageId: `reply:${inbound.id}` } })
    expect(reply.sessionId).toBe(inbound.sessionId)
    const answered = await prisma.conversationSession.findUnique({ where: { id: inbound.sessionId } })
    expect(answered.outboundCount).toBe(1)
    // Already closed by the 200-minute session, so the late reply does not stretch it.
    expect(answered.lastMessageAt.toISOString()).toBe(new Date(minute(0)).toISOString())
    const conversation = await prisma.conversation.findUnique({ where: { id: inbound.conversationId }, include: { sessions: true } })
    expect(conversation.sessions).toHaveLength(2)
  })

  it('gives an event the session open when it occurred, and none after the timeout', async () => {
    const account = await makeAccount()
    await admit(account, textEvent('user-event', 'event-1', minute(0)))
    const open = { type: 'postback', webhookEventId: 'session-postback-open', timestamp: minute(5), source: { type: 'user', userId: 'user-event' }, postback: { data: 'x' } }
    const later = { type: 'postback', webhookEventId: 'session-postback-late', timestamp: minute(80), source: { type: 'user', userId: 'user-event' }, postback: { data: 'y' } }
    await admitLineConversation({ account, event: open, correlationId: 'corr-sessions-04', env })
    await admitLineConversation({ account, event: later, correlationId: 'corr-sessions-05', env })

    const inbound = await prisma.message.findFirst({ where: { externalMessageId: 'session-msg-event-1' } })
    const events = await prisma.conversationEvent.findMany({ where: { conversationId: inbound.conversationId }, orderBy: { occurredAt: 'asc' } })
    expect(events.map((e) => e.sessionId)).toEqual([inbound.sessionId, null])
  })
})

describe('FR-243 backfill of existing rows', () => {
  it('assigns sessions by the same rule, reuses a live session, and finds nothing on a second run', async () => {
    const account = await makeAccount()
    const customer = await prisma.customer.findFirst({ where: { tenantId: tenant.id } })
    const conversation = await prisma.conversation.create({ data: {
      tenantId: tenant.id, businessId: business.id, customerId: customer.id, channel: 'LINE',
      channelAccountId: account.bindingCode, externalThreadId: 'user-backfill',
    } })
    const make = (id, atMin, direction = 'INBOUND', externalMessageId = `bf-${id}`) => prisma.message.create({ data: {
      id: `bf-message-${id}`, conversationId: conversation.id, direction, body: id, externalMessageId, createdAt: new Date(minute(atMin)),
    } })
    await make('1', 0)
    await make('2', 1, 'OUTBOUND', 'reply:bf-message-1')
    await make('3', 20)
    await make('4', 100)
    await prisma.conversationEvent.create({ data: {
      conversationId: conversation.id, kind: 'FOLLOW', externalEventId: 'bf-follow', occurredAt: new Date(minute(10)),
    } })
    // A LINE job admitted before the job column existed reads as no session (TASK-ZAI-107).
    await prisma.lineConversationJob.create({ data: {
      accountId: account.id, inboundMessageId: 'bf-message-1', eventId: 'bf-job-event', tenantId: tenant.id,
      businessId: business.id, channelAccountId: account.bindingCode, transportEpoch: account.transportEpoch,
      executionMode: 'SERVER', modelAccess: 'EXTERNAL_MODEL_ALLOWED', recipientId: 'user-backfill', sourceUserId: 'user-backfill',
      status: 'RECORDED', expiresAt: new Date(minute(60)), correlationId: 'corr-backfill-job',
    } })
    // A message admitted live after the migration already holds a session.
    const live = await ingestLineMessage({
      tenantId: tenant.id, businessId: business.id, channelAccountId: account.bindingCode, lineUserId: 'user-backfill',
      threadId: 'user-backfill', text: 'live', externalMessageId: 'bf-live', occurredAt: new Date(minute(110)),
    })

    const dry = await backfillConversationSessions({ tenantId: tenant.id })
    expect(dry.apply).toBe(false)
    expect(await prisma.message.count({ where: { conversationId: conversation.id, sessionId: null } })).toBe(4)

    const applied = await backfillConversationSessions({ tenantId: tenant.id, apply: true })
    expect(applied.apply).toBe(true)
    const rows = await prisma.message.findMany({ where: { conversationId: conversation.id }, orderBy: { createdAt: 'asc' } })
    expect(rows.every((row) => row.sessionId)).toBe(true)
    expect(rows[0].sessionId).toBe(rows[1].sessionId)
    expect(rows[1].sessionId).toBe(rows[2].sessionId)
    expect(rows[3].sessionId).toBe(live.sessionId)
    expect(rows[4].sessionId).toBe(live.sessionId)

    const first = await prisma.conversationSession.findUnique({ where: { id: rows[0].sessionId } })
    expect(first).toMatchObject({ inboundCount: 2, outboundCount: 1 })
    expect(first.closedAt.toISOString()).toBe(new Date(minute(50)).toISOString())
    const liveSession = await prisma.conversationSession.findUnique({ where: { id: live.sessionId } })
    expect(liveSession.openedAt.toISOString()).toBe(new Date(minute(100)).toISOString())
    expect(liveSession.inboundCount).toBe(2)

    const follow = await prisma.conversationEvent.findFirst({ where: { externalEventId: 'bf-follow' } })
    expect(follow.sessionId).toBe(rows[0].sessionId)
    const job = await prisma.lineConversationJob.findFirst({ where: { eventId: 'bf-job-event' } })
    expect(job.sessionId).toBe(rows[0].sessionId)

    const again = await backfillConversationSessions({ tenantId: tenant.id, apply: true })
    expect(again.messagesToAssign).toBe(0)
    expect(again.jobsToAssign).toBe(0)
  })
})
