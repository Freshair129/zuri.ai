import { ownsBusiness, seesBusiness } from '@/modules/identity/viewer-authority'
import { GOODS_RECEIPT_POST_PERMISSION, hasPermission, PURCHASE_ORDER_WRITE_PERMISSION } from '@/modules/identity/rbac'
import { assertDomainVisible } from '@/modules/identity/viewer-domains'
import { PROCUREMENT_DOMAIN_KEY } from '../domain/procurement'

// @req FR-164 — the authorization ladder of the Procurement lane: view needs
//   Business visibility plus the `procurement` domain (FR-061); keeping
//   suppliers and purchase orders needs Business OWNER or the
//   PROCUREMENT_BUYER binding (`procurement.po.write`).
// @req FR-165 — posting a goods receipt needs Business OWNER or the buyer's
//   `procurement.receipt.post`; the stock rows it writes need Inventory's own
//   write authority on top, checked by the receipt service through Inventory's
//   exported `mayManage` — a buyer's binding never widens the ledger (ADR-066
//   D4). Every refusal of scope is the same 404 an unknown Business gets
//   (FR-072). `businessId` is a selector the service validates against the
//   trusted viewer, never the scope.
// @spec ADR-066; SEC-001; BR-020; SEC-018
// @tested tests/integration/fr164-procurement.test.js, tests/integration/fr165-goods-receipt.test.js

export function notFound() {
  const error = new Error('Business not found')
  error.status = 404
  return error
}

export function mayView(viewer, businessId) {
  if (!seesBusiness(viewer, businessId)) return false
  try {
    assertDomainVisible(viewer, businessId, PROCUREMENT_DOMAIN_KEY)
    return true
  } catch {
    return false
  }
}

export function assertMayView(viewer, businessId) {
  if (!mayView(viewer, businessId)) throw notFound()
}

export function mayWritePurchaseOrders(viewer, businessId) {
  return ownsBusiness(viewer, businessId) || hasPermission(viewer, businessId, PURCHASE_ORDER_WRITE_PERMISSION)
}

export function mayPostReceipts(viewer, businessId) {
  return ownsBusiness(viewer, businessId) || hasPermission(viewer, businessId, GOODS_RECEIPT_POST_PERMISSION)
}

/** The Business a request names, once the viewer holds the capability asked for. */
export async function loadBusiness(db, viewer, businessId, { capability = 'read' } = {}) {
  const id = typeof businessId === 'string' ? businessId.trim() : ''
  if (!id) throw notFound()
  assertMayView(viewer, id)
  if (capability === 'po' && !mayWritePurchaseOrders(viewer, id)) throw notFound()
  if (capability === 'receipt' && !mayPostReceipts(viewer, id)) throw notFound()
  const business = await db.business.findUnique({ where: { id }, select: { id: true, tenantId: true } })
  if (!business) throw notFound()
  return business
}
