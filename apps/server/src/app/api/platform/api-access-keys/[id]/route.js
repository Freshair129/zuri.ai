import { handle } from '@/app/api/_helpers'
import { resolveRequestViewer } from '@/modules/identity/request-viewer'
import { revokeApiAccessKey } from '@/modules/identity/api-access-auth'

// @req FR-106 — revocation is the same authority that mints (installation
//   operator, or an owner in the key's own Tenant), takes effect on the next
//   request with no grace period, and is audited. An unknown id and a key the
//   viewer has no authority over answer identically, so this route is not an
//   enumeration oracle over key ids.
// @spec SEC-006, SEC-001, SEC-008, ADR-047
// @tested tests/unit/api-access-key-routes.test.js

export const dynamic = 'force-dynamic'

export async function DELETE(request, { params }) {
  return handle(async () => {
    const viewer = await resolveRequestViewer(request)
    const body = await request.json().catch(() => ({}))
    return revokeApiAccessKey(params?.id, { reason: body?.reason ?? 'REVOKED', viewer })
  })
}
