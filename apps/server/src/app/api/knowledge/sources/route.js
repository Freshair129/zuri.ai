// @req FR-254 — authorized Knowledge Console read surface.
// @spec ADR-072, ADR-085, SEC-001, SEC-008
// @tested tests/unit/fr254-knowledge-console-routes.test.js, tests/integration/fr254-knowledge-console.test.js
import { consoleRequest, consoleParameters } from '@/modules/knowledge/knowledge-console-http'
import { listConsoleSources } from '@/modules/knowledge/knowledge-console-service'

export const dynamic = 'force-dynamic'
export async function GET(request) {
  return consoleRequest(request, async (options) => listConsoleSources(consoleParameters(request), options))
}
