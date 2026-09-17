import { handle } from '@/app/api/_helpers'
import { resolveRequestViewer } from '@/modules/identity/request-viewer'
import { recordCustomerLegalHold } from '@/modules/crm/chat-evidence-legal-hold-service'

// @req SEC-034 — the write path for recording a legal hold on a Customer's
//   chat evidence archive (ADR-093 D6, TASK-ZAI-113). There was no route, UI
//   or script that could record one before this: `eraseCustomerPrincipal`
//   could only ever see an absent hold.
// @spec ADR-093 D6; SEC-034; BR-001
// @tested tests/integration/crm-archive-legal-hold.test.js
//
// POST, and only POST — same reasoning as the erasure and retrieval routes:
// this creates a new, append-only history row, never replaces or previews one,
// and every recording is independently audited.
export const dynamic = 'force-dynamic'

export async function POST(request, { params }) {
  return handle(async () => recordCustomerLegalHold(params.customerId, await request.json(), {
    viewer: await resolveRequestViewer(request),
  }))
}
