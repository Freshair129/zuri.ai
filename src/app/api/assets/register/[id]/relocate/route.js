// @req FR-133, FR-135 — Asset relocation route.
// @spec SDD-078, SDD-080, SEC-023, SEC-024, ADR-055
// @tested tests/unit/asset-lifecycle-routes.test.js
import { NextResponse } from 'next/server'
import { resolveRequestViewer } from '@/modules/identity/request-viewer'
import { resolveAssetRequestScope } from '@/modules/asset-management/application/asset-request-scope'
import { relocateAsset } from '@/modules/asset-management/application/asset-lifecycle-service'

function jsonError(error) {
  const status = error.status || 500
  return NextResponse.json({ error: error.message || 'Internal server error' }, { status })
}

export async function POST(request, { params }) {
  try {
    const { id } = await params
    const body = await request.json()
    const { businessId, branchId, locationCode, locationName, isPrimary, effectiveFrom, note } = body || {}

    if (!businessId || !id || !locationCode || !locationName) {
      return NextResponse.json({ error: 'businessId, asset id, locationCode, and locationName are required' }, { status: 400 })
    }

    const viewer = await resolveRequestViewer(request)
    const { business } = await resolveAssetRequestScope(request, businessId, { capability: 'write', viewer })

    const location = await relocateAsset({
      registeredAssetId: id,
      businessId: business.id,
      branchId,
      locationCode,
      locationName,
      isPrimary,
      effectiveFrom,
      note,
      viewer,
    })

    return NextResponse.json({ location }, { status: 201 })
  } catch (error) {
    return jsonError(error)
  }
}
