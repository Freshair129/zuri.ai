// @req FR-133, FR-135 — Asset project allocation route.
// @spec SDD-078, SDD-080, SEC-023, SEC-024, ADR-055
// @tested tests/unit/asset-lifecycle-routes.test.js
import { NextResponse } from 'next/server'
import { resolveRequestViewer } from '@/modules/identity/request-viewer'
import { resolveAssetRequestScope } from '@/modules/asset-management/application/asset-request-scope'
import { allocateAssetToProject } from '@/modules/asset-management/application/asset-lifecycle-service'

function jsonError(error) {
  const status = error.status || 500
  return NextResponse.json({ error: error.message || 'Internal server error' }, { status })
}

export async function POST(request, { params }) {
  try {
    const { id } = await params
    const body = await request.json()
    const { businessId, projectId, workstreamId, quantity, exclusive, effectiveFrom, purpose } = body || {}

    if (!businessId || !id || !projectId) {
      return NextResponse.json({ error: 'businessId, asset id, and projectId are required' }, { status: 400 })
    }

    const viewer = await resolveRequestViewer(request)
    const { business } = await resolveAssetRequestScope(request, businessId, { capability: 'write', viewer })

    const allocation = await allocateAssetToProject({
      registeredAssetId: id,
      businessId: business.id,
      projectId,
      workstreamId,
      quantity,
      exclusive,
      effectiveFrom,
      purpose,
      viewer,
    })

    return NextResponse.json({ allocation }, { status: 201 })
  } catch (error) {
    return jsonError(error)
  }
}
