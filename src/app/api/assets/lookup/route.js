// @req FR-133, FR-135 — fast QR token lookup and physical asset verification endpoint.
// @spec SDD-078, SDD-080, BR-023, SEC-023, ADR-055
// @tested tests/unit/asset-lookup-routes.test.js
import { NextResponse } from 'next/server'
import { resolveRequestViewer } from '@/modules/identity/request-viewer'
import { resolveAssetRequestScope } from '@/modules/asset-management/application/asset-request-scope'
import { lookupAssetByQrOrCode } from '@/modules/asset-management/application/asset-lookup-service'

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url)
    const businessId = searchParams.get('businessId')
    const codeOrToken = searchParams.get('code') || searchParams.get('token') || searchParams.get('id') || ''

    if (!codeOrToken) {
      return NextResponse.json(
        { error: 'Asset code, QR payload, or ID is required' },
        { status: 400 }
      )
    }

    const { business } = await resolveAssetRequestScope(request, businessId, { capability: 'read' })

    const result = await lookupAssetByQrOrCode({
      businessId: business.id,
      codeOrToken,
    })

    return NextResponse.json(result, { status: 200 })
  } catch (error) {
    return NextResponse.json(
      { error: error.message || 'Failed to lookup asset' },
      { status: error.status || 500 }
    )
  }
}
