import { handle } from '@/app/api/_helpers'
import { resolveRequestViewer } from '@/modules/identity/request-viewer'
import { sendStaffReply } from '@/modules/crm/reply-record-service'

// @req FR-246 — a member with CRM write access sends a text reply to a LINE
//   conversation from the inbox; the server pushes it through the account's LINE
//   transport as a push message and records it, naming the person.
// @spec ADR-093 evidence gap; BR-001; SEC-001; BR-011 (answers no replyToken, races nothing)
// @tested tests/integration/crm-staff-reply.test.js
//
// POST only, and scoped to one conversation: this is not a generic message send —
// the writer resolves the conversation itself from the path, so a reply can never
// be attached to any conversation but the one the console has open.

export const dynamic = 'force-dynamic'

export async function POST(request, { params }) {
  return handle(async () => sendStaffReply(params?.id, await request.json(), {
    viewer: await resolveRequestViewer(request),
  }))
}
