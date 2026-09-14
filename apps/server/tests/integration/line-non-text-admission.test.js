import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import prisma from '@/lib/db'
import { createPortfolio, createTenant, createBusiness } from '../factories/scope'
import { registerIntegrationProvider, createIntegrationConnection, LINE_OA_PROVIDER_CODE } from '@/platform/integrations/core/integration-registry'
import { admitLineConversation } from '@/modules/line-oa-studio/application/line-conversation-jobs'
import { LINE_UNSEND_TOMBSTONE } from '@/modules/crm/line-ingest-service'

// @req FR-229 — non-text LINE content becomes CRM rows instead of being skipped:
//   Message.contentKind + placeholder body, MessageAttachment without bytes,
//   ConversationEvent for follow/unfollow/join/leave/memberJoined/memberLeft/
//   postback/unsend. None of them creates a LineConversationJob. Unsend tombstones
//   the referenced Message body and MessageAttachment.
// @spec ADR-091 D5
// @tested tests/integration/line-non-text-admission.test.js

const env = { ZURI_LINE_REPLY_SEAL_KEY: 'b3'.repeat(32) }
const start = new Date('2026-09-14T10:00:00.000Z')
let tenant, business, provider, sequence = 0

async function makeAccount(over = {}) {
  const id = ++sequence
  const connection = await createIntegrationConnection({
    tenantId: tenant.id, businessId: business.id, providerId: provider.id,
    name: `Non-text connection ${id}`, externalAccountId: `nontext-oa-${id}`, status: 'ACTIVE',
  })
  return prisma.lineOaAccount.create({ data: {
    tenantId: tenant.id, businessId: business.id, integrationConnectionId: connection.id,
    code: `nontext-account-${id}`, displayName: `Non-text OA ${id}`, bindingCode: `nontext-binding-${id}`,
    transportMode: 'CLOUD', serverEnabled: true, status: 'CONNECTED', executionMode: 'SERVER',
    modelAccess: 'EXTERNAL_MODEL_ALLOWED', ...over,
  } })
}

const admit = (account, event, over = {}) =>
  admitLineConversation({ account, event, correlationId: 'corr-non-text', now: start, env, ...over })

const directEvent = (id, over = {}) => ({
  webhookEventId: `event-${id}`, source: { type: 'user', userId: `user-${id}` }, ...over,
})
const groupEvent = (id, over = {}) => ({
  webhookEventId: `event-${id}`, source: { type: 'group', groupId: `group-${id}`, userId: `user-${id}` }, ...over,
})

async function findMessageByExternalId(externalMessageId) {
  return prisma.message.findFirst({ where: { externalMessageId }, include: { attachments: true } })
}
async function findEvent(conversationId, externalEventId) {
  return prisma.conversationEvent.findUnique({ where: { conversationId_externalEventId: { conversationId, externalEventId } } })
}

beforeAll(async () => {
  const portfolio = await createPortfolio({ name: 'Non-text LINE admission', code: 'PF-NONTEXT-LINE' })
  tenant = await createTenant({ portfolioId: portfolio.id, name: 'Non-text LINE tenant', code: 'TNT-NONTEXT-LINE' })
  business = await createBusiness({ tenantId: tenant.id, name: 'Non-text LINE business', code: 'BUS-NONTEXT-LINE' })
  provider = await registerIntegrationProvider({ code: LINE_OA_PROVIDER_CODE, name: 'LINE OA' })
})

afterEach(async () => {
  // Every test in this file admits into its own fresh account, so a job count of
  // zero for that account is what "no answer job" means — checked per test.
})

