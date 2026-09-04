// @req FR-138 — provider extraction creates a candidate, never approval.
// @req FR-143 — the same request now chooses between the cloud provider and a
//   paired Zuri Edge Device (ADR-059 D5). The cloud path is unchanged and still
//   answers synchronously; the edge path queues one job and answers 202, because
//   the device polls for work and nobody can promise how long a local model
//   takes. Queueing twice returns the job already in flight rather than a second
//   unit of work.
// @spec SDD-082, SDD-085, BR-025, NFR-022, SEC-024, ADR-056, ADR-059
// @tested tests/unit/asset-evidence-route-schema-contract.test.js,
//   tests/integration/fr143-asset-extraction-job.test.js
import { NextResponse } from 'next/server'
import { httpError } from '@/app/api/_helpers'
import { resolveAssetRequestScope } from '@/modules/asset-management/application/asset-request-scope'
import { extractAssetEvidence } from '@/modules/asset-management/application/asset-evidence-service'
import { enqueueAssetExtractionJob } from '@/modules/asset-management/application/asset-extraction-job-service'
import { resolveExtractionProvider } from '@/modules/asset-management/application/asset-extraction-provider'
import { createConfiguredAssetObjectStoragePort } from '@/platform/storage/supabase-object-storage'
import { createConfiguredOpenAiAssetEvidenceExtractor } from '@/modules/asset-management/infrastructure/openai-asset-evidence-extractor'
import { resolveRequestViewer } from '@/modules/identity/request-viewer'

export const dynamic = 'force-dynamic'

export async function POST(request, { params }) {
  try {
    const businessId = request.headers.get('x-zuri-business-id')
    if (!businessId) throw httpError(400, 'x-zuri-business-id is required')
    const viewer = await resolveRequestViewer(request)
    await resolveAssetRequestScope(request, businessId, { capability: 'write', viewer })

    const provider = await resolveExtractionProvider({ businessId })
    if (provider === 'edge') {
      const { job, created } = await enqueueAssetExtractionJob(params.id, { businessId, viewer })
      return NextResponse.json({ provider, job, created }, { status: 202 })
    }

    const result = await extractAssetEvidence(params.id, {
      businessId,
      viewer,
      objectStoragePort: createConfiguredAssetObjectStoragePort(),
      extractor: createConfiguredOpenAiAssetEvidenceExtractor(),
    })
    return NextResponse.json({ provider, ...result })
  } catch (error) {
    const message = error?.message || 'Unable to extract evidence'
    const status = Number(error?.status) || (/not found/i.test(message) ? 404 : 400)
    return NextResponse.json({ error: message }, { status })
  }
}
