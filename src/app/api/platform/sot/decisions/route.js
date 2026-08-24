import { handle, queryParams } from '@/app/api/_helpers'
import { resolveRequestViewer } from '@/modules/identity/request-viewer'
import { listSotDecisions, submitSotDecisions } from '@/modules/integration/application/sot-decision-service'

// @req FR-100 — the data plane submits pending decisions (operator-only,
// idempotent); the inbox lists them viewer-scoped.
// @spec FR-100, SEC-002
// @tested tests/unit/sot-decision-service.test.js

export const dynamic = 'force-dynamic'

export async function GET(request) {
  return handle(async () => listSotDecisions(queryParams(request), {
    viewer: await resolveRequestViewer(request),
  }))
}

export async function POST(request) {
  return handle(async () => submitSotDecisions(await request.json(), {
    viewer: await resolveRequestViewer(request),
  }))
}
