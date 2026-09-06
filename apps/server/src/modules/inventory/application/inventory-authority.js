import { ownsBusiness, seesBusiness } from '@/modules/identity/viewer-authority'
import { hasPermission, INVENTORY_MANAGE_PERMISSION } from '@/modules/identity/rbac'
import { assertDomainVisible } from '@/modules/identity/viewer-domains'
import { INVENTORY_DOMAIN_KEY } from '../domain/inventory'

// @req FR-154 — the authorization ladder of the Inventory domain: view needs
//   Business visibility plus the `inventory` domain (FR-061); every write —
//   catalogue rows, lots, movements — needs Business OWNER or the
//   INVENTORY_MANAGER role binding (FR-076 pattern). Every refusal is the same
//   404 an unknown Business gets (FR-072), so the surface is no oracle for
//   which Businesses or products exist. `businessId` is a selector the service
//   validates against the trusted viewer, never the scope.
// @spec SEC-001, BR-020, SEC-018
// @tested tests/integration/fr154-inventory-catalog.test.js

export function notFound() {
  const error = new Error('Business not found')
  error.status = 404
  return error
}

export function mayView(viewer, businessId) {
  if (!seesBusiness(viewer, businessId)) return false
  try {
    assertDomainVisible(viewer, businessId, INVENTORY_DOMAIN_KEY)
    return true
  } catch {
    return false
  }
}

export function assertMayView(viewer, businessId) {
  if (!mayView(viewer, businessId)) throw notFound()
}

/**
 * Ownership, or the confirmed manager role resolved by `resolveViewer` into
 * `permissionsByBusinessId`. A global role label, platform visibility or a
 * payload value cannot widen this (BR-020).
 */
export function mayManage(viewer, businessId) {
  return ownsBusiness(viewer, businessId) || hasPermission(viewer, businessId, INVENTORY_MANAGE_PERMISSION)
}

export function assertMayManage(viewer, businessId) {
  assertMayView(viewer, businessId)
  if (!mayManage(viewer, businessId)) throw notFound()
}

/** The Business a request names, once the viewer is allowed to see it; never trusted from the payload alone. */
export async function loadBusiness(db, viewer, businessId, { write = false } = {}) {
  const id = typeof businessId === 'string' ? businessId.trim() : ''
  if (!id) throw notFound()
  if (write) assertMayManage(viewer, id)
  else assertMayView(viewer, id)
  const business = await db.business.findUnique({ where: { id }, select: { id: true, tenantId: true } })
  if (!business) throw notFound()
  return business
}
