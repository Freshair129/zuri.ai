import prisma from '@/lib/db'
import { permissionsForRoles, ROLE_PERMISSIONS, ROLE_SCOPE_BUSINESS } from './rbac'

// @req FR-094, FR-096, FR-098 — one identity-owned policy context for web/API,
// agent and tool work. Scope is resolved from live server state before a caller
// may read, retrieve or mutate anything.
// @spec ADR-045 D1-D4, SDD-052, BR-020, SEC-018
// @tested tests/unit/authorization-context.test.js, tests/integration/iam-authorization.test.js

const ACTIVE = 'ACTIVE'

function clean(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function unique(values) {
  return [...new Set(values.filter(Boolean))]
}

function membershipMatchesBusiness(membership, businessId) {
  if (!businessId) return membership.businessId == null
  return membership.businessId == null || membership.businessId === businessId
}

function deny(reason, details = {}) {
  return {
    allowed: false,
    reason,
    ...details,
  }
}

/**
 * Resolve the immutable authorization input for one request/turn.
 *
 * A null businessId means a Tenant-scoped request and therefore requires a
 * tenant-wide Membership. A Business-scoped request may use either a matching
 * Business Membership or a tenant-wide Membership. RoleBinding permissions are
 * read only for the selected Business and never widen the Membership scope.
 */
export async function resolveAuthorizationContext({
  personId,
  tenantId,
  businessId = null,
  action = 'READ',
  permission = null,
  ownerPersonId = null,
  db = prisma,
} = {}) {
  const principalId = clean(personId)
  const resolvedTenantId = clean(tenantId)
  const resolvedBusinessId = clean(businessId)
  const requestedPermission = clean(permission)
  const requestedAction = clean(action) ?? 'READ'

  const base = {
    actor: { personId: principalId },
    scope: { tenantId: resolvedTenantId, businessId: resolvedBusinessId },
    action: requestedAction,
    permission: requestedPermission,
    memberships: [],
    roles: [],
    permissions: [],
    owner: false,
  }

  if (!principalId || !resolvedTenantId) return { ...base, decision: deny('IDENTITY_REQUIRED') }

  const [person, tenant] = await Promise.all([
    db.person.findUnique({ where: { id: principalId }, select: { id: true } }),
    db.tenant.findUnique({ where: { id: resolvedTenantId }, select: { id: true, status: true } }),
  ])
  if (!person) return { ...base, decision: deny('PRINCIPAL_NOT_FOUND') }
  if (!tenant || tenant.status !== ACTIVE) return { ...base, decision: deny('TENANT_SCOPE_DENIED') }

  let business = null
  if (resolvedBusinessId) {
    business = await db.business.findUnique({
      where: { id: resolvedBusinessId },
      select: { id: true, tenantId: true, status: true },
    })
    if (!business || business.tenantId !== resolvedTenantId || business.status !== ACTIVE) {
      return { ...base, decision: deny('BUSINESS_SCOPE_DENIED') }
    }
  }

  const memberships = await db.membership.findMany({
    where: { personId: principalId, tenantId: resolvedTenantId, status: ACTIVE },
    select: {
      id: true,
      tenantId: true,
      businessId: true,
      branchId: true,
      role: true,
      status: true,
      domainKeysJson: true,
      version: true,
    },
  })
  const scopedMemberships = memberships.filter((membership) => membershipMatchesBusiness(membership, resolvedBusinessId))

  let bindings = []
  if (resolvedBusinessId && typeof db.roleBinding?.findMany === 'function') {
    bindings = await db.roleBinding.findMany({
      where: {
        personId: principalId,
        tenantId: resolvedTenantId,
        businessId: resolvedBusinessId,
        scopeType: ROLE_SCOPE_BUSINESS,
        status: ACTIVE,
      },
      select: { roleKey: true, businessId: true, tenantId: true, scopeType: true, status: true },
    })
    bindings = bindings.filter((binding) =>
      binding.tenantId === resolvedTenantId &&
      binding.businessId === resolvedBusinessId &&
      binding.scopeType === ROLE_SCOPE_BUSINESS &&
      binding.status === ACTIVE &&
      Boolean(ROLE_PERMISSIONS[binding.roleKey]),
    )
  }

  const membershipRoles = scopedMemberships.map((membership) => membership.role)
  const bindingRoles = bindings.map((binding) => binding.roleKey)
  const roles = unique([...membershipRoles, ...bindingRoles])
  const permissions = permissionsForRoles(bindingRoles)
  const owner = clean(ownerPersonId) === principalId
  const hasMembership = scopedMemberships.length > 0
  const subjectAllowed = hasMembership || owner
  const permissionAllowed = !requestedPermission || permissions.includes(requestedPermission)
  const decision = !subjectAllowed
    ? deny('MEMBERSHIP_SCOPE_DENIED')
    : !permissionAllowed
      ? deny('PERMISSION_DENIED')
      : {
          allowed: true,
          reason: owner && !hasMembership ? 'OWNER_RESOURCE_ALLOWED' : 'ACTIVE_MEMBERSHIP_ALLOWED',
        }

  return Object.freeze({
    actor: Object.freeze({ personId: principalId }),
    scope: Object.freeze({ tenantId: resolvedTenantId, businessId: resolvedBusinessId }),
    action: requestedAction,
    permission: requestedPermission,
    memberships: Object.freeze(scopedMemberships),
    roleBindings: Object.freeze(bindings),
    roles: Object.freeze(roles),
    permissions: Object.freeze(permissions),
    owner,
    decision: Object.freeze(decision),
    business,
  })
}

/**
 * Evaluate an already-resolved context without doing I/O. Callers may only
 * attenuate it with a narrower Business/permission/role requirement.
 */
export function authorizeScope(context, {
  action = 'READ',
  businessId = null,
  permission = null,
  requiredRoles = [],
  ownerPersonId = null,
} = {}) {
  if (!context?.decision || context.decision.allowed !== true) {
    if (
      context?.decision?.reason === 'MEMBERSHIP_SCOPE_DENIED' &&
      clean(ownerPersonId) &&
      clean(ownerPersonId) === context.actor?.personId
    ) {
      return { allowed: true, reason: 'OWNER_RESOURCE_ALLOWED' }
    }
    return context?.decision ?? deny('AUTHORIZATION_CONTEXT_REQUIRED')
  }

  const requestedBusinessId = clean(businessId)
  if (requestedBusinessId && requestedBusinessId !== context.scope?.businessId) {
    return deny('BUSINESS_SCOPE_MISMATCH')
  }

  const requestedPermission = clean(permission)
  if (requestedPermission && !context.permissions?.includes(requestedPermission)) {
    return deny('PERMISSION_DENIED')
  }

  const roles = Array.isArray(requiredRoles) ? requiredRoles.filter((role) => typeof role === 'string') : []
  if (roles.length && !roles.some((role) => context.roles?.includes(role))) {
    const ownerAllowed = clean(ownerPersonId) === context.actor?.personId && action !== 'READ'
    if (!ownerAllowed) return deny('ROLE_DENIED')
  }

  return { allowed: true, reason: 'AUTHORIZED' }
}

export { ACTIVE as ACTIVE_MEMBERSHIP_STATUS, membershipMatchesBusiness }
