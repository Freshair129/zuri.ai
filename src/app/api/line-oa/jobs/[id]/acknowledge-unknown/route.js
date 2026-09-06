import { handle } from '@/app/api/_helpers'
import { resolveRequestViewer } from '@/modules/identity/request-viewer'
import { acknowledgeUnknownLineJob } from '@/modules/line-oa-studio/application/line-conversation-jobs'
// @req FR-149 — audited closure of uncertainty, with no delivery assertion or resend.
// @spec ADR-061, SEC-001
// @tested tests/integration/server-line-jobs.test.js
export const dynamic = 'force-dynamic'
export async function POST(request, { params }) {
  return handle(async () => acknowledgeUnknownLineJob(params?.id, await request.json(), { viewer: await resolveRequestViewer(request) }))
}
