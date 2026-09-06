// @req FR-133, FR-135 — Asset Register single item and history query route.
// @spec SDD-078, SDD-080, SEC-023, SEC-024, ADR-055
// @tested tests/unit/asset-register-routes.test.js
import { NextResponse } from 'next/server'
import { resolveAssetRequestScope } from '@/modules/asset-management/application/asset-request-scope'
import { getRegisteredAssetById } from '@/modules/asset-management/application/asset-register-service'

function jsonError(error) {
  const status = error.status || 500
  return NextResponse.json({ error: error.message || 'Internal server error' }, { status })
}

export async function GET(request, { params }) {
  try {
    const { id } = await params
    const { searchParams } = new URL(request.url)
    const businessId = searchParams.get('businessId')

    if (!businessId || !id) {
      return NextResponse.json({ error: 'businessId and id are required' }, { status: 400 })
    }

    const { business } = await resolveAssetRequestScope(request, businessId, { capability: 'read' })
    const asset = await getRegisteredAssetById({
      businessId: business.id,
      id,
    })

    return NextResponse.json({ asset })
  } catch (error) {
    return jsonError(error)
  }
}
