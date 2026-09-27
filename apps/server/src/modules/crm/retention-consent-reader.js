// @req FR-022 — the read side of a Customer's retention consent (ADR-093 1.2.0),
//   a leaf module so the archive writer, the erasure re-seal and the consent
//   writer can all read it without importing each other. Always a live query:
//   the answer is taken at erasure / sweep / retrieval time, never cached.
// @spec ADR-093 1.2.0, FR-022, BR-001
// @tested tests/integration/crm-retention-consent.test.js

/** The Customers among `customerIds` (in this Tenant only) with an active retention consent. */
export async function customersWithActiveRetentionConsent(db, { tenantId, customerIds }) {
  const ids = [...new Set((customerIds ?? []).filter(Boolean))]
  if (!tenantId || ids.length === 0) return new Set()
  const rows = await db.customerRetentionConsent.findMany({
    where: { tenantId, customerId: { in: ids }, revokedAt: null },
    select: { customerId: true },
  })
  return new Set(rows.map((row) => row.customerId))
}

/** This Customer's active retention consent row, or null. */
export async function findActiveRetentionConsent(db, { tenantId, customerId }) {
  if (!tenantId || !customerId) return null
  return db.customerRetentionConsent.findFirst({
    where: { tenantId, customerId, revokedAt: null },
    orderBy: { recordedAt: 'desc' },
  })
}

/** Whether this Tenant has any active retention consent at all — a cheap guard before costlier work. */
export async function tenantHasActiveRetentionConsent(db, { tenantId }) {
  if (!tenantId) return false
  return (await db.customerRetentionConsent.count({ where: { tenantId, revokedAt: null } })) > 0
}
