import { z } from 'zod'
import prisma from '@/lib/db'
import { recordAudit } from '@/modules/project-manager/application/audit'
import { refreshConversationPreview } from './conversation-preview-service'
import { joinReplySession } from './conversation-session-service'
import { assertDomainVisible } from '@/modules/identity/viewer-domains'
import { ownsBusiness } from '@/modules/identity/viewer-authority'
import { LEGACY_CHANNEL_ACCOUNT_ID } from '@/modules/identity/channel-identity'
import { serverLinePorts } from '@/modules/line-oa-studio/application/server-line-runtime'

// @req FR-148 — account/business scoped outbound append participates in caller transactions.
// @req FR-093 — the outbound half of a conversation becomes a row. Until this existed
//   nothing anywhere wrote a Message with `direction: 'OUTBOUND'`: the reply was
//   assembled, handed to the transport, sent to the customer and then forgotten.
// @req FR-233 — a reply refreshes Conversation.lastMessageAt/lastMessagePreview too.
// @req FR-243 — a reply joins the session of the inbound message it answers and never
//   opens one (ADR-094 D2, SDD-102).
// @req FR-246 — a member with CRM write access replies from the inbox; the server
//   pushes it through the account's LINE transport and records it the same way, with
//   reply source STAFF naming the person (ADR-093 evidence gap, FEAT-041).
// @spec SDD-051, BR-011, SEC-001, SDD-048
// @tested tests/unit/reply-record-service.test.js, tests/integration/line-account-isolation.test.js,
//   tests/integration/crm-staff-reply.test.js
//
// WHY THIS IS NOT `ingestLineMessage({ direction: 'OUTBOUND' })`
// -------------------------------------------------------------
// That seam creates a Person, a Customer and a Conversation when they are absent —
// correct for an inbound message from someone new, and exactly wrong here. A receipt
// naming a conversation that does not exist is an error to report, not a reason to
// invent one.
//
// So this writer never takes a conversation from the request. It resolves the inbound
// `Message` the reply answers and derives the conversation from that row. Attaching a
// reply to another tenant's conversation is therefore not "checked and refused" — it
// is unsayable, because the only conversation this function can reach is the one that
// already holds the message the caller named.

const DIRECTION = 'OUTBOUND'

/** Who produced the text the customer received. Provenance, not content. */
export const REPLY_SOURCES = ['STACK', 'TRANSPORT_FALLBACK']
// @req FR-246 — a third provenance value, deliberately NOT in REPLY_SOURCES /
//   zReplyReceipt: those validate recordLineReply's receipt from the automatic
//   answer pipeline, and a stack/fallback reply must never be able to claim STAFF
//   provenance. sendStaffReply writes this literal directly into its own audit
//   payload instead.
export const STAFF_REPLY_SOURCE = 'STAFF'

export const zReplyReceipt = z.object({
  /** The `Message.id` of the inbound message this reply answers. */
  inboundMessageId: z.string().min(1),
  /** What the customer actually received — not necessarily what this side produced. */
  text: z.string().min(1).max(5000),
  /**
   * `STACK` — the answer this repository generated.
   * `TRANSPORT_FALLBACK` — the transport's own text, sent because the stack could not
   * answer. The distinction is the reason the receipt comes from the sender at all
   * (BR-011): only the transport knows which one the customer got.
   */
  source: z.enum(REPLY_SOURCES).default('STACK'),
  /** LINE's id for the sent message, when the provider returned one. Evidence only. */
  providerMessageId: z.string().min(1).optional(),
  deliveredAt: z.string().datetime().optional(),
}).strict()

function failure(status, message) {
  const error = new Error(message)
  error.status = status
  return error
}

/**
 * The external id of a reply.
 *
 * Derived from the inbound message rather than from anything the caller supplies, so a
 * redelivered receipt lands on the same row whether or not the transport still
 * remembers the provider's id. One inbound message has one reply, which is precisely
 * what the LINE Reply API allows per token — the data model and the provider agree.
 */
export const replyExternalId = (inboundMessageId) => `reply:${inboundMessageId}`

