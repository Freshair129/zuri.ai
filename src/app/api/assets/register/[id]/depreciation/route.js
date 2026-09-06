// @req FR-136 — deterministic Asset depreciation preview endpoint.
// @spec SDD-080, NFR-021, BR-023, ADR-055
// @tested tests/unit/asset-maintenance-routes.test.js
import { NextResponse } from 'next/server'
import { resolveRequestViewer } from '@/modules/identity/request-viewer'
import { resolveAssetRequestScope } from '@/modules/asset-management/application/asset-request-scope'
import { getOrCreateAssetDepreciationCandidate } from '@/modules/asset-management/application/asset-depreciation-service'

export async function GET(request, context) {
  try {
    const { id } = await context.params
    const { searchParams } = new URL(request.url)
    const businessId = searchParams.get('businessId')
    const usefulLifeMonths = searchParams.get('usefulLifeMonths') || 36
    const residualValue = searchParams.get('residualValue') || '0.00'
    const recalculate = searchParams.get('recalculate') === 'true'

    const { viewer, business } = await resolveAssetRequestScope(request, businessId, { capability: 'read' })

    const result = await getOrCreateAssetDepreciationCandidate({
      businessId: business.id,
      registeredAssetId: id,
      usefulLifeMonths: parseInt(usefulLifeMonths, 10),
      residualValue,
      recalculate,
      viewer,
    })

    return NextResponse.json(result, { status: 200 })
  } catch (error) {
    return NextResponse.json(
      { error: error.message || 'Failed to calculate depreciation' },
      { status: error.status || 500 }
    )
  }
}
