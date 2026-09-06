import { handle } from '../_helpers'
import { resolveRequestViewer } from '@/modules/identity/request-viewer'
import { buildViewerEntry } from '@/modules/identity/entry-read-model'

// @req FR-046 — one viewer-scoped response owns pre-shell Business Routing.
// @spec ADR-017, SDD-024, SEC-008
// @tested tests/unit/fr046-api-ui-contract.test.js, tests/integration/fr046-entry-contract.test.js

export const dynamic = 'force-dynamic'

export async function GET(request) {
  return handle(async () => {
    const viewer = await resolveRequestViewer(request)
    return buildViewerEntry({ viewer })
  })
}
