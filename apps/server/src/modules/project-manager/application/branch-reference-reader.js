import prisma from '@/lib/db'

// @req FR-183, FR-194 — project-manager's narrow read port for the Branch facts
//   the SCM service checks a POS sale and its terminal catalogue against
//   (ADR-111 D5, contract scm-core.v1 `branch` / `branches`). Core's scm-core.v1
//   façade (inventory/application/scm-core-facade.js) consumes this port instead
//   of reading the Branch model itself, so Branch stays this domain's to read and
//   write — the same standard crm's scm-reference-reader.js sets for Customer and
//   Conversation.
// @spec ADR-111, BR-001, SEC-001
// @tested tests/unit/project-manager/branch-reference-reader.test.js
//
// Internal and viewer-free: the caller has already decided the viewer may use
// the named Business and passes that Business's Tenant; this port only bounds the
// read to that Tenant (and, for the list, to that Business). Deciding whether a
// Branch homed in some Business is visible stays with the caller.
//
// Answers ONLY the columns the contract serves — never a tax branch code, a
// contact or any other column — and `null` for a missing id, a malformed input or
// another Tenant's Branch, so "not found" and "not yours" read the same. The list
// is ordered by code and bounded by the caller's `limit` (the façade asks for its
// cap + 1 so it can refuse rather than silently truncate). Read-only by
// construction: this module exports no writer.

const validId = (value) => typeof value === 'string' && value.length > 0

/**
 * One Branch of the Tenant.
 * @returns {Promise<{id: string, code: string, name: string, tenantId: string, businessId: string, status: string} | null>}
 */
export async function readBranchFact({ tenantId, branchId } = {}, { db = prisma } = {}) {
  if (!validId(tenantId) || !validId(branchId)) return null
  const row = await db.branch.findUnique({
    where: { id: branchId },
    select: { id: true, code: true, name: true, tenantId: true, businessId: true, status: true },
  })
  if (!row || row.tenantId !== tenantId) return null
  return { id: row.id, code: row.code, name: row.name, tenantId: row.tenantId, businessId: row.businessId, status: row.status }
}

/**
 * Every Branch of one Business of the Tenant, any status, ordered by code.
 * @returns {Promise<Array<{id: string, code: string, name: string, address: string|null, kind: string, status: string, tenantId: string, businessId: string}>>}
 */
export async function listBusinessBranchFacts({ tenantId, businessId, limit } = {}, { db = prisma } = {}) {
  if (!validId(tenantId) || !validId(businessId) || !Number.isInteger(limit) || limit < 1) return []
  const rows = await db.branch.findMany({
    where: { tenantId, businessId },
    orderBy: [{ code: 'asc' }],
    take: limit,
    select: { id: true, code: true, name: true, address: true, kind: true, status: true, tenantId: true, businessId: true },
  })
  return rows.map((row) => ({
    id: row.id, code: row.code, name: row.name, address: row.address ?? null, kind: row.kind,
    status: row.status, tenantId: row.tenantId, businessId: row.businessId,
  }))
}
