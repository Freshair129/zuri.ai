import { handle, queryParams } from '../../../_helpers'
import { resolveRequestViewer } from '@/modules/identity/request-viewer'
import {
  getConversationThread,
  parseConversationThreadQuery,
} from '@/modules/crm/conversation-read-model'

// @req FR-091 — one conversation thread, oldest message first.
// @spec SDD-049, BR-001, SEC-001, SDD-007
// @tested tests/integration/crm-conversation-inbox.test.js
//
// `businessId` is required rather than inferred from the conversation, because the
// question this route answers is "may THIS viewer, working in THIS Business, read this
// thread" — and a scope taken from the row being read is not a scope check at all.

export const dynamic = 'force-dynamic'

export async function GET(request, { params }) {
  return handle(async () => {
    const viewer = await resolveRequestViewer(request)
    const { businessId } = parseConversationThreadQuery(queryParams(request))
    return getConversationThread({ viewer, businessId, conversationId: params.id })
  })
}
