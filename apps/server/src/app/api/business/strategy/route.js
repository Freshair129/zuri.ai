import { handle, queryParams } from '../../_helpers'
// @req FR-046 — protected API identity comes from the trusted request session.
// @spec ADR-017, SDD-024, SEC-008
// @tested tests/unit/fr046-api-ui-contract.test.js
import { resolveRequestViewer } from '@/modules/identity/request-viewer'
import { getBusinessStrategy } from '@/modules/business/application/business-strategy-service'

// @req FR-041 - expose the selected Business Strategy without Organization roll-up.
// @spec ADR-013, SDD-020, BR-001 - resolveViewer gates Business visibility.
// @tested tests/unit/business-strategy-route.test.js

export const dynamic = 'force-dynamic'

export async function GET(request) {
  return handle(async () => {
    const { businessId } = queryParams(request)
    const viewer = await resolveRequestViewer(request)
    return getBusinessStrategy(businessId, { visibleBusinessIds: viewer.visibleBusinessIds })
  })
}
