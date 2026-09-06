import { handle, queryParams } from '../../_helpers'
import { resolveRequestViewer } from '@/modules/identity/request-viewer'
import {
  getConversationInbox,
  parseConversationInboxQuery,
} from '@/modules/crm/conversation-read-model'

// @req FR-091 — the CRM Conversation Inbox list endpoint.
// @spec SDD-050, BR-001, SEC-001, SDD-007
// @tested tests/integration/crm-conversation-inbox.test.js
//
// GET only. There is no POST here and there is not meant to be one: the reply owner is
// the edge runtime (BR-011), and the ingest seam is the only writer of these models
// (crm charter). A write verb on this path would be a second write path into rows the
// charter says have exactly one.

export const dynamic = 'force-dynamic'

export async function GET(request) {
  return handle(async () => {
    const viewer = await resolveRequestViewer(request)
    const query = parseConversationInboxQuery(queryParams(request))
    return getConversationInbox({ viewer, ...query })
  })
}
