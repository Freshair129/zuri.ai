import { handle, queryParams } from '../../../_helpers'
import { resolveRequestViewer } from '@/modules/identity/request-viewer'
import {
  searchConversationMessages,
  parseConversationSearchQuery,
} from '@/modules/crm/conversation-search-service'

// @req FR-233 — the CRM inbox's third, read-only reader: message search.
// @spec SDD-050, BR-001, SEC-001
// @tested tests/integration/crm-conversation-search.test.js
//
// A literal path segment ("search") ahead of `[id]/route.js` — Next.js resolves
// static segments before dynamic ones, so this never collides with a
// conversation id that happened to be the literal string "search".
//
// GET only, same reasoning as the inbox route: search reads, it never writes.

export const dynamic = 'force-dynamic'

export async function GET(request) {
  return handle(async () => {
    const viewer = await resolveRequestViewer(request)
    const query = parseConversationSearchQuery(queryParams(request))
    return searchConversationMessages({ viewer, ...query })
  })
}
