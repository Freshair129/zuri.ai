// @req FR-254 — authorized Knowledge Console read surface.
// @spec ADR-072, ADR-085, SEC-001, SEC-008
// @tested tests/unit/fr254-knowledge-console-routes.test.js, tests/integration/fr254-knowledge-console.test.js
import { consoleRequest, consoleParameters } from '@/modules/knowledge/knowledge-console-http'
import { readRouteParams } from '@/modules/knowledge/knowledge-http'
import { listConsoleGenerations } from '@/modules/knowledge/knowledge-console-service'

export const dynamic = 'force-dynamic'
export async function GET(request, context) {
  return consoleRequest(request, async (options) => listConsoleGenerations((await readRouteParams(context)).corpusId, consoleParameters(request), options))
}
