import { handle } from '@/app/api/_helpers'
import { resolveRequestViewer } from '@/modules/identity/request-viewer'
import { listLineConversationJobs } from '@/modules/line-oa-studio/application/line-conversation-jobs'
// @req FR-149 — scoped operational state without tokens, recipients or message bodies.
// @req FR-243 — `?session=S-YYYYMMDD-XXXXXX` narrows the list to one conversation session.
// @spec ADR-061, SEC-001
// @tested tests/integration/server-line-jobs.test.js, tests/integration/crm-conversation-session-surfaces.test.js
export const dynamic = 'force-dynamic'
export async function GET(request, { params }) {
  const sessionCode = new URL(request.url).searchParams.get('session') ?? undefined
  return handle(async () => listLineConversationJobs(params?.id, { viewer: await resolveRequestViewer(request), sessionCode }))
}
