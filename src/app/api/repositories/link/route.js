// @req FR-008 — link repository to project (many-to-many relationship)
// @req FR-046 — every mutating request resolves one trusted viewer and fails closed.
// @req FR-072 — the service refuses this write unless the viewer owns the governing Business.
// @spec SEC-001, SEC-008
// @tested tests/integration/fr072-repository-link-authorization.test.js
import { handle } from '../../_helpers'
import { linkRepository } from '@/modules/project-manager/application/repository-service'
import { resolveRequestViewer } from '@/modules/identity/request-viewer'

export const dynamic = 'force-dynamic'

export async function POST(request) {
  return handle(async () => {
    const viewer = await resolveRequestViewer(request)
    return linkRepository(await request.json(), { viewer })
  })
}
