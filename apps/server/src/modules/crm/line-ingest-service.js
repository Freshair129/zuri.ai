import prisma from '@/lib/db'
import { uniqueHumanCode } from '@/lib/ids'
import { recordAudit } from '@/modules/project-manager/application/audit'
import { resolveLineIdentity } from '@/modules/identity/resolve-line-identity'
import { LEGACY_CHANNEL_ACCOUNT_ID } from '@/modules/identity/channel-identity'
import {
  zIngestLineMessageInput,
  zIngestLineConversationEventInput,
  zRecordExistingConversationEventInput,
  zIngestLineUnsendEventInput,
} from '@/lib/validation/entities'
import { refreshConversationPreview } from './conversation-preview-service'
import { assignMessageSession, openSessionIdAt } from './conversation-session-service'

// @req FR-023 — inbound LINE identity, customer, conversation and message are atomic.
// @req FR-097 — trusted channel account is carried into identity discovery.
// @req FR-148 — account-scoped threads, business isolation and transaction composition.
// @req FR-229 — non-text LINE content: contentKind/attachment on ingestLineMessage,
//   plus three narrow writers for non-message events (ADR-091 D5).
// @req FR-243 — every Message written here is assigned its session inside the same
//   transaction, and every ConversationEvent takes the session open when it occurred
//   (ADR-094 D2, SDD-102).
// @req FR-233 — every write here that touches Message content refreshes
//   Conversation.lastMessageAt/lastMessagePreview (conversation-preview-service.js).
// @spec ADR-061, ADR-044, ADR-045, BR-001, BR-002, SEC-001, SEC-018
// @tested tests/integration/line-ingest.test.js, tests/integration/line-account-isolation.test.js,
//   tests/integration/line-non-text-admission.test.js, tests/integration/crm-conversation-inbox.test.js,
//   tests/integration/crm-conversation-sessions.test.js

const CHANNEL = 'LINE'
const conversationKey = (tenantId, channelAccountId, threadId) => ({
  tenantId_channel_channelAccountId_externalThreadId: {
    tenantId, channel: CHANNEL, channelAccountId, externalThreadId: threadId,
  },
})

function failure(status, message) {
  return Object.assign(new Error(message), { status })
}

/**
 * Ingest once inside the caller's transaction. A duplicate returns created.message
 * false: callers must reuse their queued result, never invoke a second model turn.
 * Known accounts require Business scope; legacy direct callers may omit it.
 *
 * With a transaction client, unique/serialization failures propagate: its owner
 * must retry the ENTIRE transaction (including its enqueue), never an aborted tx.
 */
