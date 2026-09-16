import { handle, queryParams } from '@/app/api/_helpers'
import { resolveRequestViewer } from '@/modules/identity/request-viewer'
import { summarizeLineConversationJobFailures } from '@/modules/line-oa-studio/application/line-job-failures'

// @req FR-149 — the honest, red count of terminal FAILED conversation jobs
//   for one Business, on the LINE OA Studio conversation/jobs surface. GET
//   only: this is a read model, never a retry or acknowledgement endpoint.
//   `businessId` is a selector the service validates against the trusted
//   viewer — never scope taken from the client — and an unauthorized or
//   unknown Business refuses with the same 404 (ADR-060 D11).
// @spec ADR-061, SEC-001
// @tested tests/unit/line-job-failures-route.test.js

export const dynamic = 'force-dynamic'

export async function GET(request) {
  return handle(async () => {
    const viewer = await resolveRequestViewer(request)
    const query = queryParams(request)
    return summarizeLineConversationJobFailures({
      businessId: query?.businessId,
      viewer,
    })
  })
}
