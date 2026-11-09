// @req FR-133, FR-135 — read Business-scoped intake summaries for Asset Register.
// @req FR-137, FR-138 — idempotently persist canonical Asset intake readiness.
// @spec SDD-081, SDD-082, BR-025, NFR-022, SEC-024, ADR-056
// @tested tests/unit/asset-evidence-route-schema-contract.test.js, tests/unit/asset-register-routes.test.js
import { handle, httpError } from '@/app/api/_helpers'
import { resolveAssetRequestScope } from '@/modules/asset-management/application/asset-request-scope'
import { listAssetIntakesForRegistration } from '@/modules/asset-management/application/asset-register-service'
import { upsertAssetIntake } from '@/modules/asset-management/application/asset-intake-service'
import { ASSET_INTAKE_STATUS, ASSET_INTAKE_STATUSES } from '@/modules/asset-management/domain/asset-intake'
import { resolveRequestViewer } from '@/modules/identity/request-viewer'

export const dynamic = 'force-dynamic'

export async function GET(request) {
  return handle(async () => {
    const { searchParams } = new URL(request.url)
    const businessId = searchParams.get('businessId')
    const status = searchParams.get('status') || ASSET_INTAKE_STATUS.READY_FOR_REGISTRATION
    const limit = searchParams.get('limit')

    if (!businessId) throw httpError(400, 'businessId is required')
    if (!ASSET_INTAKE_STATUSES.includes(status)) throw httpError(400, 'status is invalid')

    const { business } = await resolveAssetRequestScope(request, businessId, { capability: 'read' })
    return listAssetIntakesForRegistration({ businessId: business.id, status, limit })
  })
}

export async function POST(request) {
  return handle(async () => {
    const businessId = request.headers.get('x-zuri-business-id')
    if (!businessId) throw httpError(400, 'x-zuri-business-id is required')
    const viewer = await resolveRequestViewer(request)
    await resolveAssetRequestScope(request, businessId, { capability: 'write', viewer })
    const body = await request.json()
    if (body?.businessId !== businessId) throw httpError(404, 'Asset intake not found')
    return upsertAssetIntake(body, { viewer })
  })
}
