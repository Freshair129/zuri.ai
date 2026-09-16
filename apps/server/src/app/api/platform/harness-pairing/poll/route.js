import { harnessPairingService } from '@/modules/identity/harness-pairing-runtime'
import { pairingBody, pairingResponse } from '@/modules/identity/edge-pairing-http'

// @req FR-220 — only the harness holding the device secret redeems its approved request, once.
// @spec ADR-087 D1, D3, SEC-025, SEC-001, SEC-008
// @tested tests/unit/harness-credential.test.js
export const dynamic = 'force-dynamic'
export async function POST(request) {
  return pairingResponse(async () => {
    const body = await pairingBody(request)
    const deviceSecret = /^Bearer ([\w-]{43})$/.exec(request.headers.get('authorization') || '')?.[1]
    return harnessPairingService().poll({ requestId: body.requestId, deviceSecret, cancel: body.cancel === true })
  })
}