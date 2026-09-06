import { ownsBusiness, seesBusiness } from '@/modules/identity/viewer-authority'
import { hasPermission, ORDER_WRITE_PERMISSION, PAYMENT_VERIFY_PERMISSION } from '@/modules/identity/rbac'
import { assertDomainVisible } from '@/modules/identity/viewer-domains'

// @req FR-158 — the authorization ladder of the Commerce lane: view needs
//   Business visibility plus the `commerce` domain (FR-061); writing orders
//   and recording payments needs Business OWNER or the SALES_REP binding
//   (`commerce.order.write`); verifying or rejecting a payment needs Business
//   OWNER or PAYMENT_VERIFIER (`commerce.payment.verify`), because verified
//   payments are what revenue is counted from. Every refusal is the same 404
//   an unknown Business gets (FR-072). `businessId` is a selector the service
//   validates against the trusted viewer, never the scope.
// @spec ADR-065; SEC-001; BR-020; SEC-018
// @tested tests/integration/fr158-sales-order.test.js, tests/integration/fr159-payment.test.js

export const COMMERCE_DOMAIN_KEY = 'commerce'

export function notFound() {
  const error = new Error('Business not found')
  error.status = 404
  return error
}

export function mayView(viewer, businessId) {
  if (!seesBusiness(viewer, businessId)) return false
  try {
    assertDomainVisible(viewer, businessId, COMMERCE_DOMAIN_KEY)
    return true
  } catch {
    return false
  }
}

export function assertMayView(viewer, businessId) {
  if (!mayView(viewer, businessId)) throw notFound()
}

export function mayWriteOrders(viewer, businessId) {
  return ownsBusiness(viewer, businessId) || hasPermission(viewer, businessId, ORDER_WRITE_PERMISSION)
}

export function mayVerifyPayments(viewer, businessId) {
  return ownsBusiness(viewer, businessId) || hasPermission(viewer, businessId, PAYMENT_VERIFY_PERMISSION)
}

/** The Business a request names, once the viewer holds the capability asked for. */
export async function loadBusiness(db, viewer, businessId, { capability = 'read' } = {}) {
  const id = typeof businessId === 'string' ? businessId.trim() : ''
  if (!id) throw notFound()
  assertMayView(viewer, id)
  if (capability === 'order' && !mayWriteOrders(viewer, id)) throw notFound()
  if (capability === 'verify' && !mayVerifyPayments(viewer, id)) throw notFound()
  const business = await db.business.findUnique({ where: { id }, select: { id: true, tenantId: true } })
  if (!business) throw notFound()
  return business
}
