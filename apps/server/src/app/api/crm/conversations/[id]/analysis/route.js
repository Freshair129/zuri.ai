import { handle, queryParams } from '../../../../_helpers'
import { resolveRequestViewer } from '@/modules/identity/request-viewer'
import { getConversationAnalyses } from '@/modules/crm/conversation-analysis-service'
import { parseConversationThreadQuery } from '@/modules/crm/conversation-read-model'

// @req FR-127 — bounded read-only analysis projection for an Inbox thread.
// @req FR-091 — the conversation identifier is internal and the selected
//   Business scope is explicit; the CRM analysis reader applies Inbox scope,
//   customer-domain visibility, and the live consent/erasure gate.
// @spec ADR-054 D3-D6, BR-001, SEC-001, SEC-005
// @tested tests/unit/conversation-analysis-inbox-route.test.js
export const dynamic = 'force-dynamic'

export async function GET(request, { params }) {
  return handle(async () => {
    const viewer = await resolveRequestViewer(request)
    const { businessId } = parseConversationThreadQuery(queryParams(request))
    return getConversationAnalyses({ viewer, businessId, conversationId: params.id })
  })
}
