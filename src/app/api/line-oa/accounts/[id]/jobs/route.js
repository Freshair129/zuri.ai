import { handle } from '@/app/api/_helpers'
import { resolveRequestViewer } from '@/modules/identity/request-viewer'
import { listLineConversationJobs } from '@/modules/line-oa-studio/application/line-conversation-jobs'
// @req FR-149 — scoped operational state without tokens, recipients or message bodies.
// @spec ADR-061, SEC-001
// @tested tests/integration/server-line-jobs.test.js
export const dynamic = 'force-dynamic'
export async function GET(request, { params }) {
  return handle(async () => listLineConversationJobs(params?.id, { viewer: await resolveRequestViewer(request) }))
}
