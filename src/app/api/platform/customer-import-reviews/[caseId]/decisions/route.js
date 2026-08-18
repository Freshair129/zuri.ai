import { handle } from '../../../../_helpers'
import { resolveRequestViewer } from '@/modules/identity/request-viewer'
import { appendCustomerImportReviewDecisions } from '@/modules/crm/customer-import-review-service'

// @req FR-078 — append Business-scoped, actor-bound review decisions through a
// server route; this endpoint never applies a Customer write.
// @spec CDC-SG-CUSTOMER-DATA-001 v0.3.0B, ADR-018, ADR-033.
// @tested tests/unit/customer-import-review-api.test.js

export const dynamic = 'force-dynamic'

export async function POST(request, { params }) {
  return handle(async () => {
    const body = await request.json()
    return appendCustomerImportReviewDecisions({
      businessId: body.businessId,
      caseId: params.caseId,
      expectedVersion: body.expectedVersion,
      decisions: body.decisions,
      viewer: await resolveRequestViewer(request),
    })
  })
}
