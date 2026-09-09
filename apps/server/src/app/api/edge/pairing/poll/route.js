import { edgePairingService } from '@/modules/identity/edge-pairing-runtime'
import { pairingBody, pairingResponse } from '@/modules/identity/edge-pairing-http'
// @req FR-144 — the initiating Desktop alone redeems its approved request once.
// @spec SEC-025, SEC-001, SEC-008
// @tested tests/unit/edge-pairing-routes.test.js
export const dynamic = 'force-dynamic'
export async function POST(request) {
  return pairingResponse(async () => {
    const body = await pairingBody(request)
    const authorization = request.headers.get('authorization') || ''
    const deviceSecret = /^Bearer ([\w-]{43})$/.exec(authorization)?.[1]
    return edgePairingService().poll({ requestId: body.requestId, deviceSecret, cancel: body.cancel === true })
  })
}
