import { handle } from '../../../_helpers'
import { resolveKnowledgeRequestViewer as resolveRequestViewer, resolveKnowledgeCorpusService, readRouteParams } from '@/modules/knowledge/knowledge-http'

// @req FR-172 — citation resolution rechecks current knowledge access through
// the corpus service before returning historical evidence.
// @spec ADR-072, SEC-001, SEC-006, SEC-008
// @tested tests/unit/knowledge-corpus-routes.test.js

export const dynamic = 'force-dynamic'

export async function GET(request, context) {
  return handle(async () => {
    const { citationId } = await readRouteParams(context)
    const viewer = await resolveRequestViewer(request)
    const service = await resolveKnowledgeCorpusService()
    if (typeof service.resolveKnowledgeCitation !== 'function') {
      const error = new Error('Knowledge citation service is unavailable')
      error.status = 503
      throw error
    }
    return service.resolveKnowledgeCitation(citationId, {
      viewer,
      // Citation lineage can involve slow store reads; the corpus service
      // invokes this closure before returning text to recheck live access.
      resolveCurrentViewer: () => resolveRequestViewer(request),
    })
  })
}