/**
 * Record one delivered reply.
 *
 * @param {{tenantId: string, businessId?: string, channelAccountId?: string, receipt: object, correlationId?: string, db?: object}} input
 * @returns {Promise<{messageId: string, conversationId: string, created: boolean}>}
 */
export async function recordLineReply({ tenantId, businessId, channelAccountId, receipt, correlationId, db = prisma, acceptance }) {
  const data = zReplyReceipt.parse(receipt)
  if (!tenantId) throw failure(400, 'TENANT_REQUIRED')

  // The scope check and the conversation lookup are the same query. An inbound message
  // outside this tenant is simply not found — there is no branch in which it resolves
  // and is then rejected, and therefore no branch someone can forget to write.
  const inbound = await db.message.findFirst({
    where: { id: data.inboundMessageId, conversation: {
      tenantId,
      ...(businessId !== undefined ? { businessId } : {}),
      ...(channelAccountId !== undefined ? { channel: 'LINE', channelAccountId } : {}),
    } },
    select: { id: true, conversationId: true, direction: true, sessionId: true },
  })
  if (!inbound) throw failure(404, 'INBOUND_MESSAGE_NOT_FOUND')

  // Replying to a reply is not a thing the LINE Reply API can express, and a receipt
  // that claims it is a transport bug worth surfacing rather than storing.
  if (inbound.direction !== 'INBOUND') throw failure(400, 'INBOUND_MESSAGE_NOT_INBOUND')

  const externalMessageId = replyExternalId(inbound.id)

  const existing = await db.message.findUnique({
    where: { conversationId_externalMessageId: { conversationId: inbound.conversationId, externalMessageId } },
    select: { id: true },
  })
  if (existing) {
    return { messageId: existing.id, conversationId: inbound.conversationId, created: false }
  }

  const append = async (tx) => {
    const repliedAt = acceptance?.acceptedAt ? new Date(acceptance.acceptedAt) : data.deliveredAt ? new Date(data.deliveredAt) : new Date()
    const session = await joinReplySession(tx, {
      conversationId: inbound.conversationId, inboundSessionId: inbound.sessionId, occurredAt: repliedAt,
    })
    const message = await tx.message.create({
      data: {
        conversationId: inbound.conversationId,
        direction: DIRECTION,
        // Text accepted by LINE (server) or reported sent (legacy transport).
        // The audit distinguishes those outcomes; neither proves the user read it.
        body: data.text,
        externalMessageId,
        sessionId: session?.id ?? null,
        ...(acceptance?.acceptedAt ? { createdAt: new Date(acceptance.acceptedAt) } : data.deliveredAt ? { createdAt: new Date(data.deliveredAt) } : {}),
      },
    })

    // @req FR-233 — the reply is a new message too; keep the inbox summary current.
    await refreshConversationPreview(tx, inbound.conversationId)

    await recordAudit(tx, {
      entityType: 'CONVERSATION',
      entityId: inbound.conversationId,
      action: acceptance ? 'OUTBOUND_ACCEPTED' : 'REPLY_DELIVERED',
      actorType: 'LINE',
      // @spec SDD-048 — same correlation id as the webhook that produced the answer, so
      //   `webhook → turn → message → reply` stays one chain in the audit table. No
      //   message text here: the row above already holds it, and the audit payload is
      //   read by tooling that has no business seeing customer content (SEC-009).
      payload: {
        tenantId,
        ...(businessId !== undefined ? { businessId } : {}),
        ...(channelAccountId !== undefined ? { channelAccountId } : {}),
        ...(acceptance || {}),
        conversationId: inbound.conversationId,
        inboundMessageId: inbound.id,
        messageId: message.id,
        source: data.source,
        ...(data.providerMessageId ? { providerMessageId: data.providerMessageId } : {}),
        ...(correlationId ? { correlationId } : {}),
      },
    })

    return { messageId: message.id, conversationId: inbound.conversationId, created: true }
  }
  if (typeof db.$transaction !== 'function') return append(db)
  try {
    return await db.$transaction(append)
  } catch (error) {
    if (error?.code !== 'P2002') throw error
    const winner = await db.message.findUnique({
      where: { conversationId_externalMessageId: { conversationId: inbound.conversationId, externalMessageId } },
    })
    if (!winner) throw error
    return { messageId: winner.id, conversationId: inbound.conversationId, created: false }
  }
}

