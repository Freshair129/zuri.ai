// @req FR-138 — provider extraction creates a candidate, never approval.
// @req FR-138 — provider extraction creates a candidate, never approval.
// @req FR-143 — the retired Edge queue is no longer an extraction option (ADR-109 D3).
// @spec SDD-082, SDD-085, BR-025, NFR-022, SEC-024, ADR-056, ADR-059
// @tested tests/unit/asset-evidence-route-schema-contract.test.js,
//   tests/integration/fr143-asset-extraction-job.test.js
import { NextResponse } from 'next/server'
import { httpError } from '@/app/api/_helpers'
import { resolveAssetRequestScope } from '@/modules/asset-management/application/asset-request-scope'
import { extractAssetEvidence } from '@/modules/asset-management/application/asset-evidence-service'
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

    const result = await extractAssetEvidence(params.id, {
      businessId,
      viewer,
      objectStoragePort: createConfiguredAssetObjectStoragePort(),
      extractor: createConfiguredOpenAiAssetEvidenceExtractor(),
    })
    return NextResponse.json({ provider: 'openai', ...result })
  } catch (error) {
    const message = error?.message || 'Unable to extract evidence'
    const status = Number(error?.status) || (/not found/i.test(message) ? 404 : 400)
    return NextResponse.json({ error: message }, { status })
  }
}
