import { handle, httpError } from '@/app/api/_helpers'
import { resolveAssetRequestScope } from '@/modules/asset-management/application/asset-request-scope'
import { getLatestAssetExtractionJob } from '@/modules/asset-management/application/asset-extraction-job-service'
import { resolveRequestViewer } from '@/modules/identity/request-viewer'

// @req FR-143 — the review surface reads the latest extraction job for one piece
//   of evidence so a reviewer can see that a device has the work, rather than
//   staring at an unchanged page. Read-only; it never queues, claims or cancels.
// @spec SDD-085, SEC-001, ADR-059
// @tested tests/integration/fr143-asset-extraction-job.test.js

export const dynamic = 'force-dynamic'

export async function GET(request, { params }) {
  return handle(async () => {
    const businessId = request.headers.get('x-zuri-business-id')
    if (!businessId) throw httpError(400, 'x-zuri-business-id is required')
    const viewer = await resolveRequestViewer(request)
    await resolveAssetRequestScope(request, businessId, { capability: 'read', viewer })
    return getLatestAssetExtractionJob(params?.id, { businessId, viewer })
  })
}
