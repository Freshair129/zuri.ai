// @req FR-076, FR-078 — role bindings resolve through a generic role and permission registry.
// @spec ADR-033 D3-D5 — Product Owner is a Business-scoped RBAC role, not an owner type.
// @tested tests/unit/fr076-product-owner-business-assignment.test.js, tests/unit/customer-import-review-service.test.js

export const ROLE_PRODUCT_OWNER = 'PRODUCT_OWNER'
export const ROLE_CUSTOMER_DATA_REVIEWER = 'CUSTOMER_DATA_REVIEWER'
export const ROLE_ASSET_RECEIVER = 'ASSET_RECEIVER'
export const ROLE_ASSET_REVIEWER = 'ASSET_REVIEWER'
// @req FR-146 — the LINE OA Studio publisher (ADR-060 D7/D11), a key the owner
// confirmed on 2026-09-05. Business-scoped like every role here; a Business
// OWNER holds the same capability implicitly and needs no binding.
export const ROLE_LINE_OA_PUBLISHER = 'LINE_OA_PUBLISHER'
export const ROLE_SCOPE_BUSINESS = 'BUSINESS'
export const PRODUCT_MANAGE_PERMISSION = 'product.work.write'
export const CUSTOMER_REVIEW_READ_PERMISSION = 'customer.import.review.read'
export const CUSTOMER_REVIEW_DECIDE_PERMISSION = 'customer.import.review.decide'
export const ASSET_INTAKE_WRITE_PERMISSION = 'asset.intake.write'
export const ASSET_EVIDENCE_REVIEW_PERMISSION = 'asset.evidence.review'
export const LINE_OA_PUBLISH_PERMISSION = 'line-oa.account.publish'

export const ROLE_PERMISSIONS = Object.freeze({
  [ROLE_PRODUCT_OWNER]: Object.freeze([
    'product.read',
    'product.plan.write',
    'product.decision.write',
    PRODUCT_MANAGE_PERMISSION,
  ]),
  [ROLE_CUSTOMER_DATA_REVIEWER]: Object.freeze([
    CUSTOMER_REVIEW_READ_PERMISSION,
    CUSTOMER_REVIEW_DECIDE_PERMISSION,
  ]),
  [ROLE_ASSET_RECEIVER]: Object.freeze([
    'asset.read',
    ASSET_INTAKE_WRITE_PERMISSION,
  ]),
  [ROLE_ASSET_REVIEWER]: Object.freeze([
    'asset.read',
    ASSET_EVIDENCE_REVIEW_PERMISSION,
  ]),
  [ROLE_LINE_OA_PUBLISHER]: Object.freeze([
    'line-oa.read',
    LINE_OA_PUBLISH_PERMISSION,
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
