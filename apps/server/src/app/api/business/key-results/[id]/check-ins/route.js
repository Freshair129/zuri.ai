// @req FR-268 — OWNER-scoped weekly Key Result check-in. Write-through
// recomputes the parent goal's progress in the same transaction (SDD-107).
// @spec BR-044
// @tested tests/integration/fr268-business-key-result-mutation.test.js
import { handle } from '../../../../_helpers'
// @req FR-046 — protected API identity comes from the trusted request session.
// @spec ADR-017, SDD-024, SEC-008
import { resolveRequestViewer } from '@/modules/identity/request-viewer'
import { recordKeyResultCheckIn } from '@/modules/project-manager/application/business-strategy-mutation-service'

export const dynamic = 'force-dynamic'

export async function POST(request, { params }) {
  return handle(async () => {
    const viewer = await resolveRequestViewer(request)
    return recordKeyResultCheckIn(params.id, await request.json(), { viewer })
  })
}