/**
 * Append what LINE accepted, inside the same transaction as the server job's
 * terminal state. Acceptance is not delivery or a read receipt. All authority
 * comes from the worker's resolved account, never a client-selected conversation.
 */
export async function appendOutbound({
  db = prisma, tenantId, businessId, channelAccountId, receipt, correlationId,
  acceptedAt = new Date().toISOString(), providerRequestId,
}) {
  if (![tenantId, businessId, channelAccountId].every((value) => typeof value === 'string' && value.trim())) {
    throw failure(400, 'OUTBOUND_SCOPE_REQUIRED')
  }
  if (Object.prototype.hasOwnProperty.call(receipt || {}, 'deliveredAt')) {
    throw failure(400, 'ACCEPTANCE_IS_NOT_DELIVERY')
  }
  const acceptance = z.object({
    acceptedAt: z.string().datetime(),
    providerRequestId: z.string().min(1).optional(),
  }).parse({ acceptedAt, providerRequestId })
  return recordLineReply({ db, tenantId, businessId, channelAccountId, receipt, correlationId, acceptance })
}
// @req FR-246 — the staff reply writer.
//
// WHY THIS DOES NOT REUSE recordLineReply
// ----------------------------------------
// recordLineReply keys idempotency on the inbound message alone
// (`reply:${inboundMessageId}`), matching LINE's own one-reply-per-token rule: one
// inbound message gets exactly one stack answer. A human composing from the inbox
// has no such ceiling — the same conversation may receive several staff messages
// with no new inbound message between them — so idempotency here is keyed on the
// caller-supplied `clientRequestId` instead, the same shape the LINE job queue's own
// retry key already uses. It also means this writer sends through Push, never
// Reply — there is no replyToken to consume.
//
// WHY THIS IS NOT BR-011's "second reply owner"
// ------------------------------------------------
// BR-011 exists to stop two owners racing the SAME inbound event's replyToken. A
// staff reply answers no specific replyToken and races nothing — FR-091 is
// reworded to say so (ADR-039: the statement moved, the subject anchor did not).

export const zStaffReplyInput = z.object({
  businessId: z.string().min(1),
  text: z.string().trim().min(1).max(5000),
  // @spec matches server-line-transport's own zRetryKey shape and doubles as the
  //   X-Line-Retry-Key LINE itself dedupes on, so a browser retry after a dropped
  //   response neither double-sends nor double-records.
  clientRequestId: z.string().uuid(),
}).strict()

function scopeFailure(status, message) {
  const error = new Error(message)
  error.status = status
  return error
}

const staffReplyExternalId = (clientRequestId) => `staff:${clientRequestId}`

/**
 * Send and record one staff reply to a LINE conversation (FR-246).
 *
 * @param {string} conversationId
 * @param {{businessId: string, text: string, clientRequestId: string}} input
 * @param {{viewer: object, db?: object, correlationId?: string, env?: object,
 *   ports?: {resolveAccount: (id: string) => Promise<object>, pushTransport: {send: Function}}}} ctx
 */
