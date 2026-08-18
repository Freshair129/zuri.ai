// @req FR-076 — role bindings resolve through a generic role and permission registry.
// @spec ADR-033 D3-D5 — Product Owner is a Business-scoped RBAC role, not an owner type.
// @tested tests/unit/fr076-product-owner-business-assignment.test.js

export const ROLE_PRODUCT_OWNER = 'PRODUCT_OWNER'
export const ROLE_SCOPE_BUSINESS = 'BUSINESS'
export const PRODUCT_MANAGE_PERMISSION = 'product.work.write'

export const ROLE_PERMISSIONS = Object.freeze({
  [ROLE_PRODUCT_OWNER]: Object.freeze([
    'product.read',
    'product.plan.write',
    'product.decision.write',
    PRODUCT_MANAGE_PERMISSION,
  ]),
})

export function permissionsForRoles(roleKeys) {
  if (!Array.isArray(roleKeys)) return []
  return [...new Set(roleKeys.flatMap((roleKey) => ROLE_PERMISSIONS[roleKey] || []))]
}

/**
 * Evaluate one permission at the selected Business only. No global role,
 * visibility, platform flag or ownership field can widen this decision.
 */
export function hasPermission(viewer, businessId, permission) {
  if (!viewer || typeof businessId !== 'string' || !businessId || typeof permission !== 'string' || !permission) {
    return false
  }
  const permissions = viewer.permissionsByBusinessId?.[businessId]
  return Array.isArray(permissions) && permissions.includes(permission)
}
