// @req FR-133, FR-135 — record physical verification / stocktake observation for a registered asset.
// @spec SDD-078, SDD-080, BR-023, SEC-023, ADR-055
// @tested tests/unit/asset-lookup-routes.test.js
import { NextResponse } from 'next/server'
import { resolveRequestViewer } from '@/modules/identity/request-viewer'
import { resolveAssetRequestScope } from '@/modules/asset-management/application/asset-request-scope'
import { verifyAssetObservation } from '@/modules/asset-management/application/asset-lookup-service'

export async function POST(request, context) {
  try {
    const { id } = await context.params
    const body = await request.json().catch(() => ({}))
    const {
      businessId,
      observedBranchId = null,
      observedLocationName = '',
      observedLocationCode = '',
      condition = null,
      notes = '',
      relocateIfMismatch = false,
    } = body

    const { viewer, business } = await resolveAssetRequestScope(request, businessId, { capability: 'manage' })

    const result = await verifyAssetObservation({
      businessId: business.id,
      registeredAssetId: id,
      observedBranchId,
      observedLocationName,
      observedLocationCode,
      condition,
      notes,
      relocateIfMismatch,
      viewer,
    })

    return NextResponse.json(result, { status: 200 })
  } catch (error) {
    return NextResponse.json(
      { error: error.message || 'Failed to verify asset observation' },
      { status: error.status || 500 }
    )
  }
}
