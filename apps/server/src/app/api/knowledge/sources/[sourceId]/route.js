import { handle } from '../../../_helpers'
import { resolveKnowledgeRequestViewer, resolveKnowledgeCorpusService, readRouteParams, strictKnowledgeBody } from '@/modules/knowledge/knowledge-http'

// @req FR-172 — source withdrawal uses the corpus service's compare-and-set
// publication boundary and cannot delete immutable historical evidence.
// @spec ADR-072, SEC-001, SEC-006, SEC-008
// @tested tests/unit/knowledge-corpus-routes.test.js

export const dynamic = 'force-dynamic'

export async function DELETE(request, context) {
  return handle(async () => {
    const { sourceId } = await readRouteParams(context)
    const viewer = await resolveKnowledgeRequestViewer(request)
    const body = strictKnowledgeBody(request.headers.get('content-length') === '0' ? {} : await request.json().catch(() => ({})), ['expectedVersion'])
    const service = await resolveKnowledgeCorpusService()
    if (typeof service.withdrawKnowledgeSource !== 'function') {
      const error = new Error('Knowledge source withdrawal service is unavailable')
      error.status = 503
      throw error
    }
    return service.withdrawKnowledgeSource(sourceId, {
      expectedVersion: body?.expectedVersion,
    }, { viewer })
  })
}
