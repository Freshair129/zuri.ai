import { handle } from '@/app/api/_helpers'
import { resolveRequestViewer } from '@/modules/identity/request-viewer'
import { retrieveArchivedChatEvidence } from '@/modules/crm/chat-evidence-retrieval-service'

// @req FR-245 — the one retrieval path for the chat evidence archive (ADR-093
//   D7, TASK-ZAI-112): an OWNER at AAL2 names a Business they own, a date
//   range and a case reference, and gets back exactly the archived messages
//   that fall in it, grouped by session, or none — never a browse or a list.
// @spec ADR-093 D7; SEC-034
// @tested tests/integration/crm-chat-evidence-retrieval.test.js
//
// POST, and only POST — same reasoning as the erasure route: there is nothing
// here a GET's idempotent-and-cacheable contract fits, retrieval always needs
// the mandatory case reference in a body, and every call is independently
// audited regardless of how many times the same range is asked for.
export const dynamic = 'force-dynamic'

export async function POST(request, { params }) {
  return handle(async () => retrieveArchivedChatEvidence(params.customerId, await request.json(), {
    viewer: await resolveRequestViewer(request),
    request,
  }))
}
