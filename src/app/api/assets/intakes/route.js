// @req FR-137, FR-138 — idempotently persist canonical Asset intake readiness.
// @spec SDD-081, SDD-082, BR-025, NFR-022, SEC-024, ADR-056
// @tested tests/unit/asset-evidence-route-schema-contract.test.js
import { handle, httpError } from '@/app/api/_helpers'
import { resolveAssetRequestScope } from '@/modules/asset-management/application/asset-request-scope'
import { upsertAssetIntake } from '@/modules/asset-management/application/asset-intake-service'
import { resolveRequestViewer } from '@/modules/identity/request-viewer'

export const dynamic = 'force-dynamic'

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
