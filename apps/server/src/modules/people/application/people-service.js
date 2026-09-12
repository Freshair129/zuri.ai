import prisma from '@/lib/db'
import { assertDomainVisible } from '@/modules/identity/viewer-domains'

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
  const personIds = [...new Set(employments.map((employment) => employment.personId))]
  const activeMemberships = personIds.length
    ? await db.membership.findMany({
        where: {
          personId: { in: personIds },
          tenantId: business.tenantId,
          status: 'ACTIVE',
          OR: [{ businessId }, { businessId: null }],
        },
        select: { personId: true },
      })
    : []
  const hasAccess = new Set(activeMemberships.map((membership) => membership.personId))

  // @req FR-193 — who can reach this Business but is not on its roster.
  //
  // Every summary figure above is roster-derived, `withSystemAccessCount`
  // included: it counts Employment rows whose person also holds a Membership.
  // That is the right definition for a roster column and a misleading one on
  // an empty roster — a Business with three live Memberships and no Employment
  // rows reported "System access 0", which reads as "nobody can get in" when
  // the truth is "nobody has an employment record yet". Observed on production
  // 2026-09-12, where the ADR-078 backfill found no `employeeRef` values to
  // carry over and left the directory empty.
  //
  // So the gap is named rather than left to be inferred from a zero: these are
  // the people an owner most likely needs to create a record for, which also
  // gives the empty state something to act on. Queried independently of the
  // roster — the same ACTIVE, this-Business-or-tenant-wide test `resolveViewer`
  // would apply — never by subtracting one count from another.
  const rosterPersonIds = new Set(employments.map((employment) => employment.personId))
  const businessMemberships = await db.membership.findMany({
    where: {
      tenantId: business.tenantId,
      status: 'ACTIVE',
      OR: [{ businessId }, { businessId: null }],
    },
    select: { personId: true, person: { select: { id: true, code: true, displayName: true, email: true } } },
  })
  const accessWithoutEmployment = [
    ...new Map(
      businessMemberships
        .filter((membership) => !rosterPersonIds.has(membership.personId) && membership.person)
        .map((membership) => [membership.personId, membership.person]),
    ).values(),
  ]

  return {
    // `tenantId` is exposed so the create form can name the scope it is writing
    // into. It is not a trust boundary: `createEmployment` re-reads the Business
    // and refuses a mismatched tenant, so a client that sends the wrong one is
    // rejected rather than believed.
    business: { id: business.id, code: business.code, name: business.name, tenantId: business.tenantId },
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
      // Deliberately NOT folded into `withSystemAccessCount`: that figure
      // answers "how many of these employees can log in", this one answers
      // "how many people can log in and are missing from this list". Summing
      // them would produce a number answering neither.
      accessWithoutEmploymentCount: accessWithoutEmployment.length,
    },
  }
}