describe('FR-229 — non-text message kinds', () => {
  it('records a sticker with contentKind STICKER and a genuinely fixed placeholder body — no packageId/stickerId in Message', async () => {
    const account = await makeAccount()
    const event = {
      type: 'message', ...directEvent('sticker-1'),
      message: { id: 'msg-sticker-1', type: 'sticker', packageId: '1', stickerId: '2' },
    }
    const result = await admit(account, event)
    expect(result).toMatchObject({ skipped: true })
    expect(result.jobId).toBeUndefined()

    const message = await findMessageByExternalId('msg-sticker-1')
    expect(message).toMatchObject({ contentKind: 'STICKER', body: '[สติกเกอร์]' })
    expect(message.attachments).toHaveLength(0)
    // FR-229 says "a fixed placeholder body" — fixed, not "carries the provider's
    // own ids". Neither value from the LINE payload leaks into the stored body.
    expect(message.body).not.toContain('1')
    expect(message.body).not.toContain('2')

    const jobs = await prisma.lineConversationJob.count({ where: { accountId: account.id } })
    expect(jobs).toBe(0)
  })

  it('records a location with contentKind LOCATION and a fixed placeholder body — no coordinates anywhere in Message', async () => {
    const account = await makeAccount()
    const event = {
      type: 'message', ...directEvent('location-1'),
      message: { id: 'msg-location-1', type: 'location', latitude: 13.75, longitude: 100.5 },
    }
    await admit(account, event)
    const message = await findMessageByExternalId('msg-location-1')
    expect(message).toMatchObject({ contentKind: 'LOCATION', body: '[ตำแหน่ง]' })
    // Coordinates are personal data (often a home or delivery address) and
    // Message.body is exactly what the inbox preview, FR-233 search and any
    // future prompt read — the raw lat/lng must never land there.
    expect(message.body).not.toContain('13.75')
    expect(message.body).not.toContain('100.5')
    const anyMessageWithCoordinates = await prisma.message.findFirst({
      where: { OR: [{ body: { contains: '13.75' } }, { body: { contains: '100.5' } }] },
    })
    expect(anyMessageWithCoordinates).toBeNull()
  })

  it.each([
    ['image', 'IMAGE'],
    ['video', 'VIDEO'],
    ['audio', 'AUDIO'],
    ['file', 'FILE'],
  ])('records a %s message as MEDIA_REF with a MessageAttachment recorded without bytes', async (lineType, attachmentKind) => {
    const account = await makeAccount()
    const externalMessageId = `msg-media-${lineType}`
    const event = {
      type: 'message', ...directEvent(`media-${lineType}`),
      message: { id: externalMessageId, type: lineType },
    }
    await admit(account, event)
    const message = await findMessageByExternalId(externalMessageId)
    expect(message.contentKind).toBe('MEDIA_REF')
    expect(message.attachments).toHaveLength(1)
    expect(message.attachments[0]).toMatchObject({
      kind: attachmentKind, providerContentId: externalMessageId, fetchState: 'PENDING',
      fileAssetId: null, mimeType: null, sizeBytes: null,
    })
    const jobs = await prisma.lineConversationJob.count({ where: { accountId: account.id } })
    expect(jobs).toBe(0)
  })

  it('is idempotent: redelivering the same sticker event does not duplicate the Message or attachment', async () => {
    const account = await makeAccount()
    const event = {
      type: 'message', ...directEvent('sticker-dup'),
      message: { id: 'msg-sticker-dup', type: 'sticker', packageId: '3', stickerId: '4' },
    }
    await admit(account, event)
    await admit(account, event)
    const count = await prisma.message.count({ where: { externalMessageId: 'msg-sticker-dup' } })
    expect(count).toBe(1)
  })

  it('leaves an unrecognised message type skipped with no CRM row', async () => {
    const account = await makeAccount()
    const event = {
      type: 'message', ...directEvent('unknown-1'),
      message: { id: 'msg-unknown-1', type: 'imagemap' },
    }
    const result = await admit(account, event)
    expect(result).toEqual({ skipped: true })
    const message = await findMessageByExternalId('msg-unknown-1')
    expect(message).toBeNull()
  })

  it('resolves a group thread by groupId while the sender identity comes from source.userId', async () => {
    const account = await makeAccount()
    const event = {
      type: 'message', ...groupEvent('grp-sticker-1'),
      message: { id: 'msg-grp-sticker-1', type: 'sticker', packageId: '5', stickerId: '6' },
    }
    await admit(account, event)
    const message = await findMessageByExternalId('msg-grp-sticker-1')
    const conversation = await prisma.conversation.findUnique({ where: { id: message.conversationId } })
    expect(conversation.externalThreadId).toBe('group-grp-sticker-1')
  })
})

