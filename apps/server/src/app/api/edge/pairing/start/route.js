import { edgePairingService } from '@/modules/identity/edge-pairing-runtime'
import { pairingBody, pairingOrigin, pairingResponse } from '@/modules/identity/edge-pairing-http'
// @req FR-144 — Desktop starts a bounded anonymous approval request; no credential minted.
// @spec SEC-025, SEC-008
// @tested tests/unit/edge-pairing-routes.test.js
export const dynamic = 'force-dynamic'
export async function POST(request) {
  return pairingResponse(async () => {
    const body = await pairingBody(request)
    return edgePairingService().start({ deviceId: body.deviceId, label: body.label, origin: pairingOrigin() })
  })
}
