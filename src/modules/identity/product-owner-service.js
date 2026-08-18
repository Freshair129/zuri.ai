import { assignRoleBinding, updateRoleBindingStatus } from './rbac-service'
import { ROLE_PRODUCT_OWNER } from './rbac'

// @req FR-076 — Product Owner uses the generic RoleBinding service.
// @spec ADR-033 D3-D5 — this compatibility seam cannot create a separate owner model.
// @tested tests/unit/fr076-product-owner-business-assignment.test.js

/** @deprecated Use assignRoleBinding({ roleKey: ROLE_PRODUCT_OWNER }). */
export function assignProductOwner(input, options) {
  return assignRoleBinding({ ...input, roleKey: ROLE_PRODUCT_OWNER }, options)
}

/** @deprecated Use updateRoleBindingStatus(bindingId, status). */
export function updateProductOwnerAssignmentStatus(bindingId, status, options) {
  return updateRoleBindingStatus(bindingId, status, options)
}
