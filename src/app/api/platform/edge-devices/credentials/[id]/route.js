import { handle } from '@/app/api/_helpers'
import { resolveRequestViewer } from '@/modules/identity/request-viewer'
import { revokeEdgeDeviceCredential } from '@/modules/identity/edge-device-credential'

// @req FR-144 — revocation is the authority that minted (Business OWNER or the
//   installation operator), takes effect on the device's next request with no
//   grace period, and is audited. An unknown id and a credential in a Business
//   the viewer does not own answer identically, so this is not an enumeration
//   oracle over credential ids.
// @spec SEC-025, SEC-001, SEC-008, ADR-059 D2
// @tested tests/unit/edge-device-credential-routes.test.js,
//   tests/integration/fr144-edge-device-credential.test.js

export const dynamic = 'force-dynamic'

export async function DELETE(request, { params }) {
  return handle(async () => {
    const viewer = await resolveRequestViewer(request)
    const body = await request.json().catch(() => ({}))
    return revokeEdgeDeviceCredential(params?.id, { reason: body?.reason ?? 'REVOKED', viewer })
  })
}
