import { handle, queryParams } from '../../_helpers'
import { resolveKnowledgeRequestViewer as resolveRequestViewer } from '@/modules/knowledge/knowledge-http'
import { getKnowledgeGapReport } from '@/modules/knowledge/application/knowledge-gap-report-service'

// @req FR-237 — the Knowledge (GKS) slot's LINE knowledge-gap report: counts,
//   product locators and last-seen times only, scoped to the viewer's visible
//   Business(es) — never the question text, never a cross-Business read.
// @spec ADR-090 D7
// @tested tests/integration/fr237-knowledge-gap-report.test.js

export const dynamic = 'force-dynamic'

export async function GET(request) {
  return handle(async () => {
    const params = queryParams(request)
    const viewer = await resolveRequestViewer(request)
    return getKnowledgeGapReport({ businessId: params.businessId || undefined }, { viewer })
  })
}
