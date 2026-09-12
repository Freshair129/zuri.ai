import prisma from '@/lib/db'
import { assertDomainVisible } from '@/modules/identity/viewer-domains'
import { ownsBusiness } from '@/modules/identity/viewer-authority'

// @req FR-042 - People Directory is a Business-scoped workforce view.
// @req FR-193 - the roster is built from `Employment` (who works here), never
// from `Membership` (who may log in here). Before this the directory read
// Membership directly, which made the two questions the same by construction:
// a shareholder holding an OWNER Membership appeared as an employee, a
// suspended staff member vanished from the roster instead of showing
// suspended, a consultant with access but no employment could not be told
// apart from staff, and the LINE-originated Persons FR-023 creates on first
// contact — who hold no Membership at all — could never appear here.
// `hasSystemAccess` is now a column DERIVED FROM Membership and shown
// alongside the roster, never the other way round (ADR-078 D1).
// @spec ADR-013, ADR-078 D1, BR-001, BR-034, SDD-093, SEC-003 - reuse Person and never
// cross tenant/business.
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

  const employments = await db.employment.findMany({
    where: { businessId },
    orderBy: [{ status: 'asc' }, { createdAt: 'asc' }],
    select: {
      id: true,
      personId: true,
      employeeNo: true,
      title: true,
      employmentType: true,
      status: true,
      startAt: true,
      endAt: true,
      person: { select: { id: true, code: true, displayName: true, email: true } },
      branch: { select: { id: true, code: true, name: true } },
    },
  })

  // @req FR-193 — "has system access" is read FROM Membership, never the
  // reverse: an ACTIVE Membership scoped to this Business or tenant-wide is
  // what `resolveViewer` itself would grant a session from. A SUSPENDED or
  // REVOKED Membership — or no Membership at all — answers false, and the
  // Employment row is still listed either way (BR-034).
  // @req FR-193 — members stay visible after Employment is added. Read live
  // Memberships independently, then annotate them with the open HR record.
  // An ended record remains history and allows a new Employment on re-hire.
  const openEmploymentByPerson = new Map(employments
    .filter((employment) => employment.endAt == null)
    .map((employment) => [employment.personId, employment]))
  const businessMemberships = await db.membership.findMany({
    where: {
      tenantId: business.tenantId,
      status: 'ACTIVE',
      person: { accessDisabledAt: null },
      OR: [{ businessId }, { businessId: null }],
      AND: [{ OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] }],
    },
    select: { personId: true, person: { select: { id: true, code: true, displayName: true, email: true } } },
  })
  const hasAccess = new Set(businessMemberships.map((membership) => membership.personId))
  const accessMembers = [...new Map(businessMemberships
    .filter((membership) => membership.person)
    .map((membership) => [membership.personId, membership.person])).values()]
    .map((person) => ({
      person,
      hasOpenEmployment: openEmploymentByPerson.has(person.id),
      employmentStatus: openEmploymentByPerson.get(person.id)?.status ?? null,
    }))
    .sort((a, b) => a.person.displayName.localeCompare(b.person.displayName))
  const accessWithoutEmployment = accessMembers
    .filter((member) => !member.hasOpenEmployment).map((member) => member.person)

  return {
    // `tenantId` is exposed so the create form can name the scope it is writing
    // into. It is not a trust boundary: `createEmployment` re-reads the Business
    // and refuses a mismatched tenant, so a client that sends the wrong one is
    // rejected rather than believed.
    business: { id: business.id, code: business.code, name: business.name, tenantId: business.tenantId },
    canManageEmployment: ownsBusiness(viewer, businessId),
    accessMembers,
    accessWithoutEmployment,
    people: employments.map((employment) => ({
      employmentId: employment.id,
      person: employment.person,
      employeeNo: employment.employeeNo,
      title: employment.title,
      employmentType: employment.employmentType,
      status: employment.status,
      startAt: employment.startAt,
      endAt: employment.endAt,
      branch: employment.branch,
      hasSystemAccess: hasAccess.has(employment.personId),
    })),
    summary: {
      peopleCount: employments.length,
      activeCount: employments.filter((employment) => employment.status === 'ACTIVE').length,
      onLeaveCount: employments.filter((employment) => employment.status === 'ON_LEAVE').length,
      endedCount: employments.filter((employment) => employment.status === 'ENDED').length,
      withSystemAccessCount: employments.filter((employment) => hasAccess.has(employment.personId)).length,
      accessMemberCount: accessMembers.length,
      accessWithoutEmploymentCount: accessWithoutEmployment.length,
    },
  }
}
