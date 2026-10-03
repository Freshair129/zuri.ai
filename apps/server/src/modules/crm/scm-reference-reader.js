import prisma from '@/lib/db'

// @req FR-166 — CRM's narrow read port for the Customer and Conversation facts
//   the SCM service validates a sales order against (ADR-111 D5, contract
//   scm-core.v1 `customer` / `conversation`). Core's scm-core.v1 façade
//   (inventory/application/scm-core-facade.js) consumes this port instead of
//   reading crm's models itself, so the models stay CRM's to read and write.
// @spec ADR-111, BR-001, SEC-001
// @tested tests/unit/crm/scm-reference-reader.test.js
//
// Internal and viewer-free, like `readConversationConsentStatus`: the caller has
// already decided the viewer may use the named Business and passes that
// Business's Tenant; this port only bounds the read to that Tenant. Deciding
// whether a row homed in some Business is visible stays with the caller (the
// façade applies the legacy sales-order-service rule on top).
//
// Answers ONLY the columns the contract serves — no name, contact, consent or
// message field ever leaves here — and `null` for a missing id, a malformed
// input or a row of another Tenant, so "not found" and "not yours" read the
// same. Read-only by construction: this module exports no writer.

const validId = (value) => typeof value === 'string' && value.length > 0

/**
 * @returns {Promise<{id: string, code: string, tenantId: string, businessId: string|null, deletedAt: Date|null} | null>}
 */
export async function readCustomerFact({ tenantId, customerId } = {}, { db = prisma } = {}) {
  if (!validId(tenantId) || !validId(customerId)) return null
  const row = await db.customer.findUnique({
    where: { id: customerId },
    select: { id: true, code: true, tenantId: true, businessId: true, deletedAt: true },
  })
  if (!row || row.tenantId !== tenantId) return null
  return { id: row.id, code: row.code, tenantId: row.tenantId, businessId: row.businessId ?? null, deletedAt: row.deletedAt ?? null }
}

/**
 * @returns {Promise<{id: string, tenantId: string, businessId: string|null, customerId: string|null} | null>}
 */
export async function readConversationFact({ tenantId, conversationId } = {}, { db = prisma } = {}) {
  if (!validId(tenantId) || !validId(conversationId)) return null
  const row = await db.conversation.findUnique({
    where: { id: conversationId },
    select: { id: true, tenantId: true, businessId: true, customerId: true },
  })
  if (!row || row.tenantId !== tenantId) return null
  return { id: row.id, tenantId: row.tenantId, businessId: row.businessId ?? null, customerId: row.customerId ?? null }
}
