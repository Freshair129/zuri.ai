import { resolveRequestViewer } from '@/modules/identity/request-viewer'
import { harnessPairingService } from '@/modules/identity/harness-pairing-runtime'
import { pairingBody, pairingResponse } from '@/modules/identity/edge-pairing-http'

// @req FR-220 — a signed-in person sees the check code and device label and approves or denies for themselves.
// @spec ADR-087 D1, D2, SEC-025, SEC-001, SEC-008
// @tested tests/unit/harness-credential.test.js
export const dynamic = 'force-dynamic'
export async function POST(request) {
  return pairingResponse(async () => {
    const viewer = await resolveRequestViewer(request)
    const body = await pairingBody(request, { browser: true })
    const service = harnessPairingService()
    return body.action === 'inspect'
      ? service.inspect({ code: body.code, viewer })
      : service.decide({ code: body.code, action: body.action, viewer })
  })
}