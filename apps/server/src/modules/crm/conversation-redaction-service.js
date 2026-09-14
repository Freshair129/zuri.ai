// @req FR-022 — the crm half of PDPA erasure: the conversation text itself.
//   Erasure lives in identity (its charter: "the only flow allowed to do so"), but
//   `Message` is a crm-owned model, so identity asks for this through a contract
//   call instead of writing another domain's table by hand. That is the target
//   state both charters already name for the `Person` redaction debt; this new
//   surface starts on the right side of it rather than adding a second exception.
// @req FR-229 — also redacts each message's MessageAttachment (fetchState → ERASED,
//   providerContentId cleared) in the same call.
// @spec BR-001, SEC-005, SDD-048
// @spec ADR-091 D5
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
//
// FR-229 — a media message's MessageAttachment is redacted alongside its Message:
// `fetchState` moves to ERASED and `providerContentId` (LINE's own content id, the
// only thing a later fetch phase would need) is cleared, so a byte fetch can never
// retrieve what this call just erased. Nothing else on the row changes — `kind` and
// `mimeType`/`sizeBytes` (when a later phase has set them) survive, exactly as
// `direction` and timestamps survive on the Message itself.

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
  const redactedAttachments = await tx.messageAttachment.updateMany({
    where: { message: { conversationId: { in: conversationIds } }, fetchState: { not: 'ERASED' } },
    data: { fetchState: 'ERASED', providerContentId: null },
  })

  return { conversations: conversations.length, redactedMessages: redacted.count, redactedAttachments: redactedAttachments.count }
}
