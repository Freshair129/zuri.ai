// @req FR-022 — the crm half of PDPA erasure: the conversation text itself.
//   Erasure lives in identity (its charter: "the only flow allowed to do so"), but
//   `Message` is a crm-owned model, so identity asks for this through a contract
//   call instead of writing another domain's table by hand. That is the target
//   state both charters already name for the `Person` redaction debt; this new
//   surface starts on the right side of it rather than adding a second exception.
// @spec BR-001, SEC-005, SDD-048
// @tested tests/integration/crm-customer-erasure.test.js, tests/integration/identity-erase.test.js
//
// WHY A TOMBSTONE AND NOT A DELETE
// --------------------------------
// Deleting the rows would delete the conversation: the inbox counts messages, and a
// thread that silently loses ten of them reads as data loss, not as an honoured
// erasure request. Replacing `body` while keeping ids, direction and timestamps
// keeps the *shape* of what happened — a Business can still see that it talked to
// someone on a date and that the content is gone by law — while the personal data
// itself is no longer readable anywhere in the product.
//
// There is no preview or snippet column to chase: `Conversation` stores no denormalised
// last-message text (prisma/schema.prisma), and the FR-091 inbox derives its preview
// from the `Message` rows this function rewrites. If a preview column is ever added,
// it must be redacted here in the same call.

/**
 * The one string an erased message body carries. Thai, because a Business owner reads
 * it in the FR-091 inbox; fixed, because a per-request string would make one erased
 * thread distinguishable from another.
 */
export const CUSTOMER_ERASURE_TOMBSTONE = '[ข้อความถูกลบตามคำขอ PDPA]'

/**
 * Replace the content of every message in this tenant's conversations for the
 * given customers with the erasure tombstone. Ids, direction and timestamps are
 * untouched.
 *
 * Idempotent: a message already carrying the tombstone is not counted or rewritten,
 * so a second erasure of the same principal reports zero rather than re-erasing.
 *
 * @param {object} tx prisma client or transaction client — the caller owns the transaction
 * @param {{tenantId: string, customerIds: string[]}} scope
 * @returns {Promise<{conversations: number, redactedMessages: number}>}
 */
export async function redactConversationContentForCustomers(tx, { tenantId, customerIds } = {}) {
  if (!tenantId) throw new Error('redactConversationContentForCustomers requires tenantId')
  const ids = Array.isArray(customerIds) ? customerIds.filter(Boolean) : []
  if (ids.length === 0) return { conversations: 0, redactedMessages: 0 }

  // Tenant-scoped on purpose: a customer id alone must never reach another tenant's
  // conversations, exactly as the FR-103 consent writer resolves its Customer.
  const conversations = await tx.conversation.findMany({
    where: { tenantId, customerId: { in: ids } },
    select: { id: true },
  })
  if (conversations.length === 0) return { conversations: 0, redactedMessages: 0 }

  const conversationIds = conversations.map((conversation) => conversation.id)
  const redacted = await tx.message.updateMany({
    where: { conversationId: { in: conversationIds }, body: { not: CUSTOMER_ERASURE_TOMBSTONE } },
    data: { body: CUSTOMER_ERASURE_TOMBSTONE },
  })

  return { conversations: conversations.length, redactedMessages: redacted.count }
}
