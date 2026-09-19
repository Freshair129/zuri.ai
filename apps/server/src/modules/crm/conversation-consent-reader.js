import prisma from '@/lib/db'

// @req FR-236 — a narrow, internal (non-viewer) consent reader for the
//   knowledge lane's candidate decision (ADR-090 D6): it answers only whether
//   the source Conversation's Customer consent is exactly GRANTED, scoped to
//   the exact Tenant/Business a caller already proved authority over.
// @spec ADR-090 D6, D8; BR-001; SEC-001
// @tested tests/unit/conversation-consent-reader.test.js
//
// This is deliberately NOT `getConversationThread` (FR-091's viewer-facing
// reader). That reader authorizes a viewer against the `customer` domain
// before it will answer anything — correct for the console and for the
// candidate *draft* (which does read message content through it), but wrong
// here: a Business OWNER or LINE_OA_PUBLISHER deciding a candidate has
// already proven authority over the exact Business through the knowledge
// domain gate, and a missing, unrelated `customer` domain grant must not
// block a decision that never reads message content — only one Customer
// column. Read-only by construction: this module exports no writer, so it
// can never become a second write path into crm's models.
//
// Fails closed by returning `null` ("not readable") rather than throwing, so
// every caller is forced to treat "unknown" the same as "not GRANTED" instead
// of accidentally falling through an unhandled exception path — the same
// shape a missing or malformed sourceRef must resolve to (never a bypass).

export async function readConversationConsentStatus({ tenantId, businessId, conversationId } = {}, { db = prisma } = {}) {
  if (typeof tenantId !== 'string' || !tenantId) return null
  if (typeof businessId !== 'string' || !businessId) return null
  if (typeof conversationId !== 'string' || !conversationId) return null

  const conversation = await db.conversation.findUnique({
    where: { id: conversationId },
    select: { tenantId: true, businessId: true, customer: { select: { consentStatus: true } } },
  })
  if (!conversation || conversation.tenantId !== tenantId) return null
  // A tenant-shared conversation (businessId null) is reachable by any
  // Business of that Tenant (BR-001, the same bound `getConversationThread`
  // reads through); a Business-bound conversation must match exactly.
  if (conversation.businessId && conversation.businessId !== businessId) return null
  return conversation.customer?.consentStatus ?? null
}
