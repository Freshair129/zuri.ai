import { handle } from '@/app/api/_helpers'
import { resolveRequestViewer } from '@/modules/identity/request-viewer'
import { mintApiAccessKey } from '@/modules/identity/api-access-auth'

// @req FR-106 — an installation operator, or an owner in the named Tenant
//   (FR-074(b)), mints a Tenant-bound Enterprise API key. The raw secret
//   appears exactly once, in this authenticated response, for handover to the
//   integrator's own secret storage — it is stored digest-only and can never
//   be read back, only reissued. Minting is audited without token material.
// @spec SEC-006, SEC-001, SEC-008, ADR-047
// @tested tests/unit/api-access-key-routes.test.js

export const dynamic = 'force-dynamic'

export async function POST(request) {
  return handle(async () => {
    const viewer = await resolveRequestViewer(request)
    const body = await request.json().catch(() => ({}))
    return mintApiAccessKey({ label: body?.label, tenantId: body?.tenantId, viewer })
  })
}
