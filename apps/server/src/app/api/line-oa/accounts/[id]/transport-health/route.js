import { handle } from '@/app/api/_helpers'
import { resolveRequestViewer } from '@/modules/identity/request-viewer'
import { readLineTransportHealth } from '@/modules/line-oa-studio/application/line-transport-health'
// @req FR-190 — is this channel reachable? Answers silence state and whether the
//   endpoint LINE has configured is still this deployment's own route.
// @spec ADR-061, SEC-001 — Business-scoped read; states, timestamps and durations
//   only, never channel credentials and never the other endpoint's contents.
// @tested tests/unit/fr190-line-transport-health.test.js
export const dynamic = 'force-dynamic'
export async function GET(request, { params }) {
  return handle(async () => readLineTransportHealth(params?.id, { viewer: await resolveRequestViewer(request) }))
}
