import { harnessPairingService } from '@/modules/identity/harness-pairing-runtime'
import { pairingBody, pairingOrigin, pairingResponse } from '@/modules/identity/edge-pairing-http'

// @req FR-220 — a harness starts a bounded anonymous pairing request; no credential is minted here.
// @spec ADR-087 D1, SEC-025, SEC-008
// @tested tests/unit/harness-credential.test.js
export const dynamic = 'force-dynamic'
export async function POST(request) {
  return pairingResponse(async () => {
    const body = await pairingBody(request)
    return harnessPairingService().start({ harness: body.harness, deviceLabel: body.deviceLabel, osUser: body.osUser, origin: pairingOrigin() })
  })
}