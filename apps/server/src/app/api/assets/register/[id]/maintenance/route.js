// @req FR-133, FR-135 — Asset maintenance ticketing and service history endpoint.
// @spec SDD-078, SDD-080, BR-023, SEC-023, ADR-055
// @tested tests/unit/asset-maintenance-routes.test.js
import { NextResponse } from 'next/server'
import { resolveRequestViewer } from '@/modules/identity/request-viewer'
import { resolveAssetRequestScope } from '@/modules/asset-management/application/asset-request-scope'
import {
  createMaintenanceLog,
  completeMaintenanceLog,
  listAssetMaintenanceLogs,
} from '@/modules/asset-management/application/asset-maintenance-service'

export async function GET(request, context) {
  try {
    const { id } = await context.params
    const { searchParams } = new URL(request.url)
    const businessId = searchParams.get('businessId')

    const { business } = await resolveAssetRequestScope(request, businessId, { capability: 'read' })

    const logs = await listAssetMaintenanceLogs({
      businessId: business.id,
      registeredAssetId: id,
    })

    return NextResponse.json({ items: logs }, { status: 200 })
  } catch (error) {
    return NextResponse.json(
      { error: error.message || 'Failed to list maintenance logs' },
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
      action = 'CREATE', // 'CREATE' | 'COMPLETE'
      title,
      issueDescription,
      priority,
      serviceProvider,
      estimatedCost,
      scheduledDate,
      resolutionNotes,
      actualCost,
      newCondition,
      completedDate,
      invoiceRef,
    } = body

    const { viewer, business } = await resolveAssetRequestScope(request, businessId, { capability: 'manage' })

    let result
    if (action === 'COMPLETE') {
      result = await completeMaintenanceLog({
        businessId: business.id,
        registeredAssetId: id,
        resolutionNotes,
        actualCost,
        newCondition,
        completedDate,
        invoiceRef,
        viewer,
      })
    } else {
      result = await createMaintenanceLog({
        businessId: business.id,
        registeredAssetId: id,
        title,
        issueDescription,
        priority,
        serviceProvider,
        estimatedCost,
        scheduledDate,
        viewer,
      })
    }

    return NextResponse.json(result, { status: 200 })
  } catch (error) {
    return NextResponse.json(
      { error: error.message || 'Failed to process maintenance action' },
      { status: error.status || 500 }
    )
  }
}
