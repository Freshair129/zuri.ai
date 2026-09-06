// @req FR-137, FR-138 — exact-Business receiver and reviewer capabilities.
// @spec SEC-024, ADR-056 D6
// @tested tests/unit/asset-evidence-intake-service-contract.test.js
import { ownsBusiness } from '@/modules/identity/viewer-authority'
import { hasPermission, ASSET_INTAKE_WRITE_PERMISSION, ASSET_EVIDENCE_REVIEW_PERMISSION } from '@/modules/identity/rbac'

export function canWriteAssetIntake(viewer, businessId) {
  return ownsBusiness(viewer, businessId) || hasPermission(viewer, businessId, ASSET_INTAKE_WRITE_PERMISSION)
}

export function canReviewAssetEvidence(viewer, businessId) {
  return ownsBusiness(viewer, businessId) || hasPermission(viewer, businessId, ASSET_EVIDENCE_REVIEW_PERMISSION)
}

export function assertAssetIntakeWrite(viewer, businessId) {
  if (!canWriteAssetIntake(viewer, businessId)) {
    const error = new Error('Asset intake not found')
    error.status = 404
    throw error
  }
}

export function assertAssetEvidenceReview(viewer, businessId) {
  if (!canReviewAssetEvidence(viewer, businessId)) {
    const error = new Error('Asset evidence not found')
    error.status = 404
    throw error
  }
}
