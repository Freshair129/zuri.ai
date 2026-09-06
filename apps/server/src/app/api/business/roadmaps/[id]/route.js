// @req FR-059 — OWNER-scoped Business Roadmap update (full-replace horizons).
// @spec SDD-032, BR-001
// @tested tests/integration/fr059-business-strategy-mutation.test.js
import { handle } from '../../../_helpers'
// @req FR-046 — protected API identity comes from the trusted request session.
// @spec ADR-017, SDD-024, SEC-008
import { resolveRequestViewer } from '@/modules/identity/request-viewer'
import { updateRoadmap } from '@/modules/project-manager/application/business-strategy-mutation-service'

export const dynamic = 'force-dynamic'

export async function PATCH(request, { params }) {
  return handle(async () => {
    const viewer = await resolveRequestViewer(request)
    return updateRoadmap(params.id, await request.json(), { viewer })
  })
}