export async function sendStaffReply(conversationId, input, {
  viewer, db = prisma, correlationId, env = process.env, ports,
} = {}) {
  if (!conversationId) throw scopeFailure(400, 'CONVERSATION_ID_REQUIRED')
  const data = zStaffReplyInput.parse(input)

  // @spec SEC-001 — the domain gate runs before the ownership gate, same order as
  //   customer-consent-service.js: a principal never granted the CRM here learns
  //   nothing about whether the Business is real from the status code alone.
  assertDomainVisible(viewer, data.businessId, 'customer')
  if (!ownsBusiness(viewer, data.businessId)) {
    throw scopeFailure(403, 'Sending a reply requires owner authority over this Business')
  }
  const actorId = viewer?.principal?.id ?? null
  if (!actorId) throw scopeFailure(401, 'VIEWER_IDENTITY_REQUIRED')

  const business = await db.business.findUnique({ where: { id: data.businessId }, select: { id: true, tenantId: true } })
  if (!business) throw scopeFailure(404, 'BUSINESS_NOT_FOUND')

  // Same tenant-shared scope the reader uses (BR-001): a conversation this
  // Business's tenant holds, bound to this Business or tenant-shared (`businessId: null`).
  const conversation = await db.conversation.findFirst({
    where: { id: conversationId, tenantId: business.tenantId, OR: [{ businessId: null }, { businessId: business.id }] },
    include: { messages: { orderBy: { createdAt: 'desc' }, take: 1, select: { sessionId: true } } },
  })
  if (!conversation) throw scopeFailure(404, 'Conversation not found')
  if (conversation.channel !== 'LINE' || conversation.channelAccountId === LEGACY_CHANNEL_ACCOUNT_ID) {
    throw scopeFailure(409, 'STAFF_REPLY_NOT_SUPPORTED_FOR_CHANNEL')
  }

  const externalMessageId = staffReplyExternalId(data.clientRequestId)
  const existing = await db.message.findUnique({
    where: { conversationId_externalMessageId: { conversationId: conversation.id, externalMessageId } },
  })
  if (existing) return { messageId: existing.id, conversationId: conversation.id, created: false }

  const account = await db.lineOaAccount.findFirst({
    where: { tenantId: business.tenantId, OR: [{ bindingCode: conversation.channelAccountId }, { id: conversation.channelAccountId }] },
    select: { id: true, serverEnabled: true },
  })
  if (!account || !account.serverEnabled) throw scopeFailure(409, 'LINE_ACCOUNT_NOT_SERVER_ENABLED')

  const linePorts = ports ?? serverLinePorts(env, db)
  const resolvedAccount = await linePorts.resolveAccount(account.id)
  const outcome = await linePorts.pushTransport.send({
    account: resolvedAccount, to: conversation.externalThreadId,
    messages: [{ type: 'text', text: data.text }], retryKey: data.clientRequestId,
  })
  // Nothing is recorded on anything but LINE's own acceptance — a failed or
  // retryable push leaves the row unwritten, so a retry with the same
  // clientRequestId tries again cleanly rather than colliding with a half-sent row.
  if (outcome.status !== 'ACCEPTED_BY_LINE') throw scopeFailure(502, 'STAFF_REPLY_NOT_ACCEPTED_BY_LINE')

  const append = async (tx) => {
    const session = await joinReplySession(tx, {
      conversationId: conversation.id,
      inboundSessionId: conversation.messages[0]?.sessionId ?? null,
      occurredAt: new Date(),
    })
    const message = await tx.message.create({
      data: {
        conversationId: conversation.id, direction: DIRECTION, body: data.text,
        externalMessageId, sessionId: session?.id ?? null,
      },
    })
    await refreshConversationPreview(tx, conversation.id)
    await recordAudit(tx, {
      entityType: 'CONVERSATION', entityId: conversation.id, action: 'STAFF_REPLY_DELIVERED',
      actorType: 'LOCAL_USER', actorId,
      // @spec SDD-048 — counts and ids only, never the message text (same rule
      //   recordLineReply's own audit payload follows).
      payload: {
        tenantId: business.tenantId, businessId: data.businessId, conversationId: conversation.id,
        messageId: message.id, source: STAFF_REPLY_SOURCE,
        ...(outcome.requestId ? { providerRequestId: outcome.requestId } : {}),
        ...(correlationId ? { correlationId } : {}),
      },
    })
    return { messageId: message.id, conversationId: conversation.id, created: true }
  }
  if (typeof db.$transaction !== 'function') return append(db)
  try {
    return await db.$transaction(append)
  } catch (error) {
    if (error?.code !== 'P2002') throw error
    const winner = await db.message.findUnique({
      where: { conversationId_externalMessageId: { conversationId: conversation.id, externalMessageId } },
    })
    if (!winner) throw error
    return { messageId: winner.id, conversationId: conversation.id, created: false }
  }
}
