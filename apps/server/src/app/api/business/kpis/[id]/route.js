// @req FR-269 — OWNER-scoped Business KPI update.
// @spec ADR-101 D1, BR-001, SEC-003
// @tested tests/integration/fr269-business-kpi-mutation.test.js
import { handle } from '../../../_helpers'
// @req FR-046 — protected API identity comes from the trusted request session.
// @spec ADR-017, SDD-024, SEC-008
import { resolveRequestViewer } from '@/modules/identity/request-viewer'
import { updateBusinessKpi } from '@/modules/project-manager/application/business-strategy-mutation-service'

export const dynamic = 'force-dynamic'

export async function PATCH(request, { params }) {
  return handle(async () => {
    const viewer = await resolveRequestViewer(request)
    return updateBusinessKpi(params.id, await request.json(), { viewer })
  })
}
