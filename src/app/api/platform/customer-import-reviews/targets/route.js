import { handle, queryParams } from '../../../_helpers'
import { resolveRequestViewer } from '@/modules/identity/request-viewer'
import { listCustomerImportReviewTargets } from '@/modules/crm/customer-import-review-service'

// @req FR-078 — existing Customer targets are searched server-side within the
// fixed SmartGift scope and returned only as masked labels plus internal IDs.
// @spec CDC-SG-CUSTOMER-DATA-001 v0.3.0B, ADR-018, ADR-033.
// @tested tests/unit/customer-import-review-api.test.js

export const dynamic = 'force-dynamic'

export async function GET(request) {
  return handle(async () => {
    const query = queryParams(request)
    return listCustomerImportReviewTargets({
      businessId: query.businessId || null,
      query: query.q || '',
      limit: query.limit || 25,
      viewer: await resolveRequestViewer(request),
    })
  })
}
