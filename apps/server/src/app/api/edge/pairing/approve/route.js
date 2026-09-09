import { resolveRequestViewer } from '@/modules/identity/request-viewer'
import { edgePairingService } from '@/modules/identity/edge-pairing-runtime'
import { pairingBody, pairingResponse } from '@/modules/identity/edge-pairing-http'
// @req FR-144 — authenticated owner selects a Business and confirms the device shown.
// @spec SEC-025, SEC-001, SEC-008
// @tested tests/unit/edge-pairing-routes.test.js
export const dynamic = 'force-dynamic'
export async function POST(request) {
  return pairingResponse(async () => {
    const viewer = await resolveRequestViewer(request)
    const body = await pairingBody(request, { browser: true })
    const service = edgePairingService()
    return body.action === 'inspect'
      ? service.inspect({ code: body.code, viewer })
      : service.decide({ code: body.code, businessId: body.businessId, action: body.action, viewer })
  })
}
