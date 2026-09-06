import { handle, queryParams } from '@/app/api/_helpers'
import { resolveRequestViewer } from '@/modules/identity/request-viewer'
import { stockSummary } from '@/modules/inventory/application/inventory-stock-service'

// @req FR-155 — the stock summary of one Business: every product with its
//   on-hand recomputed from the ledger on this very read (null for an
//   UNTRACKED product, never a zero that reads as "measured and empty"), its
//   safety stock and the below-safety flag, plus the counts the dashboard
//   shows. GET only; Business visibility plus the `inventory` domain; the
//   FR-072 404 otherwise.
// @spec SEC-001
// @tested tests/unit/inventory-routes.test.js, tests/integration/fr155-inventory-stock.test.js

export const dynamic = 'force-dynamic'

export async function GET(request) {
  return handle(async () => {
    const viewer = await resolveRequestViewer(request)
    const query = queryParams(request)
    return stockSummary({ businessId: query?.businessId, includeArchived: query?.includeArchived === 'true', viewer })
  })
}
