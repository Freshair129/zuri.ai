import prisma from '@/lib/db'
import { zEmploymentInput } from '@/lib/validation/entities'
import { ownsBusiness, isInstallationOperator } from '@/modules/identity/viewer-authority'
import { assertDomainVisible } from '@/modules/identity/viewer-domains'
import { recordAudit } from '@/modules/project-manager/application/audit'

// @req FR-193 — Employment is an HR record with its own lifecycle, separate
// from Membership's access grant (ADR-078 D1). This is the ONE writer: a
// Business OWNER creates, places on leave, reinstates or ends an Employment.
// None of these four operations ever touches `Membership`, `RoleBinding` or
// any other access-grant table — the same one-way discipline ADR-037 D1
// enforces for `TeamMembership` (grouping/HR facts never widen or narrow
// authority), verified by
// tests/unit/fr193-employment-not-authorization.test.js.
// @spec ADR-078 D1, BR-034, SDD-093
// @tested tests/integration/fr193-employment-lifecycle.test.js,
//   tests/unit/fr193-employment-not-authorization.test.js

const failure = (status, message) => Object.assign(new Error(message), { status })
const actor = (viewer) => viewer?.principal?.id ?? null

const EMPLOYMENT_SELECT = {
  id: true, personId: true, tenantId: true, businessId: true, branchId: true,
  employeeNo: true, title: true, employmentType: true, status: true,
  startAt: true, endAt: true, createdAt: true, updatedAt: true, version: true,
}

// @req FR-061 — the `people` domain grant is checked BEFORE ownership, and
// both refuse with the identical 404, so a caller learns nothing about a
// Business they cannot see in this domain (FR-072(a)). Ownership alone is not
// sufficient here: `people` is grantable per-Business (config/domains.js), and
// `listPeople` has always applied this test on the read side — a write path
// that skipped it would let an owner mutate a roster the same viewer is not
// permitted to read. `tests/unit/domain-visibility-server-enforcement.test.js`
// scans for exactly this omission and caught these routes before they shipped.
function requireBusinessOwner(viewer, businessId) {
  assertDomainVisible(viewer, businessId, 'people')
  if (!ownsBusiness(viewer, businessId)) throw failure(404, 'Business not found')
}

/** Create one Employment. Never grants system access — that is Membership's job. */
export async function createEmployment(input, { viewer, db = prisma } = {}) {
  const data = zEmploymentInput.parse(input)
  requireBusinessOwner(viewer, data.businessId)

  const business = await db.business.findUnique({
    where: { id: data.businessId },
    select: { id: true, tenantId: true, status: true },
  })
  if (!business || business.status === 'ARCHIVED') throw failure(404, 'Business not found')
  if (business.tenantId !== data.tenantId) throw failure(400, 'Tenant/Business ancestry mismatch')

  const person = await db.person.findUnique({ where: { id: data.personId }, select: { id: true } })
  if (!person) throw failure(404, 'Person not found')

  if (data.branchId) {
    const branch = await db.branch.findUnique({
      where: { id: data.branchId },
      select: { id: true, businessId: true, tenantId: true, status: true },
    })
    if (!branch || branch.businessId !== data.businessId || branch.tenantId !== data.tenantId || branch.status !== 'ACTIVE') {
      throw failure(422, 'EMPLOYMENT_BRANCH_NOT_CONFIGURED')
    }
  }

  const existing = await db.employment.findFirst({
    where: { personId: data.personId, businessId: data.businessId, endAt: null },
    select: { id: true },
  })
  if (existing) throw failure(409, 'EMPLOYMENT_ALREADY_OPEN')

  const employment = await db.employment.create({
    data: {
      personId: data.personId,
      tenantId: data.tenantId,
      businessId: data.businessId,
      branchId: data.branchId ?? null,
      employeeNo: data.employeeNo ?? null,
      title: data.title ?? null,
      employmentType: data.employmentType ?? 'EMPLOYEE',
      startAt: data.startAt ?? null,
    },
    select: EMPLOYMENT_SELECT,
  })
  await recordAudit(db, {
    entityType: 'EMPLOYMENT',
    entityId: employment.id,
    action: 'EMPLOYMENT_CREATED',
    actorId: actor(viewer),
    payload: { businessId: data.businessId, personId: data.personId, employmentType: employment.employmentType },
  })
  return employment
}

