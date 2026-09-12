import prisma from '@/lib/db'
import { recordAudit } from '@/modules/project-manager/application/audit'
import { conflictingRoles, ROLE_PERMISSIONS, ROLE_PRODUCT_OWNER, ROLE_SCOPE_BUSINESS } from './rbac'
import { ownsTenant } from './viewer-authority'

// @req FR-076 — RoleBinding is explicit, Business-scoped, revocable and auditable.
// @spec ADR-033 D2-D6 — assigning a Product Owner role does not change Membership.role.
// @tested tests/unit/fr076-product-owner-business-assignment.test.js

const ACTIVE = 'ACTIVE'
const SUSPENDED = 'SUSPENDED'
const REVOKED = 'REVOKED'
const ALLOWED_STATUSES = new Set([ACTIVE, SUSPENDED, REVOKED])

function accessError(message, status = 400) {
  const error = new Error(message)
  error.status = status
  return error
}

function requireId(value, name) {
  if (typeof value !== 'string' || !value.trim()) throw accessError(`${name} is required`)
  return value
}

function requireKnownRole(roleKey) {
  if (typeof roleKey !== 'string' || !ROLE_PERMISSIONS[roleKey]) {
    throw accessError('Unknown role key')
  }
  return roleKey
}

function requireBusinessScope(scopeType) {
  if (scopeType !== ROLE_SCOPE_BUSINESS) throw accessError('Only Business-scoped role bindings are supported')
  return scopeType
}

async function assertTargetBusiness(db, tenantId, businessId) {
  const business = await db.business.findUnique({
    where: { id: businessId },
    select: { id: true, tenantId: true, status: true },
  })
  if (!business || business.status !== 'ACTIVE') throw accessError('Business not found', 404)
  if (business.tenantId !== tenantId) throw accessError('Tenant/Business ancestry mismatch', 400)
  return business
}

async function assertEmployee(db, personId, tenantId, businessId) {
  const person = await db.person.findUnique({ where: { id: personId }, select: { id: true } })
  if (!person) throw accessError('Person not found', 404)

  const membership = await db.membership.findFirst({
    where: {
      personId,
      tenantId,
      OR: [{ businessId: null }, { businessId }],
    },
    select: { id: true },
  })
  if (!membership) throw accessError('Person is not an employee of the Tenant/Business', 403)
}

function requireBusinessOwner(viewer, businessId) {
  if (!viewer?.ownedBusinessIds?.includes(businessId)) {
    throw accessError('Business owner authority is required', 404)
  }
  return viewer.principal?.id || null
}

function auditActionFor(status) {
  if (status === REVOKED) return 'ROLE_BINDING_REVOKED'
  if (status === SUSPENDED) return 'ROLE_BINDING_SUSPENDED'
  return 'ROLE_BINDING_REACTIVATED'
}

// @req FR-196 — segregation of duties at the write, not only the read. A
// conflict is evaluated across the person's OTHER live bindings in the same
// Tenant (any Business, any scope) — a buyer at Business A and a receiver at
// Business B is still one person completing their own cycle if both are the
// same Tenant, which is the shape ADR-065 D4 and ADR-066 D4 both name. Refused
// 409 ROLE_CONFLICT unless a TENANT owner passes `sodOverride: { reason }` —
// deliberately not a Business owner's call, the same "the person who would be
// stranded is the only one who may make it" reasoning `assertNotLastOwner`
// already uses in membership-lifecycle-service.js. The reason lands on the row
// (`sodOverrideReason`) and in the audit payload, never silently.
async function assertNoConflict(db, { personId, tenantId, roleKey, viewer, sodOverride }) {
  const conflicts = conflictingRoles(roleKey)
  if (!conflicts.length) return null

  // @req FR-196 — every status EXCEPT revoked counts as held. `status: ACTIVE`
  // read the question as "is the conflicting role in effect right now", and the
  // question segregation of duties asks is "does this person hold both". A
  // SUSPENDED binding is still theirs — it comes back with one reactivation —
  // so counting only ACTIVE let the conflict be assembled in three steps:
  // suspend the first role, assign the second (no conflict visible), reactivate
  // the first. Only REVOKED is terminal (ADR-077 D2), so only REVOKED is gone.
  const held = await db.roleBinding.findMany({
    where: { personId, tenantId, status: { not: REVOKED }, roleKey: { in: conflicts } },
    select: { roleKey: true },
  })
  const conflicting = [...new Set(held.map((binding) => binding.roleKey))]
  if (!conflicting.length) return null

  const reason = typeof sodOverride?.reason === 'string' ? sodOverride.reason.trim() : ''
  if (!reason) {
    throw accessError(
      `ROLE_CONFLICT: ${roleKey} conflicts with ${conflicting.join(', ')} already held by this person in this Tenant`,
      409,
    )
  }
  if (!ownsTenant(viewer, tenantId)) {
    throw accessError('Only a Tenant owner may override a segregation-of-duties conflict', 403)
  }
  return { reason, conflicting }
}

/**
 * Create or reactivate one generic Business-scoped role binding. The current
 * authority to assign a binding is Business ownership; Product Owner is only
 * one registered role and does not change the Membership role.
 */
