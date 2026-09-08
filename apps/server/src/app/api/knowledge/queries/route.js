import { handle } from '../../_helpers'
import { resolveKnowledgeRequestViewer, resolveKnowledgeCorpusService, strictKnowledgeBody } from '@/modules/knowledge/knowledge-http'

// @req FR-172 — query is dispatched to the corpus snapshot service only after
// the existing authenticated viewer/API grant is resolved.
// @spec ADR-072, SEC-001, SEC-006, SEC-008
// @tested tests/unit/knowledge-corpus-routes.test.js

export const dynamic = 'force-dynamic'

export async function POST(request) {
  return handle(async () => {
    const viewer = await resolveKnowledgeRequestViewer(request)
    const body = strictKnowledgeBody(await request.json(), ['businessId', 'projectId', 'query', 'topK'])
    const service = await resolveKnowledgeCorpusService()
    if (typeof service.queryKnowledgeCorpus !== 'function') {
      const error = new Error('Knowledge corpus query service is unavailable')
      error.status = 503
      throw error
    }
    return service.queryKnowledgeCorpus(body, {
      viewer,
      // The corpus service re-resolves this request-scoped viewer after slow
      // snapshot reads, so a revoked session/API grant cannot disclose a late
      // result. It is deliberately a closure, never request-controlled JSON.
      resolveCurrentViewer: () => resolveKnowledgeRequestViewer(request),
    })
  })
}
