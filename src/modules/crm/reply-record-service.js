import { z } from 'zod'
import prisma from '@/lib/db'
import { recordAudit } from '@/modules/project-manager/application/audit'

// @req FR-148 — account/business scoped outbound append participates in caller transactions.
// @req FR-093 — the outbound half of a conversation becomes a row. Until this existed
//   nothing anywhere wrote a Message with `direction: 'OUTBOUND'`: the reply was
//   assembled, handed to the transport, sent to the customer and then forgotten.
// @spec SDD-051, BR-011, SEC-001, SDD-048
// @tested tests/integration/line-reply-record.test.js, tests/unit/reply-record-service.test.js, tests/integration/line-account-isolation.test.js
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
    select: { id: true, conversationId: true, direction: true },
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
    const message = await tx.message.create({
      data: {
        conversationId: inbound.conversationId,
        direction: DIRECTION,
        // Text accepted by LINE (server) or reported sent (legacy transport).
        // The audit distinguishes those outcomes; neither proves the user read it.
        body: data.text,
        externalMessageId,
        ...(acceptance?.acceptedAt ? { createdAt: new Date(acceptance.acceptedAt) } : data.deliveredAt ? { createdAt: new Date(data.deliveredAt) } : {}),
      },
    })

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
