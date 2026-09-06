import { ownsBusiness, seesBusiness } from '@/modules/identity/viewer-authority'
import { hasPermission, LINE_OA_PUBLISH_PERMISSION } from '@/modules/identity/rbac'
import { assertDomainVisible } from '@/modules/identity/viewer-domains'
import { LINE_OA_DOMAIN_KEY } from '../domain/line-oa-account'

// @req FR-146 — the authorization ladder of the LINE OA Studio account
//   aggregate: view needs Business visibility plus the `line-oa` domain
//   (FR-061); connect, pause, archive, default and mode override need Business
//   OWNER or the LINE_OA_PUBLISHER role binding (FR-076 pattern). Every refusal
//   is the same 404 an unknown Business gets (FR-072), so the surface is no
//   oracle for which Businesses or accounts exist.
// @spec ADR-060 D11, SEC-001, BR-020, SEC-018
// @tested tests/integration/fr146-line-oa-account.test.js

export function notFound() {
  const error = new Error('Business not found')
  error.status = 404
  return error
}

/** May this viewer read LINE OA Studio state for this Business? */
export function mayView(viewer, businessId) {
  if (!seesBusiness(viewer, businessId)) return false
  try {
    assertDomainVisible(viewer, businessId, LINE_OA_DOMAIN_KEY)
    return true
  } catch {
    return false
  }
}

export function assertMayView(viewer, businessId) {
  if (!mayView(viewer, businessId)) throw notFound()
}

/**
 * May this viewer publish — connect, pause, resume, archive, set the default,
 * switch transport — for this Business? Ownership, or the confirmed publisher
 * role resolved by `resolveViewer` into `permissionsByBusinessId`. A global role
 * label, platform visibility or payload value cannot widen this (BR-020).
 */
export function mayPublish(viewer, businessId) {
  return ownsBusiness(viewer, businessId) || hasPermission(viewer, businessId, LINE_OA_PUBLISH_PERMISSION)
}

export function assertMayPublish(viewer, businessId) {
  assertMayView(viewer, businessId)
  if (!mayPublish(viewer, businessId)) throw notFound()
}
