import { handle, httpError } from '@/app/api/_helpers'
import { resolveEdgeDeviceContext } from '@/modules/identity/edge-device-credential'
import { completeAssetExtractionJob } from '@/modules/asset-management/application/asset-extraction-job-service'

// @req FR-143 — the device posts the candidate it produced locally. It is
//   validated with the same schema the cloud adapter asks its provider for
//   (SDD-085), written exactly the way `extractAssetEvidence` writes one, and it
//   sets no review or approval state — a candidate is evidence, never a decision
//   (BR-025).
// @req FR-144 — device authentication.
// @spec SDD-085, SEC-025, BR-025, ADR-059 D3
// @tested tests/integration/fr143-asset-extraction-job.test.js

export const dynamic = 'force-dynamic'

export async function POST(request, { params }) {
  return handle(async () => {
    const deviceContext = await resolveEdgeDeviceContext(request)
    if (!deviceContext) throw httpError(401, 'An edge device credential is required')
    const body = await request.json().catch(() => ({}))
    return completeAssetExtractionJob(params?.id, body, { deviceContext })
  })
}