export async function assignRoleBinding(
  { personId, tenantId, businessId, roleKey, scopeType = ROLE_SCOPE_BUSINESS, sodOverride },
  { db = prisma, viewer } = {},
) {
  personId = requireId(personId, 'personId')
  tenantId = requireId(tenantId, 'tenantId')
  businessId = requireId(businessId, 'businessId')
  roleKey = requireKnownRole(roleKey)
  scopeType = requireBusinessScope(scopeType)
  const actorId = requireBusinessOwner(viewer, businessId)

  await assertTargetBusiness(db, tenantId, businessId)
  await assertEmployee(db, personId, tenantId, businessId)

  const override = await assertNoConflict(db, { personId, tenantId, roleKey, viewer, sodOverride })

  // @req FR-192/ADR-077 D3 — `businessId` is nullable on RoleBinding now (a
  // TENANT-scoped row has none), which retired the `@@unique([personId,
  // businessId, roleKey])` index this used to key on: NULLs would no longer
  // have deduplicated a TENANT row anyway (Postgres treats them as distinct).
  // `assignRoleBinding` only ever assigns BUSINESS scope (`requireBusinessScope`
  // above), so `businessId` here is always a concrete value and `findFirst` is
  // exactly as precise as the retired unique lookup.
  const existing = await db.roleBinding.findFirst({
    where: { personId, businessId, roleKey },
  })
  if (existing && existing.tenantId !== tenantId) {
    throw accessError('Tenant/Business ancestry mismatch', 400)
  }

  const binding = existing
    ? await db.roleBinding.update({
        where: { id: existing.id },
        data: {
          scopeType, status: ACTIVE, revokedAt: null, assignedBy: actorId,
          sodOverrideReason: override?.reason ?? null, version: { increment: 1 },
        },
      })
    : await db.roleBinding.create({
        data: {
          personId, tenantId, businessId, roleKey, scopeType, status: ACTIVE, assignedBy: actorId,
          sodOverrideReason: override?.reason ?? null,
        },
      })

  await recordAudit(db, {
    entityType: 'ROLE_BINDING',
    entityId: binding.id,
    action: existing ? 'ROLE_BINDING_REACTIVATED' : 'ROLE_BINDING_ASSIGNED',
    actorId,
    payload: {
      tenantId, businessId, personId, roleKey, scopeType, status: ACTIVE,
      ...(override ? { sodOverride: true, sodOverrideReason: override.reason, conflictsWith: override.conflicting } : {}),
    },
  })

  return binding
}

/** Change one binding's lifecycle state; revocation does not affect other Businesses. */
export async function updateRoleBindingStatus(
  bindingId,
  status,
  { db = prisma, viewer, sodOverride } = {},
) {
  bindingId = requireId(bindingId, 'bindingId')
  if (!ALLOWED_STATUSES.has(status)) throw accessError('Invalid RoleBinding status')

  const existing = await db.roleBinding.findUnique({ where: { id: bindingId } })
  if (!existing) throw accessError('RoleBinding not found', 404)
  const actorId = requireBusinessOwner(viewer, existing.businessId)

  // @req FR-196 — bringing a binding back to ACTIVE is an assignment, and has
  // to clear the gate an assignment clears. Without this, a Business owner —
  // who ADR-079 D2 deliberately does not let override a conflict — could
  // assemble one anyway: suspend role A, assign conflicting role B through
  // `assignRoleBinding` (A is not ACTIVE, so nothing objects), then reactivate
  // A through this function, which asked nothing. The person ends up holding
  // both with no `sodOverrideReason` recorded anywhere, which is the evidence
  // BR-035 exists to produce.
  //
  // Only the transition INTO ACTIVE is gated: suspending and revoking narrow
  // authority and never need an override.
  const reactivating = status === ACTIVE && existing.status !== ACTIVE
  const override = reactivating
    ? await assertNoConflict(db, {
      personId: existing.personId,
      tenantId: existing.tenantId,
      roleKey: existing.roleKey,
      viewer,
      sodOverride,
    })
    : null

  const binding = await db.roleBinding.update({
    where: { id: bindingId },
    data: {
      status,
      revokedAt: status === REVOKED ? new Date() : null,
      // A reason belongs to the act that needed it. Carrying the previous
      // override forward would credit this reactivation to whoever justified
      // the last one, so it is rewritten on every transition into ACTIVE and
      // cleared when the binding leaves it.
      ...(reactivating ? { sodOverrideReason: override?.reason ?? null } : {}),
      ...(status !== ACTIVE ? { sodOverrideReason: null } : {}),
      version: { increment: 1 },
    },
  })

  await recordAudit(db, {
    entityType: 'ROLE_BINDING',
    entityId: binding.id,
    action: auditActionFor(status),
    actorId,
    payload: {
      tenantId: existing.tenantId,
      businessId: existing.businessId,
      personId: existing.personId,
      roleKey: existing.roleKey,
      scopeType: existing.scopeType,
      status,
      ...(override
        ? { sodOverride: true, sodOverrideReason: override.reason, conflictsWith: override.conflicting }
        : {}),
    },
  })

  return binding
}

export { ACTIVE, SUSPENDED, REVOKED, ROLE_PRODUCT_OWNER }