export async function ingestLineMessage(input, { db = prisma } = {}) {
  const data = zIngestLineMessageInput.parse(input)
  if (typeof db.$transaction === 'function') {
    for (let attempt = 0; ; attempt += 1) {
      try {
        return await db.$transaction((tx) => ingestLineMessage(data, { db: tx }))
      } catch (error) {
        if (attempt >= 2 || !['P2002', 'P2034'].includes(error?.code)) throw error
      }
    }
  }

  const { tenantId, businessId, lineUserId, displayName, threadId, text, externalMessageId, direction, correlationId, contentKind, attachment, occurredAt, sessionIdleTimeoutMinutes } = data
  const channelAccountId = data.channelAccountId?.trim() || LEGACY_CHANNEL_ACCOUNT_ID
  if (channelAccountId !== LEGACY_CHANNEL_ACCOUNT_ID && !businessId) throw failure(400, 'BUSINESS_REQUIRED_FOR_CHANNEL_ACCOUNT')
  if (businessId) {
    const business = await db.business.findFirst({ where: { id: businessId, tenantId }, select: { id: true } })
    if (!business) throw failure(404, 'BUSINESS_NOT_FOUND')
  }

  let conversation = await db.conversation.findUnique({ where: conversationKey(tenantId, channelAccountId, threadId) })
  // A binding change is not permission to move an existing conversation. Check this
  // even for a duplicate, before returning any row identifiers to the caller.
  if (conversation && businessId !== undefined && conversation.businessId !== businessId) {
    throw failure(409, 'CONVERSATION_BUSINESS_SCOPE_CONFLICT')
  }

  const identity = await resolveLineIdentity({ tenantId, lineUserId, channelAccountId, displayName }, { db })
  if (externalMessageId && conversation) {
    const duplicate = await db.message.findUnique({
      where: { conversationId_externalMessageId: { conversationId: conversation.id, externalMessageId } },
    })
    if (duplicate) {
      return {
        personId: identity.personId, customerId: conversation.customerId,
        conversationId: conversation.id, messageId: duplicate.id, sessionId: duplicate.sessionId ?? null,
        created: { customer: false, conversation: false, message: false },
      }
    }
  }

  let customer = await db.customer.findUnique({ where: { tenantId_personId: { tenantId, personId: identity.personId } } })
  const createdCustomer = !customer
  if (!customer) {
    const code = await uniqueHumanCode('CUS', displayName || lineUserId,
      async (candidate) => Boolean(await db.customer.findUnique({ where: { code: candidate } })))
    customer = await db.customer.create({
      data: { code, tenantId, businessId: businessId ?? null, personId: identity.personId, displayName: displayName || 'LINE customer' },
    })
  }

  const createdConversation = !conversation
  if (!conversation) {
    conversation = await db.conversation.create({
      data: { tenantId, businessId: businessId ?? null, customerId: customer.id, channel: CHANNEL, channelAccountId, externalThreadId: threadId },
    })
  }
  // @req FR-243 — decided before the message exists, under the Conversation row lock
  //   the assignment itself takes, so concurrent deliveries open one session.
  const { session } = await assignMessageSession(db, {
    conversation, occurredAt: occurredAt ?? new Date(), direction, idleTimeoutMinutes: sessionIdleTimeoutMinutes,
  })
  const message = await db.message.create({
    data: { conversationId: conversation.id, direction, body: text, externalMessageId: externalMessageId ?? null,
      contentKind: contentKind ?? 'TEXT', sessionId: session.id },
  })
  // FR-229 — a media message also gets a MessageAttachment recorded without bytes.
  // Created in the same transaction as the message it belongs to, so a redelivery
  // that short-circuits on the duplicate-message check above never reaches here a
  // second time either.
  let attachment_ = null
  if (attachment) {
    attachment_ = await db.messageAttachment.create({
      data: { messageId: message.id, kind: attachment.kind, providerContentId: attachment.providerContentId, fetchState: 'PENDING' },
    })
  }
  // @req FR-233 — the inbox's last-message-at/preview columns follow every new
  //   message, inbound or outbound (reply-record-service.js does the same).
  await refreshConversationPreview(db, conversation.id)
  await recordAudit(db, {
    entityType: 'CONVERSATION', entityId: conversation.id, action: 'MESSAGE_INGESTED', actorType: 'LINE',
    // @spec NFR-017 — durable correlation without duplicating message content.
    payload: {
      tenantId, businessId: conversation.businessId, channelAccountId,
      customerId: customer.id, direction, messageId: message.id, contentKind: contentKind ?? 'TEXT',
      ...(correlationId ? { correlationId } : {}),
    },
  })
  return {
    personId: identity.personId, customerId: customer.id,
    conversationId: conversation.id, messageId: message.id, attachmentId: attachment_?.id ?? null, sessionId: session.id,
    created: { customer: createdCustomer, conversation: createdConversation, message: true },
  }
}

/**
 * FR-229 — record a follow, unfollow, postback or unsend as a ConversationEvent,
 * resolving identity → customer → conversation exactly as an inbound message would
 * (these event kinds all carry `event.source.userId`, per line-conversation-jobs.js's
 * caller). Idempotent per (conversationId, externalEventId): a redelivered event
 * neither duplicates the row nor re-creates the customer/conversation.
 */
