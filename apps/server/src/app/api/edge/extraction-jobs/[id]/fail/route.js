import { handle, httpError } from '@/app/api/_helpers'
import { resolveEdgeDeviceContext } from '@/modules/identity/edge-device-credential'
import { failAssetExtractionJob } from '@/modules/asset-management/application/asset-extraction-job-service'

// @req FR-143 — the device reports that it could not extract. Below the attempt
//   ceiling the job returns to the queue for another try; at the ceiling it stays
//   FAILED with the reason the reviewer sees, rather than cycling forever.
// @req FR-144 — device authentication.
// @spec SEC-025, ADR-059 D3
// @tested tests/integration/fr143-asset-extraction-job.test.js

export const dynamic = 'force-dynamic'

export async function POST(request, { params }) {
  return handle(async () => {
    const deviceContext = await resolveEdgeDeviceContext(request)
    if (!deviceContext) throw httpError(401, 'An edge device credential is required')
    const body = await request.json().catch(() => ({}))
    return failAssetExtractionJob(params?.id, body, { deviceContext })
  })
}
