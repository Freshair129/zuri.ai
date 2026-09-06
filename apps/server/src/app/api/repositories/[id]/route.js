// @req FR-008 — update repository metadata
// @req FR-046 — every mutating request resolves one trusted viewer and fails closed.
// @req FR-073 — the service refuses the write unless the viewer owns the
// Repository's Business; a Repository with no owning Business is refused for
// every principal.
// @spec SEC-001, SEC-008
// @tested tests/integration/fr073-repository-scope.test.js
import { handle } from '../../_helpers'
import { resolveRequestViewer } from '@/modules/identity/request-viewer'
import { updateRepository } from '@/modules/project-manager/application/repository-service'

export const dynamic = 'force-dynamic'

export async function PATCH(request, { params }) {
  return handle(async () => {
    const viewer = await resolveRequestViewer(request)
    return updateRepository(params.id, await request.json(), { viewer })
  })
}