export async function ingestLineConversationEvent(input, { db = prisma } = {}) {
  const data = zIngestLineConversationEventInput.parse(input)
  if (typeof db.$transaction === 'function') {
    for (let attempt = 0; ; attempt += 1) {
      try {
        return await db.$transaction((tx) => ingestLineConversationEvent(data, { db: tx }))
      } catch (error) {
        if (attempt >= 2 || !['P2002', 'P2034'].includes(error?.code)) throw error
      }
    }
  }

  const { tenantId, businessId, lineUserId, displayName, threadId, kind, externalEventId, payload, occurredAt, correlationId, sessionIdleTimeoutMinutes } = data
  const channelAccountId = data.channelAccountId?.trim() || LEGACY_CHANNEL_ACCOUNT_ID
  if (channelAccountId !== LEGACY_CHANNEL_ACCOUNT_ID && !businessId) throw failure(400, 'BUSINESS_REQUIRED_FOR_CHANNEL_ACCOUNT')
  if (businessId) {
    const business = await db.business.findFirst({ where: { id: businessId, tenantId }, select: { id: true } })
    if (!business) throw failure(404, 'BUSINESS_NOT_FOUND')
  }

  let conversation = await db.conversation.findUnique({ where: conversationKey(tenantId, channelAccountId, threadId) })
  if (conversation && businessId !== undefined && conversation.businessId !== businessId) {
    throw failure(409, 'CONVERSATION_BUSINESS_SCOPE_CONFLICT')
  }

  const identity = await resolveLineIdentity({ tenantId, lineUserId, channelAccountId, displayName }, { db })

  let customer = await db.customer.findUnique({ where: { tenantId_personId: { tenantId, personId: identity.personId } } })
  const createdCustomer = !customer
  if (!customer) {
    const code = await uniqueHumanCode('CUS', displayName || lineUserId,
      async (candidate) => Boolean(await db.customer.findUnique({ where: { code: candidate } })))
    customer = await db.customer.create({
      data: { code, tenantId, businessId: businessId ?? null, personId: identity.personId, displayName: displayName || 'LINE customer' },
    })
  }

  const createdConversation = !conversation
  if (!conversation) {
    conversation = await db.conversation.create({
      data: { tenantId, businessId: businessId ?? null, customerId: customer.id, channel: CHANNEL, channelAccountId, externalThreadId: threadId },
    })
  }

  const existingEvent = await db.conversationEvent.findUnique({
    where: { conversationId_externalEventId: { conversationId: conversation.id, externalEventId } },
  })
  if (existingEvent) {
    return {
      personId: identity.personId, customerId: customer.id, conversationId: conversation.id, eventId: existingEvent.id,
      created: { customer: false, conversation: false, event: false },
    }
  }

  const eventAt = occurredAt ?? new Date()
  const sessionId = await openSessionIdAt(db, { conversationId: conversation.id, occurredAt: eventAt, idleTimeoutMinutes: sessionIdleTimeoutMinutes })
  const event = await db.conversationEvent.create({
    data: { conversationId: conversation.id, kind, externalEventId,
      payloadJson: JSON.stringify(payload ?? {}), occurredAt: eventAt, sessionId },
  })
  await db.conversation.update({ where: { id: conversation.id }, data: { updatedAt: new Date() } })
  await recordAudit(db, {
    entityType: 'CONVERSATION', entityId: conversation.id, action: 'CONVERSATION_EVENT_RECORDED', actorType: 'LINE',
    payload: {
      tenantId, businessId: conversation.businessId, channelAccountId, customerId: customer.id, kind, eventId: event.id,
      ...(correlationId ? { correlationId } : {}),
    },
  })

  return {
    personId: identity.personId, customerId: customer.id, conversationId: conversation.id, eventId: event.id,
    created: { customer: createdCustomer, conversation: createdConversation, event: true },
  }
}

/**
 * FR-229 — record a join, leave, memberJoined or memberLeft event. These carry no
 * individual identity in LINE's own payload (a group/room "join" has no
 * `source.userId`), so this attaches only to a conversation that already exists for
 * the thread; when none does, it is skipped rather than minting a Customer with no
 * real Person behind it (BR-002; documented as a scope decision in the task report).
 */
export async function recordExistingConversationEvent(input, { db = prisma } = {}) {
  const data = zRecordExistingConversationEventInput.parse(input)
  if (typeof db.$transaction === 'function') {
    for (let attempt = 0; ; attempt += 1) {
      try {
        return await db.$transaction((tx) => recordExistingConversationEvent(data, { db: tx }))
      } catch (error) {
        if (attempt >= 2 || !['P2002', 'P2034'].includes(error?.code)) throw error
      }
    }
  }

  const { tenantId, businessId, threadId, kind, externalEventId, payload, occurredAt, correlationId, sessionIdleTimeoutMinutes } = data
  const channelAccountId = data.channelAccountId?.trim() || LEGACY_CHANNEL_ACCOUNT_ID

  const conversation = await db.conversation.findUnique({ where: conversationKey(tenantId, channelAccountId, threadId) })
  if (!conversation) return { skipped: true }
  if (businessId !== undefined && conversation.businessId !== businessId) {
    throw failure(409, 'CONVERSATION_BUSINESS_SCOPE_CONFLICT')
  }

  const existingEvent = await db.conversationEvent.findUnique({
    where: { conversationId_externalEventId: { conversationId: conversation.id, externalEventId } },
  })
  if (existingEvent) return { conversationId: conversation.id, eventId: existingEvent.id, created: false }

  const eventAt = occurredAt ?? new Date()
  const sessionId = await openSessionIdAt(db, { conversationId: conversation.id, occurredAt: eventAt, idleTimeoutMinutes: sessionIdleTimeoutMinutes })
  const event = await db.conversationEvent.create({
    data: { conversationId: conversation.id, kind, externalEventId,
      payloadJson: JSON.stringify(payload ?? {}), occurredAt: eventAt, sessionId },
  })
  await db.conversation.update({ where: { id: conversation.id }, data: { updatedAt: new Date() } })
  await recordAudit(db, {
    entityType: 'CONVERSATION', entityId: conversation.id, action: 'CONVERSATION_EVENT_RECORDED', actorType: 'LINE',
    payload: {
      tenantId, businessId: conversation.businessId, channelAccountId, kind, eventId: event.id,
      ...(correlationId ? { correlationId } : {}),
    },
  })

  return { conversationId: conversation.id, eventId: event.id, created: true }
}

