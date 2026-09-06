import { handle, queryParams } from '@/app/api/_helpers'
import { resolveRequestViewer } from '@/modules/identity/request-viewer'
import { getRevenueSummary } from '@/modules/commerce/application/revenue-read-model'

// @req FR-159 — the revenue summary of one Business: verified payments net
//   of verified refunds, by origin and by day (`from` / `to` as YYYY-MM-DD in
//   the Business's calendar), pending money beside it, open and completed
//   order counts. GET only, read-only; Business visibility plus the
//   `commerce` domain; the FR-072 404 otherwise.
// @spec ADR-065; SEC-001
// @tested tests/unit/commerce-routes.test.js, tests/integration/fr159-payment.test.js

export const dynamic = 'force-dynamic'

export async function GET(request) {
  return handle(async () => {
    const viewer = await resolveRequestViewer(request)
    const q = queryParams(request)
    return getRevenueSummary({ businessId: q?.businessId, ...(q?.from ? { from: q.from } : {}), ...(q?.to ? { to: q.to } : {}) }, { viewer })
  })
}
