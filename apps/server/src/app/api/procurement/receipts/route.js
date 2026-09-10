import { handle, queryParams } from '@/app/api/_helpers'
import { resolveRequestViewer } from '@/modules/identity/request-viewer'
import { listAllGoodsReceipts } from '@/modules/procurement'

// @req FR-165 — scoped, bounded receipt registry.
// @spec ADR-066; SEC-001; FR-072
// @tested tests/unit/procurement-routes.test.js, tests/integration/fr165-goods-receipt.test.js
export const dynamic = 'force-dynamic'
export async function GET(request) {
  return handle(async () => {
    const viewer = await resolveRequestViewer(request)
    const { businessId, limit, offset } = queryParams(request)
    return listAllGoodsReceipts(businessId, { viewer, limit, offset })
  })
}
