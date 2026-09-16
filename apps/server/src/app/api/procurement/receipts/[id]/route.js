import { handle } from '@/app/api/_helpers'
import { resolveRequestViewer } from '@/modules/identity/request-viewer'
import { getGoodsReceiptDetail } from '@/modules/procurement'

// @req FR-165 — read a persisted goods receipt within the viewer's Business scope.
// @spec ADR-066; SEC-001; FR-072
// @tested tests/unit/procurement-routes.test.js, tests/integration/fr165-goods-receipt.test.js
export const dynamic = 'force-dynamic'
export async function GET(request, { params }) {
  return handle(async () => {
    const viewer = await resolveRequestViewer(request)
    return getGoodsReceiptDetail((await params).id, { viewer })
  })
}
