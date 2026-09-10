import { handle, queryParams } from '@/app/api/_helpers'
import { resolveRequestViewer } from '@/modules/identity/request-viewer'
import { deKitFinishedSets } from '@/modules/inventory/application/de-kitting-service'

// @req FR-182, FR-178 — disassembly. One POST issues the finished sets and receives their
//   surviving components back in a single transaction; the components the
//   caller names in `destroyedComponentProductIds` are written off instead,
//   because only the person holding the torn box knows which they are. A
//   branded component can never come back into a generic-stock location
//   (BR-028) — the service refuses the whole call rather than part of it.
// @spec ADR-074 D6; BR-028; SEC-001
// @tested tests/unit/scm-console-routes.test.js, tests/integration/fr182-scm-console-actions.test.js

export const dynamic = 'force-dynamic'

export async function POST(request) {
  return handle(async () => {
    const viewer = await resolveRequestViewer(request)
    const body = await request.json().catch(() => ({}))
    return deKitFinishedSets(body, { viewer })
  })
}
