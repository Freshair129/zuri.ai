// @req FR-059 — OWNER-scoped Goal <-> Project unlink.
// @spec SDD-032, BR-001
// Business isolation mirrors the project-ownership rule FR-043 enforces for
// direct Project ownership.
// @tested tests/integration/fr059-business-strategy-mutation.test.js
//
// Not in this task's originally listed write-ownership (which enumerated only
// .../goals/[id]/projects/route.js), but required by Next.js file routing to
// serve the contract's DELETE /api/business/goals/{id}/projects/{projectId}
// (FR-059 §2) — see the final report for why this file was added.
import { handle } from '../../../../../_helpers'
// @req FR-046 — protected API identity comes from the trusted request session.
// @spec ADR-017, SDD-024, SEC-008
import { resolveRequestViewer } from '@/modules/identity/request-viewer'
import { unlinkProjectFromGoal } from '@/modules/project-manager/application/business-strategy-mutation-service'

export const dynamic = 'force-dynamic'

export async function DELETE(request, { params }) {
  return handle(async () => {
    const viewer = await resolveRequestViewer(request)
    return unlinkProjectFromGoal(params.id, params.projectId, { viewer })
  })
}
