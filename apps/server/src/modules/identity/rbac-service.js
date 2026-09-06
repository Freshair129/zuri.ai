import prisma from '@/lib/db'
import { recordAudit } from '@/modules/project-manager/application/audit'
import { ROLE_PERMISSIONS, ROLE_PRODUCT_OWNER, ROLE_SCOPE_BUSINESS } from './rbac'

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

/**
 * Create or reactivate one generic Business-scoped role binding. The current
 * authority to assign a binding is Business ownership; Product Owner is only
 * one registered role and does not change the Membership role.
 */
export async function assignRoleBinding(
  { personId, tenantId, businessId, roleKey, scopeType = ROLE_SCOPE_BUSINESS },
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

  const existing = await db.roleBinding.findUnique({
    where: { personId_businessId_roleKey: { personId, businessId, roleKey } },
  })
  if (existing && existing.tenantId !== tenantId) {
    throw accessError('Tenant/Business ancestry mismatch', 400)
  }

  const binding = existing
    ? await db.roleBinding.update({
        where: { id: existing.id },
        data: { scopeType, status: ACTIVE, revokedAt: null, assignedBy: actorId, version: { increment: 1 } },
      })
    : await db.roleBinding.create({
        data: { personId, tenantId, businessId, roleKey, scopeType, status: ACTIVE, assignedBy: actorId },
      })

  await recordAudit(db, {
    entityType: 'ROLE_BINDING',
    entityId: binding.id,
    action: existing ? 'ROLE_BINDING_REACTIVATED' : 'ROLE_BINDING_ASSIGNED',
    actorId,
    payload: { tenantId, businessId, personId, roleKey, scopeType, status: ACTIVE },
  })

  return binding
}

/** Change one binding's lifecycle state; revocation does not affect other Businesses. */
export async function updateRoleBindingStatus(
  bindingId,
  status,
  { db = prisma, viewer } = {},
) {
  bindingId = requireId(bindingId, 'bindingId')
  if (!ALLOWED_STATUSES.has(status)) throw accessError('Invalid RoleBinding status')

  const existing = await db.roleBinding.findUnique({ where: { id: bindingId } })
  if (!existing) throw accessError('RoleBinding not found', 404)
  const actorId = requireBusinessOwner(viewer, existing.businessId)

  const binding = await db.roleBinding.update({
    where: { id: bindingId },
    data: {
      status,
      revokedAt: status === REVOKED ? new Date() : null,
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
    },
  })

  return binding
}

export { ACTIVE, SUSPENDED, REVOKED, ROLE_PRODUCT_OWNER }
