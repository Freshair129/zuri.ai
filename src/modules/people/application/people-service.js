import prisma from '@/lib/db'

// @req FR-042 - People Directory is a Business-scoped workforce view.
// @spec ADR-013, BR-001, SEC-003 - reuse Person/Membership and never cross tenant/business.
// @tested tests/unit/people-service.test.js

export async function listPeople(
  businessId,
  { db = prisma, visibleBusinessIds = null } = {},
) {
  if (!businessId) throw new Error('businessId is required')
  if (visibleBusinessIds && !visibleBusinessIds.includes(businessId)) {
    throw new Error('Business access denied')
  }

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
