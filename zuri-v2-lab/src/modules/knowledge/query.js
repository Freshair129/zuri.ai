import prisma from '@/lib/db'

// @req FR-024 — the read-side of the split: answer "what does the graph know about
//   this principal?" by returning their relation neighbourhood, tenant-scoped.
// @spec ADR-007 §P5 — GKS holds relations, Zuri holds live facts. This returns only
//   relations (who the principal is a customer of, which conversations, which
//   businesses, which memberships); a live fact would be a separate Zuri query.
// @spec BR-001, SEC-001 — tenant-scoped and read-only; soft-deleted customers excluded.
// @tested tests/integration/knowledge-query.test.js

/**
 * Query a principal's relation neighbourhood within a tenant.
 *
 * FROZEN CONTRACT (a sibling module depends on this exact shape):
 * @param {{ tenantId: string, principalId: string }} args — principalId is a Person.id
 * @returns {Promise<{
 *   principalId: string,
 *   found: boolean,
 *   relations: Array<{ rel: string, node: { id: string, type: string, label: string } }>
 * }>}
 *   `found` is true when the person has ANY relation in this tenant.
 *   relations are deterministically ordered by (rel, node.id).
 */
export async function queryKnowledge({ tenantId, principalId }) {
  if (!tenantId) throw new Error('queryKnowledge requires a tenantId')
  if (!principalId) throw new Error('queryKnowledge requires a principalId')

  // The principal's customer records in this tenant (+ their conversations and
  // owning business), and their tenant memberships. Read only relation-bearing fields
  // — never a live fact.
  const [customers, memberships] = await Promise.all([
    prisma.customer.findMany({
      where: { tenantId, personId: principalId, deletedAt: null },
      select: {
        id: true,
        displayName: true,
        businessId: true,
        business: { select: { id: true, name: true } },
        conversations: { select: { id: true, externalThreadId: true } },
      },
    }),
    prisma.membership.findMany({
      where: { tenantId, personId: principalId },
      select: { id: true, tenantId: true, tenant: { select: { id: true, name: true } } },
    }),
  ])

  const relations = []

  for (const c of customers) {
    // Person is the principal of this customer.
    relations.push({ rel: 'IS_PRINCIPAL', node: { id: c.id, type: 'Customer', label: c.displayName } })

    // Each conversation the customer holds.
    for (const conv of c.conversations) {
      relations.push({ rel: 'HAS_CONVERSATION', node: { id: conv.id, type: 'Conversation', label: conv.externalThreadId } })
    }

    // The business the customer belongs to (HAS_CUSTOMER reversed).
    if (c.business) {
      relations.push({ rel: 'BELONGS_TO_BUSINESS', node: { id: c.business.id, type: 'Business', label: c.business.name } })
    }
  }

  // The principal's memberships in this tenant — Person → Tenant.
  for (const m of memberships) {
    if (m.tenant) {
      relations.push({ rel: 'MEMBER_OF', node: { id: m.tenant.id, type: 'Tenant', label: m.tenant.name } })
    }
  }

  // Deterministic ordering.
  relations.sort((a, b) => a.rel.localeCompare(b.rel) || a.node.id.localeCompare(b.node.id))

  return {
    principalId,
    found: relations.length > 0,
    relations,
  }
}
