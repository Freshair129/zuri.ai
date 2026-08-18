import { handle, queryParams } from '../../_helpers'
import { resolveRequestViewer } from '@/modules/identity/request-viewer'
import { listCustomerImportReviewQueue } from '@/modules/crm/customer-import-review-service'

// @req FR-078 — the review queue is read only through the trusted viewer and
// returns redacted review identifiers/evidence, never raw source PII.
// @spec CDC-SG-CUSTOMER-DATA-001 v0.3.0B, ADR-018, ADR-033.
// @tested tests/unit/customer-import-review-api.test.js

export const dynamic = 'force-dynamic'

export async function GET(request) {
  return handle(async () => {
    const query = queryParams(request)
    return listCustomerImportReviewQueue({
      businessId: query.businessId || null,
      batchId: query.batchId || null,
      status: query.status || null,
      viewer: await resolveRequestViewer(request),
    })
  })
}