// FR-229 — the one string an unsent message's body carries, distinct from the PDPA
// erasure tombstone in conversation-redaction-service.js: the customer withdrew the
// message themselves, which is a different fact than "erased by legal request", so
// the two must read differently in the FR-091 inbox.
export const LINE_UNSEND_TOMBSTONE = '[ข้อความถูกเรียกคืนโดยผู้ส่ง]'

/**
 * FR-229 — an `unsend` event. Unlike follow/unfollow/postback, this never mints a
 * Customer or Conversation: an unsend for a thread the Business has no record of
 * yet has nothing to tombstone and no established relationship to attach to, so it
 * is skipped exactly like join/leave (documented scope decision — see the task
 * report). When a conversation already exists for the thread, this additionally
 * tombstones the referenced Message body and MessageAttachment when this Business
 * actually admitted that externalMessageId — recording the event never fails when
 * the referenced message is unknown: "a message the Business never received" is
 * recorded as an event with no error (ADR-091 proof 4).
 */
export async function ingestLineUnsendEvent(input, { db = prisma } = {}) {
  const data = zIngestLineUnsendEventInput.parse(input)
  if (typeof db.$transaction === 'function') {
    for (let attempt = 0; ; attempt += 1) {
      try {
        return await db.$transaction((tx) => ingestLineUnsendEvent(data, { db: tx }))
      } catch (error) {
        if (attempt >= 2 || !['P2002', 'P2034'].includes(error?.code)) throw error
      }
    }
  }

  const { tenantId, businessId, threadId, externalEventId, unsentExternalMessageId, occurredAt, correlationId, sessionIdleTimeoutMinutes } = data
  const channelAccountId = data.channelAccountId?.trim() || LEGACY_CHANNEL_ACCOUNT_ID

  const conversation = await db.conversation.findUnique({ where: conversationKey(tenantId, channelAccountId, threadId) })
  if (!conversation) return { skipped: true }
  if (businessId !== undefined && conversation.businessId !== businessId) {
    throw failure(409, 'CONVERSATION_BUSINESS_SCOPE_CONFLICT')
  }

  const existingEvent = await db.conversationEvent.findUnique({
    where: { conversationId_externalEventId: { conversationId: conversation.id, externalEventId } },
  })
  if (existingEvent) {
    return { conversationId: conversation.id, eventId: existingEvent.id, tombstonedMessage: false, created: false }
  }

  let tombstonedMessage = false
  if (unsentExternalMessageId) {
    const message = await db.message.findUnique({
      where: { conversationId_externalMessageId: { conversationId: conversation.id, externalMessageId: unsentExternalMessageId } },
    })
    if (message && message.body !== LINE_UNSEND_TOMBSTONE) {
      await db.message.update({ where: { id: message.id }, data: { body: LINE_UNSEND_TOMBSTONE } })
      await db.messageAttachment.updateMany({
        where: { messageId: message.id, fetchState: { not: 'ERASED' } },
        data: { fetchState: 'ERASED', providerContentId: null },
      })
      // @req FR-233 — an unsend may tombstone the conversation's current latest
      //   message; refresh rather than assume, since it may equally be an older one.
      await refreshConversationPreview(db, conversation.id)
      tombstonedMessage = true
    }
  }

  const eventAt = occurredAt ?? new Date()
  const sessionId = await openSessionIdAt(db, { conversationId: conversation.id, occurredAt: eventAt, idleTimeoutMinutes: sessionIdleTimeoutMinutes })
  const event = await db.conversationEvent.create({
    data: { conversationId: conversation.id, kind: 'UNSEND', externalEventId,
      payloadJson: JSON.stringify({ unsentExternalMessageId: unsentExternalMessageId ?? null }),
      occurredAt: eventAt, sessionId },
  })
  await db.conversation.update({ where: { id: conversation.id }, data: { updatedAt: new Date() } })
  await recordAudit(db, {
    entityType: 'CONVERSATION', entityId: conversation.id, action: 'CONVERSATION_EVENT_RECORDED', actorType: 'LINE',
    payload: {
      tenantId, businessId: conversation.businessId, channelAccountId, kind: 'UNSEND',
      eventId: event.id, tombstonedMessage, ...(correlationId ? { correlationId } : {}),
    },
  })

  return { conversationId: conversation.id, eventId: event.id, tombstonedMessage, created: true }
}
