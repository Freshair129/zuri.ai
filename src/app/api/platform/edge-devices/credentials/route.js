import { handle, queryParams } from '@/app/api/_helpers'
import { resolveRequestViewer } from '@/modules/identity/request-viewer'
import { listEdgeDeviceCredentials, mintEdgeDeviceCredential } from '@/modules/identity/edge-device-credential'

// @req FR-144 — a Business OWNER (or the installation operator) pairs a Zuri
//   Edge Device with one Business. POST mints; the raw key appears exactly once,
//   in this authenticated response, for handover to the device's own local
//   configuration (ADR-041 D3 keeps every edge secret off the cloud console).
//   GET lists the same Business's credentials as metadata only — no field here
//   could rebuild a key. Both refuse a Business the caller does not own with the
//   same 404 an unknown Business gets.
// @spec SEC-025, SEC-001, SEC-008, ADR-059 D2, ADR-041 D3
// @tested tests/unit/edge-device-credential-routes.test.js,
//   tests/integration/fr144-edge-device-credential.test.js

export const dynamic = 'force-dynamic'

export async function GET(request) {
  return handle(async () => {
    const viewer = await resolveRequestViewer(request)
    const query = queryParams(request)
    return listEdgeDeviceCredentials({ businessId: query?.businessId, viewer })
  })
}

export async function POST(request) {
  return handle(async () => {
    const viewer = await resolveRequestViewer(request)
    const body = await request.json().catch(() => ({}))
    return mintEdgeDeviceCredential({
      businessId: body?.businessId,
      deviceId: body?.deviceId,
      label: body?.label,
      viewer,
    })
  })
}
