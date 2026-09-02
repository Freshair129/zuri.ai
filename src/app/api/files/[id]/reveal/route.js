// @req FR-045 - explicit local-only reveal capability.
// @spec SDD-023, SEC-007, ADR-016 D7/D8
// @tested tests/unit/fr045-reveal.test.js
import { handle } from '../../../_helpers'
// @req FR-046 — protected API identity comes from the trusted request session.
// @spec ADR-017, SDD-024, SEC-008
// @tested tests/unit/fr046-api-ui-contract.test.js
import { resolveRequestViewer } from '@/modules/identity/request-viewer'
import { revealFileAsset } from '@/modules/project-manager/application/local-file-reveal-service'

export const dynamic = 'force-dynamic'

export async function POST(request, { params }) {
  return handle(async () => {
    const viewer = await resolveRequestViewer(request)
    return revealFileAsset(params.id, {
      requestUrl: request.url,
      origin: request.headers.get('origin'),
      intent: request.headers.get('x-zuri-local-intent'),
    }, { viewer })
  })
}
