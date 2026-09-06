// @req FR-076 — Product Owner is a generic Business-scoped RBAC role.
// @spec ADR-033 D3-D5 — the Product permission is resolved from RoleBinding,
// separate from Membership.role and platform grants.
// @tested tests/unit/fr076-product-owner-business-assignment.test.js

import { hasPermission, PRODUCT_MANAGE_PERMISSION, ROLE_PRODUCT_OWNER } from './rbac'

export { hasPermission, ROLE_PRODUCT_OWNER }

/**
 * Check Product capability for the selected Business only.
 *
 * The resolver's map is intentionally the only authority input here. A global
 * role, platform flag, visibility, or the convenience id list cannot widen a
 * Business-scoped decision.
 */
export function canManageProduct(viewer, businessId) {
  return hasPermission(viewer, businessId, PRODUCT_MANAGE_PERMISSION)
}
