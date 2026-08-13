// @req FR-045 - explicit local-only reveal capability.
// @spec SDD-023, SEC-007, ADR-016 D7/D8
// @tested tests/unit/fr045-reveal.test.js
import { handle } from '../../../_helpers'
import { resolveViewer } from '@/modules/identity/resolve-viewer'
import { revealFileAsset } from '@/modules/project-manager/application/local-file-reveal-service'

export const dynamic = 'force-dynamic'

export async function POST(request, { params }) {
  return handle(async () => {
    const viewer = await resolveViewer()
    return revealFileAsset(params.id, {
      requestUrl: request.url,
      origin: request.headers.get('origin'),
      intent: request.headers.get('x-zuri-local-intent'),
    }, { visibleBusinessIds: viewer.visibleBusinessIds })
  })
}
