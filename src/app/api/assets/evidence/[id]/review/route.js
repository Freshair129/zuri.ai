// @req FR-138 — explicit human review/correction remains separate from candidate output.
// @spec SDD-082, BR-025, SEC-024, ADR-056
// @tested tests/unit/asset-evidence-route-schema-contract.test.js
import { handle, httpError } from '@/app/api/_helpers'
import { resolveAssetRequestScope } from '@/modules/asset-management/application/asset-request-scope'
import { reviewAssetEvidence } from '@/modules/asset-management/application/asset-evidence-service'
import { resolveRequestViewer } from '@/modules/identity/request-viewer'

export const dynamic = 'force-dynamic'

export async function POST(request, { params }) {
  return handle(async () => {
    const businessId = request.headers.get('x-zuri-business-id')
    if (!businessId) throw httpError(400, 'x-zuri-business-id is required')
    const viewer = await resolveRequestViewer(request)
    await resolveAssetRequestScope(request, businessId, { capability: 'review', viewer })
    const body = await request.json()
    return reviewAssetEvidence(params.id, body, { businessId, viewer })
  })
}