async function loadForTransition(db, employmentId) {
  const employment = await db.employment.findUnique({ where: { id: employmentId }, select: EMPLOYMENT_SELECT })
  if (!employment) throw failure(404, 'Employment not found')
  return employment
}

/** ACTIVE → ON_LEAVE. Refuses an already-ended Employment. */
export async function setEmploymentOnLeave(employmentId, { viewer, db = prisma } = {}) {
  const employment = await loadForTransition(db, employmentId)
  requireBusinessOwner(viewer, employment.businessId)
  if (employment.status === 'ENDED') throw failure(409, 'EMPLOYMENT_ALREADY_ENDED')
  if (employment.status === 'ON_LEAVE') return employment
  const updated = await db.employment.update({
    where: { id: employmentId },
    data: { status: 'ON_LEAVE', version: { increment: 1 } },
    select: EMPLOYMENT_SELECT,
  })
  await recordAudit(db, { entityType: 'EMPLOYMENT', entityId: employmentId, action: 'EMPLOYMENT_ON_LEAVE', actorId: actor(viewer), payload: { businessId: employment.businessId, personId: employment.personId } })
  return updated
}

/** ON_LEAVE → ACTIVE. Refuses an already-ended Employment. */
export async function reinstateEmployment(employmentId, { viewer, db = prisma } = {}) {
  const employment = await loadForTransition(db, employmentId)
  requireBusinessOwner(viewer, employment.businessId)
  if (employment.status === 'ENDED') throw failure(409, 'EMPLOYMENT_ALREADY_ENDED')
  if (employment.status === 'ACTIVE') return employment
  const updated = await db.employment.update({
    where: { id: employmentId },
    data: { status: 'ACTIVE', version: { increment: 1 } },
    select: EMPLOYMENT_SELECT,
  })
  await recordAudit(db, { entityType: 'EMPLOYMENT', entityId: employmentId, action: 'EMPLOYMENT_REINSTATED', actorId: actor(viewer), payload: { businessId: employment.businessId, personId: employment.personId } })
  return updated
}

/**
 * ACTIVE|ON_LEAVE → ENDED. Terminal: a re-hire is a new Employment row, never
 * a reopened one (the same discipline the partial unique index enforces —
 * `Employment_person_business_open_key` is WHERE endAt IS NULL, so only one
 * open row can exist per person per Business at a time).
 *
 * Ending an Employment never revokes Membership. An owner who also wants to
 * remove system access calls identity's `revokeMembership` (ADR-077)
 * separately — the two are different authorities acting on different tables,
 * on purpose (ADR-078 D1).
 */
export async function endEmployment(employmentId, { reason, endAt = new Date(), viewer, db = prisma } = {}) {
  if (!reason || !String(reason).trim()) throw failure(400, 'reason is required')
  const employment = await loadForTransition(db, employmentId)
  // @req FR-193 — only ending additionally permits a live Operator (ADR-082).
  // @tested tests/integration/fr193-remove-controls.test.js
  assertDomainVisible(viewer, employment.businessId, 'people')
  if (!ownsBusiness(viewer, employment.businessId) && !isInstallationOperator(viewer)) {
    throw failure(404, 'Business not found')
  }
  if (employment.status === 'ENDED') throw failure(409, 'EMPLOYMENT_ALREADY_ENDED')
  const at = endAt instanceof Date ? endAt : new Date(endAt)
  if (employment.startAt && at < employment.startAt) throw failure(422, 'EMPLOYMENT_END_BEFORE_START')
  const updated = await db.employment.update({
    where: { id: employmentId },
    data: { status: 'ENDED', endAt: at, version: { increment: 1 } },
    select: EMPLOYMENT_SELECT,
  })
  await recordAudit(db, { entityType: 'EMPLOYMENT', entityId: employmentId, action: 'EMPLOYMENT_ENDED', actorId: actor(viewer), payload: { businessId: employment.businessId, personId: employment.personId, reason } })
  return updated
}
