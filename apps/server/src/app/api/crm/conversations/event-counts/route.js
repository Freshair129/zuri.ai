import { handle, queryParams } from '../../../_helpers'
import { resolveRequestViewer } from '@/modules/identity/request-viewer'
import {
  getConversationEventCounts,
  parseConversationEventCountsQuery,
} from '@/modules/crm/conversation-search-service'

// @req FR-233 — per-account follow/unfollow counts from ConversationEvent
//   (design §6.9), what the Studio dashboard needs before an Insight pull exists.
// @spec SDD-050, BR-001, SEC-001
// @tested tests/integration/crm-conversation-search.test.js
//
// GET only — a fourth read-only surface over models the ingest seam alone writes.

export const dynamic = 'force-dynamic'

export async function GET(request) {
  return handle(async () => {
    const viewer = await resolveRequestViewer(request)
    const query = parseConversationEventCountsQuery(queryParams(request))
    return getConversationEventCounts({ viewer, ...query })
  })
}
