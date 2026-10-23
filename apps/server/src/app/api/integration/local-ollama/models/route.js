import { handle } from '@/app/api/_helpers'
import { resolveRequestViewer } from '@/modules/identity/request-viewer'
import { assertMainDevLocalOllamaAvailable, listMainDevLocalOllamaModels } from '@/modules/integration/application/local-ollama-selection-service'

// @req FR-079, FR-080 — the private main-dev model inventory is derived from an
//   authenticated Business owner and the server-side allowlisted LINE OA scope.
// @spec ADR-100 D5, D9; SEC-001, SEC-030 — no client-supplied scope and no cache.
// @tested tests/unit/local-ollama-owner-routes.test.js
export const dynamic = 'force-dynamic'

export async function GET(request) {
  const response = await handle(async () => {
    const viewer = await resolveRequestViewer(request)
    assertMainDevLocalOllamaAvailable()
    return listMainDevLocalOllamaModels({ viewer })
  })
  response.headers.set('Cache-Control', 'no-store')
  return response
}
