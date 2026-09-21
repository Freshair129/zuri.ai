import { handle } from '../../_helpers'
import { resolveKnowledgeRequestViewer as resolveRequestViewer } from '@/modules/knowledge/knowledge-http'
import { uploadSmartGiftCatalogFile } from '@/modules/knowledge/smartgift-catalog-upload-service'

// @req FR-187 — upload a SmartGift catalog JSON to the private knowledge store
// and admit it as a structured projection in the same request.
// @spec ADR-075
// @tested tests/unit/smartgift-catalog-upload-service.test.js

export const dynamic = 'force-dynamic'

export async function POST(request) {
  return handle(async () => {
    const viewer = await resolveRequestViewer(request)
    const body = await request.json()
    return uploadSmartGiftCatalogFile(body, { viewer })
  })
}
