import prisma from '@/lib/db'
import { assertDomainVisible } from '@/modules/identity/viewer-domains'

// @req FR-042 - People Directory is a Business-scoped workforce view.
// @spec ADR-013, BR-001, SEC-003 - reuse Person/Membership and never cross tenant/business.
// @tested tests/unit/people-service.test.js, tests/integration/domain-visibility-server.test.js

/**
 * @req FR-061 — `viewer` is required rather than optional, and that is deliberate.
 * The obvious shape here was `if (viewer) assertDomainVisible(...)`, which is a guard a
 * caller disables by forgetting an argument — the exact failure mode SDD-037 names for
 * the import pipeline. Taking the whole viewer also removes the older seam where the
 * route pre-extracted `visibleBusinessIds`: a caller could hand over that array and
 * nothing else, and the domain question then had no data to answer from.
 * `visibleBusinessIds` stays as an explicit override only because it is what the
 * existing refusal is written against.
 */
export async function listPeople(
  businessId,
  { db = prisma, viewer = null, visibleBusinessIds = null } = {},
) {
  if (!businessId) throw new Error('businessId is required')
  const visible = visibleBusinessIds ?? viewer?.visibleBusinessIds ?? null
  if (visible && !visible.includes(businessId)) {
    throw new Error('Business access denied')
  }
  // @req FR-061 — before the Business is read, so a MEMBER without the `people` grant
  // gets the same 404 for a real Business and for one that never existed (FR-072(a)).
  assertDomainVisible(viewer, businessId, 'people')

  const business = await db.business.findUnique({
    where: { id: businessId },
    select: { id: true, code: true, name: true, status: true, tenantId: true },
  })
  if (!business || business.status === 'ARCHIVED') throw new Error('Business not found')

  const memberships = await db.membership.findMany({
    where: {
      tenantId: business.tenantId,
      OR: [{ businessId }, { businessId: null }],
    },
    orderBy: [{ role: 'asc' }, { createdAt: 'asc' }],
    select: {
      id: true,
      businessId: true,
      branchId: true,
      employeeRef: true,
      role: true,
      person: { select: { id: true, code: true, displayName: true, email: true } },
      branch: { select: { id: true, code: true, name: true } },
    },
  })

  return {
    business: { id: business.id, code: business.code, name: business.name },
    people: memberships.map((membership) => ({
      membershipId: membership.id,
      person: membership.person,
      employeeRef: membership.employeeRef,
      role: membership.role,
      businessScope: membership.businessId ? 'BUSINESS' : 'TENANT',
      branch: membership.branch,
    })),
    summary: {
      peopleCount: memberships.length,
      businessScopedCount: memberships.filter((membership) => membership.businessId).length,
      tenantScopedCount: memberships.filter((membership) => !membership.businessId).length,
    },
  }
}
