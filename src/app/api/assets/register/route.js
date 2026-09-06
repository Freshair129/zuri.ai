// @req FR-133, FR-135 — Asset Register list and registration apply route.
// @spec SDD-078, SDD-080, SEC-023, SEC-024, ADR-055
// @tested tests/unit/asset-register-routes.test.js
import { NextResponse } from 'next/server'
import { resolveRequestViewer } from '@/modules/identity/request-viewer'
import { resolveAssetRequestScope } from '@/modules/asset-management/application/asset-request-scope'
import { listRegisteredAssets, registerAssetFromIntake } from '@/modules/asset-management/application/asset-register-service'

function jsonError(error) {
  const status = error.status || 500
  return NextResponse.json({ error: error.message || 'Internal server error' }, { status })
}

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url)
    const businessId = searchParams.get('businessId')
    const search = searchParams.get('search') || ''
    const categoryCode = searchParams.get('categoryCode') || ''
    const status = searchParams.get('status') || ''
    const branchId = searchParams.get('branchId') || ''
    const limit = searchParams.get('limit') || 50
    const cursor = searchParams.get('cursor') || null

    if (!businessId) {
      return NextResponse.json({ error: 'businessId is required' }, { status: 400 })
    }

    const { business } = await resolveAssetRequestScope(request, businessId, { capability: 'read' })
    const result = await listRegisteredAssets({
      businessId: business.id,
      search,
      categoryCode,
      status,
      branchId,
      limit,
      cursor,
    })

    return NextResponse.json(result)
  } catch (error) {
    return jsonError(error)
  }
}

export async function POST(request) {
  try {
    const body = await request.json()
    const { businessId, intakeId, assetCode } = body || {}

    if (!businessId || !intakeId) {
      return NextResponse.json({ error: 'businessId and intakeId are required' }, { status: 400 })
    }

    const viewer = await resolveRequestViewer(request)
    const { business } = await resolveAssetRequestScope(request, businessId, { capability: 'write', viewer })
    const registeredAsset = await registerAssetFromIntake({
      businessId: business.id,
      intakeId,
      customAssetCode: assetCode,
      viewer,
    })

    return NextResponse.json({ asset: registeredAsset }, { status: 201 })
  } catch (error) {
    return jsonError(error)
  }
}
