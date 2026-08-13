import { handle, queryParams } from '../../_helpers'
import { resolveViewer } from '@/modules/identity/resolve-viewer'
import { getBusinessStrategy } from '@/modules/business/application/business-strategy-service'

// @req FR-041 - expose the selected Business Strategy without Organization roll-up.
// @spec ADR-013, SDD-020, BR-001 - resolveViewer gates Business visibility.
// @tested tests/unit/business-strategy-route.test.js

export const dynamic = 'force-dynamic'

export async function GET(request) {
  return handle(async () => {
    const { businessId } = queryParams(request)
    const viewer = await resolveViewer()
    return getBusinessStrategy(businessId, { visibleBusinessIds: viewer.visibleBusinessIds })
  })
}