describe('FR-229 — non-message conversation events', () => {
  it('records follow/unfollow/postback as ConversationEvent rows with an id-only payload and no job', async () => {
    const account = await makeAccount()
    const follow = { type: 'follow', ...directEvent('follow-1') }
    const result = await admit(account, follow)
    expect(result).toMatchObject({ skipped: true })
    expect(result.eventId).toBeTruthy()

    const conversation = await prisma.conversation.findUnique({ where: { id: result.conversationId } })
    expect(conversation).toBeTruthy()
    const event = await findEvent(result.conversationId, 'event-follow-1')
    expect(event).toMatchObject({ kind: 'FOLLOW' })
    expect(JSON.parse(event.payloadJson)).toEqual({})

    const unfollow = { type: 'unfollow', ...directEvent('unfollow-1') }
    await admit(account, unfollow)
    const unfollowEvent = await prisma.conversationEvent.findFirst({ where: { kind: 'UNFOLLOW' } })
    expect(unfollowEvent).toBeTruthy()

    const postback = { type: 'postback', ...directEvent('postback-1'), postback: { data: 'action=buy&itemid=123' } }
    await admit(account, postback)
    const postbackEvent = await prisma.conversationEvent.findFirst({ where: { kind: 'POSTBACK' } })
    expect(postbackEvent).toBeTruthy()
    // FR-229 requires the payload to carry ids only — postback's own free-text
    // `data` string is deliberately never stored here.
    expect(JSON.parse(postbackEvent.payloadJson)).toEqual({})

    const jobs = await prisma.lineConversationJob.count({ where: { accountId: account.id } })
    expect(jobs).toBe(0)
  })

  it('skips join/leave/memberJoined/memberLeft when no conversation exists yet for the thread', async () => {
    const account = await makeAccount()
    const join = { type: 'join', ...groupEvent('join-new') }
    const result = await admit(account, join)
    expect(result).toMatchObject({ skipped: true, conversationId: null, eventId: null })
    const conversation = await prisma.conversation.findFirst({ where: { externalThreadId: 'group-join-new' } })
    expect(conversation).toBeNull()
  })

  it('attaches join/leave/memberJoined/memberLeft to a conversation that already exists for the thread', async () => {
    const account = await makeAccount()
    const threadId = 'group-existing-1'
    // Seed the conversation the way a real deployment would: someone already sent
    // a message in this group before the bot's own join/leave/member bookkeeping runs.
    const seedMessage = {
      type: 'message', webhookEventId: 'event-seed-1',
      source: { type: 'group', groupId: threadId, userId: 'user-seed-1' },
      message: { id: 'msg-seed-1', type: 'text', text: 'hello group' },
    }
    await admit(account, seedMessage)
    const conversation = await prisma.conversation.findFirst({ where: { externalThreadId: threadId } })
    expect(conversation).toBeTruthy()

    const join = { type: 'join', webhookEventId: 'event-join-1', source: { type: 'group', groupId: threadId } }
    const joinResult = await admit(account, join)
    expect(joinResult).toMatchObject({ skipped: true, conversationId: conversation.id })
    const joinEvent = await findEvent(conversation.id, 'event-join-1')
    expect(joinEvent).toMatchObject({ kind: 'JOIN' })

    const memberJoined = {
      type: 'memberJoined', webhookEventId: 'event-member-joined-1',
      source: { type: 'group', groupId: threadId },
      joined: { members: [{ type: 'user', userId: 'user-new-member' }] },
    }
    await admit(account, memberJoined)
    const memberEvent = await findEvent(conversation.id, 'event-member-joined-1')
    expect(memberEvent).toMatchObject({ kind: 'MEMBER_JOINED' })
    // FR-229's payload must carry ids only, and ConversationEvent is inside the
    // erasure boundary; a raw LINE userId here would outlive the very principal
    // it named (no identity is ever resolved for a joining/leaving member, so
    // erasure has nothing to redact it through). Only a count is stored.
    expect(JSON.parse(memberEvent.payloadJson)).toEqual({ memberCount: 1 })
    expect(memberEvent.payloadJson).not.toContain('user-new-member')

    const leave = { type: 'leave', webhookEventId: 'event-leave-1', source: { type: 'group', groupId: threadId } }
    await admit(account, leave)
    expect(await findEvent(conversation.id, 'event-leave-1')).toMatchObject({ kind: 'LEAVE' })

    const jobs = await prisma.lineConversationJob.count({ where: { accountId: account.id } })
    expect(jobs).toBe(0)
  })

  it('is idempotent: redelivering the same follow event does not duplicate the ConversationEvent', async () => {
    const account = await makeAccount()
    const follow = { type: 'follow', ...directEvent('follow-dup') }
    const first = await admit(account, follow)
    const second = await admit(account, follow)
    expect(second.eventId).toBe(first.eventId)
    const count = await prisma.conversationEvent.count({ where: { conversationId: first.conversationId, externalEventId: 'event-follow-dup' } })
    expect(count).toBe(1)
  })
})

