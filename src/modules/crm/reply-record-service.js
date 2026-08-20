import { z } from 'zod'
import prisma from '@/lib/db'
import { recordAudit } from '@/modules/project-manager/application/audit'

// @req FR-093 — the outbound half of a conversation becomes a row. Until this existed
//   nothing anywhere wrote a Message with `direction: 'OUTBOUND'`: the reply was
//   assembled, handed to the transport, sent to the customer and then forgotten.
// @spec SDD-051, BR-011, SEC-001, SDD-048
// @tested tests/integration/line-reply-record.test.js, tests/unit/reply-record-service.test.js
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
 * @param {{tenantId: string, receipt: object, correlationId?: string}} input
 * @returns {Promise<{messageId: string, conversationId: string, created: boolean}>}
 */
export async function recordLineReply({ tenantId, receipt, correlationId }) {
  const data = zReplyReceipt.parse(receipt)
  if (!tenantId) throw failure(400, 'TENANT_REQUIRED')

  // The scope check and the conversation lookup are the same query. An inbound message
  // outside this tenant is simply not found — there is no branch in which it resolves
  // and is then rejected, and therefore no branch someone can forget to write.
  const inbound = await prisma.message.findFirst({
    where: { id: data.inboundMessageId, conversation: { tenantId } },
    select: { id: true, conversationId: true, direction: true },
  })
  if (!inbound) throw failure(404, 'INBOUND_MESSAGE_NOT_FOUND')

  // Replying to a reply is not a thing the LINE Reply API can express, and a receipt
  // that claims it is a transport bug worth surfacing rather than storing.
  if (inbound.direction !== 'INBOUND') throw failure(400, 'INBOUND_MESSAGE_NOT_INBOUND')

  const externalMessageId = replyExternalId(inbound.id)

  const existing = await prisma.message.findUnique({
    where: { conversationId_externalMessageId: { conversationId: inbound.conversationId, externalMessageId } },
    select: { id: true },
  })
  if (existing) {
    return { messageId: existing.id, conversationId: inbound.conversationId, created: false }
  }

  return prisma.$transaction(async (tx) => {
    const message = await tx.message.create({
      data: {
        conversationId: inbound.conversationId,
        direction: DIRECTION,
        // The body is what was said. Where it came from is a different fact and lives
        // on the audit event, so a reader of the conversation reads the conversation.
        body: data.text,
        externalMessageId,
        ...(data.deliveredAt ? { createdAt: new Date(data.deliveredAt) } : {}),
      },
    })

    await recordAudit(tx, {
      entityType: 'CONVERSATION',
      entityId: inbound.conversationId,
      action: 'REPLY_DELIVERED',
      actorType: 'LINE',
      // @spec SDD-048 — same correlation id as the webhook that produced the answer, so
      //   `webhook → turn → message → reply` stays one chain in the audit table. No
      //   message text here: the row above already holds it, and the audit payload is
      //   read by tooling that has no business seeing customer content (SEC-009).
      payload: {
        tenantId,
        conversationId: inbound.conversationId,
        inboundMessageId: inbound.id,
        messageId: message.id,
        source: data.source,
        ...(data.providerMessageId ? { providerMessageId: data.providerMessageId } : {}),
        ...(correlationId ? { correlationId } : {}),
      },
    })

    return { messageId: message.id, conversationId: inbound.conversationId, created: true }
  })
}
