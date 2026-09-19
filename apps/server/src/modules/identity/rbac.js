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
// @req FR-154 — the Inventory manager (คลังสินค้า): the Business-scoped role
// that may write catalogue identity and stock movements. A Business OWNER
// holds the same capability implicitly and needs no binding.
export const ROLE_INVENTORY_MANAGER = 'INVENTORY_MANAGER'
// @req FR-161 — the sales representative: the Business-scoped role that may
// write sales tasks (follow-ups owed to customers) in the crm lane. A Business
// OWNER holds the same capability implicitly and needs no binding.
export const ROLE_SALES_REP = 'SALES_REP'
// @req FR-163 — the payment verifier: the Business-scoped role that confirms
// or rejects a payment slip (commerce). A SALES_REP records payments; only a
// verifier or the Business OWNER turns PENDING into VERIFIED, because verified
// payments are what revenue is counted from (ADR-065).
export const ROLE_PAYMENT_VERIFIER = 'PAYMENT_VERIFIER'
// @req FR-164 — the procurement buyer: the Business-scoped role that keeps
// suppliers and purchase orders (`procurement.po.write`).
// @req FR-196/ADR-079 — amends ADR-066 D4. `PROCUREMENT_BUYER` held both
// `procurement.po.write` and `procurement.receipt.post` until this change,
// which made three-way match (a different person orders, receives and pays)
// impossible by construction — the same role could always receive its own
// order. Posting is split into ROLE_GOODS_RECEIVER below, and the two are
// declared conflicting in ROLE_CONFLICTS.
export const ROLE_PROCUREMENT_BUYER = 'PROCUREMENT_BUYER'
// @req FR-196 — the goods receiver: the Business-scoped role that posts
// receipts against a purchase order it did not write (`procurement.receipt.post`).
// Posting a receipt writes RECEIPT rows into the Inventory ledger, and that
// half needs Inventory's own write authority (OWNER or INVENTORY_MANAGER) —
// neither procurement role ever widens the ledger (ADR-066 D4).
export const ROLE_GOODS_RECEIVER = 'GOODS_RECEIVER'
export const ROLE_SCOPE_BUSINESS = 'BUSINESS'
// @req FR-192/ADR-077 D3 — RoleBinding's second scope, "every Business in the
// Tenant", extending ADR-033 D3 rather than superseding it (BRANCH is
// declared in ROLE_BINDING_SCOPE_TYPES but resolved by nothing yet).
export const ROLE_SCOPE_TENANT = 'TENANT'
export const PRODUCT_MANAGE_PERMISSION = 'product.work.write'
export const CUSTOMER_REVIEW_READ_PERMISSION = 'customer.import.review.read'
export const CUSTOMER_REVIEW_DECIDE_PERMISSION = 'customer.import.review.decide'
export const ASSET_INTAKE_WRITE_PERMISSION = 'asset.intake.write'
export const ASSET_EVIDENCE_REVIEW_PERMISSION = 'asset.evidence.review'
export const LINE_OA_PUBLISH_PERMISSION = 'line-oa.account.publish'
export const INVENTORY_MANAGE_PERMISSION = 'inventory.catalog.write'
export const SALES_TASK_WRITE_PERMISSION = 'crm.sales-task.write'
export const ORDER_WRITE_PERMISSION = 'commerce.order.write'
export const PAYMENT_VERIFY_PERMISSION = 'commerce.payment.verify'
export const PURCHASE_ORDER_WRITE_PERMISSION = 'procurement.po.write'
export const GOODS_RECEIPT_POST_PERMISSION = 'procurement.receipt.post'

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
  [ROLE_INVENTORY_MANAGER]: Object.freeze([
    'inventory.read',
    INVENTORY_MANAGE_PERMISSION,
  ]),
  [ROLE_SALES_REP]: Object.freeze([
    'crm.read',
    SALES_TASK_WRITE_PERMISSION,
    // @req FR-166 — a rep also writes the orders they close and records the
    // payments customers send; verifying those payments is a different hat.
    'commerce.read',
    ORDER_WRITE_PERMISSION,
  ]),
  [ROLE_PAYMENT_VERIFIER]: Object.freeze([
    'commerce.read',
    PAYMENT_VERIFY_PERMISSION,
  ]),
  [ROLE_PROCUREMENT_BUYER]: Object.freeze([
    'procurement.read',
    PURCHASE_ORDER_WRITE_PERMISSION,
  ]),
  [ROLE_GOODS_RECEIVER]: Object.freeze([
    'procurement.read',
    GOODS_RECEIPT_POST_PERMISSION,
  ]),
})

// @req FR-196 — segregation of duties: roles whose PERMISSIONS conflict, in
// that holding both lets one person complete a cycle the pairing exists to
// keep two-person. Symmetric and small on purpose: this is a declared list an
// owner can read, not a derived graph. `assignRoleBinding` refuses 409
// ROLE_CONFLICT when the person already holds (or is being given) both halves
// of a pair in the same Tenant, unless a tenant owner passes `sodOverride`.
// @spec ADR-065 D4 (SALES_REP/PAYMENT_VERIFIER), ADR-066 D4 as amended by
// ADR-079 (PROCUREMENT_BUYER/GOODS_RECEIVER)
export const ROLE_CONFLICTS = Object.freeze([
  Object.freeze(['SALES_REP', 'PAYMENT_VERIFIER']),
  Object.freeze([ROLE_PROCUREMENT_BUYER, ROLE_GOODS_RECEIVER]),
])

/** The OTHER role keys `roleKey` conflicts with, per ROLE_CONFLICTS. */
export function conflictingRoles(roleKey) {
  const out = new Set()
  for (const pair of ROLE_CONFLICTS) {
    if (!pair.includes(roleKey)) continue
    for (const other of pair) if (other !== roleKey) out.add(other)
  }
  return [...out]
}

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
