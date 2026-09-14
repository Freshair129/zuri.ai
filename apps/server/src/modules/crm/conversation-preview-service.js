// @req FR-233 — Conversation.lastMessageAt / lastMessagePreview (≤120 chars), kept
//   in step with the Message rows they summarise. Not a new writer of its own —
//   every caller already owns a Message-content transaction (ingest, reply,
//   unsend, PDPA erasure, the retention sweep); this module is the one place that
//   turns "the messages changed" into "the summary on Conversation is correct",
//   so the redaction rule reads the same way from every one of those five sites.
// @spec ADR-091 D5 — the crm charter's "if a preview column is ever added, it
//   must be redacted here in the same call" is honoured by construction: nothing
//   computes a preview from a message body except this function, and it always
//   reads the row as it stands after whatever write just happened.
// @tested tests/integration/crm-conversation-inbox.test.js, tests/integration/crm-retention-sweep.test.js,
//   tests/integration/crm-customer-erasure.test.js

export const CONVERSATION_PREVIEW_LENGTH = 120

/** Collapse whitespace and cut to CONVERSATION_PREVIEW_LENGTH, same shape as the
 * inbox's existing 140-char preview (conversation-read-model.js) at a shorter,
 * FR-233-declared bound. */
export function truncateConversationPreview(body) {
  const text = String(body ?? '').replace(/\s+/g, ' ').trim()
  return text.length > CONVERSATION_PREVIEW_LENGTH
    ? `${text.slice(0, CONVERSATION_PREVIEW_LENGTH)}…`
    : text
}

/**
 * Recompute `Conversation.lastMessageAt` / `lastMessagePreview` from the actual
 * newest Message row still on the conversation. Deliberately a read-then-write
 * rather than "use the message the caller just touched": a redaction or sweep
 * may tombstone a message that is not the newest, and an unsend may tombstone
 * one that briefly was — reading the row back is the only way every caller gets
 * the correct answer without duplicating "is this actually the latest" logic
 * five times.
 *
 * Call inside the same transaction as the Message write it follows.
 *
 * @param {object} tx prisma client or transaction client
 * @param {string} conversationId
 */
export async function refreshConversationPreview(tx, conversationId) {
  const latest = await tx.message.findFirst({
    where: { conversationId },
    orderBy: { createdAt: 'desc' },
    select: { body: true, createdAt: true },
  })
  await tx.conversation.update({
    where: { id: conversationId },
    data: {
      lastMessageAt: latest?.createdAt ?? null,
      lastMessagePreview: latest ? truncateConversationPreview(latest.body) : null,
    },
  })
}
