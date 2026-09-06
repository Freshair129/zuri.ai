// @req FR-133, FR-135 — Decommissioning & Disposal endpoint (AM-RQ-070..AM-RQ-073).
// @spec SDD-078, SDD-080, BR-023, SEC-023, ADR-055
// @tested tests/unit/asset-disposal-routes.test.js
import { NextResponse } from 'next/server'
import { resolveRequestViewer } from '@/modules/identity/request-viewer'
import { resolveAssetRequestScope } from '@/modules/asset-management/application/asset-request-scope'
import {
  finalizeAssetDisposal,
  listAssetDisposalLogs,
} from '@/modules/asset-management/application/asset-disposal-service'

export async function GET(request, context) {
  try {
    const { id } = await context.params
    const { searchParams } = new URL(request.url)
    const businessId = searchParams.get('businessId')

    const { business } = await resolveAssetRequestScope(request, businessId, { capability: 'read' })

    const logs = await listAssetDisposalLogs({
      businessId: business.id,
      registeredAssetId: id,
    })

    return NextResponse.json({ items: logs }, { status: 200 })
  } catch (error) {
    return NextResponse.json(
      { error: error.message || 'Failed to list disposal records' },
      { status: error.status || 500 }
    )
  }
}

export async function POST(request, context) {
  try {
    const { id } = await context.params
    const body = await request.json().catch(() => ({}))
    const {
      businessId,
      method = 'SCRAP',
      reason,
      salePrice,
      buyerOrRecipient,
      documentRef,
      evidenceFileAssetId,
    } = body

    const { viewer, business } = await resolveAssetRequestScope(request, businessId, { capability: 'manage' })

    const result = await finalizeAssetDisposal({
      businessId: business.id,
      registeredAssetId: id,
      method,
      reason,
      salePrice,
      buyerOrRecipient,
      documentRef,
      evidenceFileAssetId,
      viewer,
    })

    return NextResponse.json(result, { status: 200 })
  } catch (error) {
    return NextResponse.json(
      { error: error.message || 'Failed to process asset disposal' },
      { status: error.status || 500 }
    )
  }
}
