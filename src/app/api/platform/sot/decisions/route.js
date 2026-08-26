import { handle, queryParams } from '@/app/api/_helpers'
import { resolveRequestViewer } from '@/modules/identity/request-viewer'
import { resolveSotDataPlaneViewer } from '@/modules/identity/sot-data-plane-auth'
import { listSotDecisions, submitSotDecisions } from '@/modules/integration/application/sot-decision-service'

// @req FR-100 — the data plane submits pending decisions (operator- or
// FR-102 data-plane-key-authorized, idempotent); the inbox lists them
// viewer-scoped for a human, session auth only (listing is a UI concern, not
// a data-plane verb — see docs/domains/identity/features/FR-102-*.md).
// @spec FR-100, FR-102, SEC-002
// @tested tests/unit/sot-decision-service.test.js, tests/integration/sot-decisions-route.test.js

export const dynamic = 'force-dynamic'

export async function GET(request) {
  return handle(async () => listSotDecisions(queryParams(request), {
    viewer: await resolveRequestViewer(request),
  }))
}

export async function POST(request) {
  return handle(async () => submitSotDecisions(await request.json(), {
    viewer: (await resolveSotDataPlaneViewer(request)) ?? await resolveRequestViewer(request),
  }))
}