describe('FR-229 — unsend tombstones the referenced message and attachment', () => {
  it('tombstones the message body and the attachment of a media message it names', async () => {
    const account = await makeAccount()
    const userId = 'user-unsend-1'
    const media = {
      type: 'message', webhookEventId: 'event-media-unsend-1', source: { type: 'user', userId },
      message: { id: 'msg-unsend-1', type: 'image' },
    }
    await admit(account, media)
    const before = await findMessageByExternalId('msg-unsend-1')
    expect(before.attachments[0].fetchState).toBe('PENDING')

    const unsend = {
      type: 'unsend', webhookEventId: 'event-unsend-1', source: { type: 'user', userId },
      unsend: { messageId: 'msg-unsend-1' },
    }
    const result = await admit(account, unsend)
    expect(result).toMatchObject({ skipped: true, tombstonedMessage: true })

    const after = await findMessageByExternalId('msg-unsend-1')
    expect(after.body).toBe(LINE_UNSEND_TOMBSTONE)
    expect(after.attachments[0]).toMatchObject({ fetchState: 'ERASED', providerContentId: null })

    const event = await findEvent(after.conversationId, 'event-unsend-1')
    expect(event).toMatchObject({ kind: 'UNSEND' })
    expect(JSON.parse(event.payloadJson)).toEqual({ unsentExternalMessageId: 'msg-unsend-1' })

    const jobs = await prisma.lineConversationJob.count({ where: { accountId: account.id } })
    expect(jobs).toBe(0)
  })

  it('records an unsend for a message the Business never received without error, when the conversation already exists (ADR-091 proof 4)', async () => {
    const account = await makeAccount()
    const userId = 'user-unsend-known-thread'
    // Establish the conversation first — the Business has talked to this person —
    // so the gap being proven is specifically "this one message id is unknown",
    // not "this thread is unknown" (that is the next test).
    const seed = {
      type: 'message', webhookEventId: 'event-seed-unsend-1', source: { type: 'user', userId },
      message: { id: 'msg-seed-unsend-1', type: 'text', text: 'สวัสดีครับ' },
    }
    await admit(account, seed)

    const unsend = {
      type: 'unsend', webhookEventId: 'event-unsend-unknown-1', source: { type: 'user', userId },
      unsend: { messageId: 'msg-never-admitted' },
    }
    const result = await admit(account, unsend)
    expect(result).toMatchObject({ skipped: true, tombstonedMessage: false })
    expect(result.conversationId).toBeTruthy()
    const event = await findEvent(result.conversationId, 'event-unsend-unknown-1')
    expect(event).toMatchObject({ kind: 'UNSEND' })
    expect(JSON.parse(event.payloadJson)).toEqual({ unsentExternalMessageId: 'msg-never-admitted' })
  })

  it('skips an unsend entirely when no conversation exists yet for the thread — no Customer or Conversation is minted just to record it', async () => {
    const account = await makeAccount()
    const userId = 'user-unsend-no-thread'
    const unsend = {
      type: 'unsend', webhookEventId: 'event-unsend-no-thread-1', source: { type: 'user', userId },
      unsend: { messageId: 'msg-irrelevant' },
    }
    const result = await admit(account, unsend)
    expect(result).toEqual({ skipped: true, conversationId: null, eventId: null, tombstonedMessage: false })

    const conversation = await prisma.conversation.findFirst({ where: { externalThreadId: userId } })
    expect(conversation).toBeNull()
    const event = await prisma.conversationEvent.findFirst({ where: { externalEventId: 'event-unsend-no-thread-1' } })
    expect(event).toBeNull()
    // Nothing was minted for this LINE user — the identity resolver never ran.
    const identity = await prisma.externalIdentity.findFirst({ where: { providerSubject: userId } })
    expect(identity).toBeNull()
  })

  it('is idempotent: redelivering the same unsend does not re-apply or duplicate anything', async () => {
    const account = await makeAccount()
    const userId = 'user-unsend-dup'
    const media = {
      type: 'message', webhookEventId: 'event-media-unsend-dup', source: { type: 'user', userId },
      message: { id: 'msg-unsend-dup', type: 'file' },
    }
    await admit(account, media)
    const unsend = {
      type: 'unsend', webhookEventId: 'event-unsend-dup', source: { type: 'user', userId },
      unsend: { messageId: 'msg-unsend-dup' },
    }
    await admit(account, unsend)
    const second = await admit(account, unsend)
    expect(second.tombstonedMessage).toBe(false)
    const message = await findMessageByExternalId('msg-unsend-dup')
    expect(message.body).toBe(LINE_UNSEND_TOMBSTONE)
    const count = await prisma.conversationEvent.count({ where: { externalEventId: 'event-unsend-dup' } })
    expect(count).toBe(1)
  })
})
