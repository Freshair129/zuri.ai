import { handle, queryParams } from '@/app/api/_helpers'
import { resolveRequestViewer } from '@/modules/identity/request-viewer'
import { resolveSotDataPlaneViewer } from '@/modules/identity/sot-data-plane-auth'
import { exportSotDecisions } from '@/modules/integration/application/sot-decision-service'

// @req FR-100 — the pull half of the loop: decided rows in stable cursor
// order for the data plane to apply to its own stores (ADR-043 interim).
// Authenticates via an FR-102 data-plane key first, falling back to a human
// operator's session — the same order submit uses, for the same reason: a
// non-interactive caller never carries a session cookie, so trying it first
// avoids a false 401 round-trip before the key is even checked.
// @spec FR-100, FR-102
// @tested tests/unit/sot-decision-service.test.js, tests/integration/sot-decisions-route.test.js

export const dynamic = 'force-dynamic'

export async function GET(request) {
  return handle(async () => exportSotDecisions(queryParams(request), {
    viewer: (await resolveSotDataPlaneViewer(request)) ?? await resolveRequestViewer(request),
  }))
}
