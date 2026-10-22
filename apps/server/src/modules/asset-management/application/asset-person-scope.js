// @req FR-135 — responsibility Person references must be directly associated with the Asset Business.
// @spec SEC-023 — caller payloads cannot widen Business scope.
// @tested tests/unit/asset-lifecycle-service.test.js, tests/unit/asset-register-service.test.js
export async function assertCurrentBusinessPerson(tx, { personId, tenantId, businessId, now = new Date() }) {
  const membership = await tx.membership.findFirst({
    where: {
      personId,
      tenantId,
      businessId,
      scopeType: 'BUSINESS',
      status: 'ACTIVE',
      OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
    },
    select: { id: true },
  })

  if (!membership) {
    const error = new Error('Person not found in current business')
    error.status = 404
    throw error
  }
}
