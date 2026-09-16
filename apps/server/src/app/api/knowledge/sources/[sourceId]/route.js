import { handle } from '../../../_helpers'
import { consoleRequest, consoleParameters } from '@/modules/knowledge/knowledge-console-http'
import { readConsoleSource } from '@/modules/knowledge/knowledge-console-service'
import { resolveKnowledgeRequestViewer as resolveRequestViewer, resolveKnowledgeCorpusService, readRouteParams, strictKnowledgeBody } from '@/modules/knowledge/knowledge-http'

// @req FR-173 — source withdrawal uses the corpus service's compare-and-set
// publication boundary and cannot delete immutable historical evidence.
// @spec ADR-072, SEC-001, SEC-006, SEC-008
// @tested tests/unit/knowledge-corpus-routes.test.js

export const dynamic = 'force-dynamic'

// @req FR-253 — authorized source history, without changing withdrawal.
// @tested tests/unit/fr253-knowledge-console-routes.test.js
export async function GET(request, context) {
  return consoleRequest(request, async (options) => readConsoleSource((await readRouteParams(context)).sourceId, consoleParameters(request), options))
}

export async function DELETE(request, context) {
  return handle(async () => {
    const { sourceId } = await readRouteParams(context)
    const viewer = await resolveRequestViewer(request)
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
