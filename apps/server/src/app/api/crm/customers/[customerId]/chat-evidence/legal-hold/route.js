import { handle } from '@/app/api/_helpers'
import { resolveRequestViewer } from '@/modules/identity/request-viewer'
import { recordArchiveLegalHold } from '@/modules/crm/archive-legal-hold-service'

// @req SEC-034 — an OWNER records a legal hold on one Customer's chat evidence
//   archive: a dispute reason and an end date, deferring the archive key's
//   destruction past a PDPA erasure or the D5 term expiry until the hold ends
//   (ADR-093 D6, TASK-ZAI-113).
// @spec ADR-093 D6
// @tested tests/integration/crm-archive-legal-hold.test.js
//
// POST, and only POST — same reasoning as the erasure and retrieval routes
// next to it: nothing here a GET's idempotent-and-cacheable contract fits,
// and every hold recorded is independently audited.
export const dynamic = 'force-dynamic'

export async function POST(request, { params }) {
  return handle(async () => recordArchiveLegalHold(params.customerId, await request.json(), {
    viewer: await resolveRequestViewer(request),
  }))
}
