// @req FR-089 — move a Person into or out of a Team.
// @req FR-046 — every mutating request resolves one trusted viewer and fails closed.
// @spec BR-018, SEC-001, SEC-008,
//   docs/decisions/ADR-037-TEAM-IS-AN-ORGANISATIONAL-GROUPING-NOT-AN-AUTHORITY.md
// @tested tests/integration/fr089-team-scope.test.js
// @tested tests/unit/fr089-br018-team-grants-nothing.test.js
//
// The body carries a `personId` and nothing else. There is no `role` field to
// send (ADR-037 D3) and the service writes no `Membership` (BR-018), so unlike
// `POST /api/projects/[id]/team` — whose body-supplied `role` minted business
// ownership on 2026-08-17 — there is no field here that could grant anything
// even if this handler were reached unauthenticated.
import { handle } from '../../../_helpers'
import { resolveRequestViewer } from '@/modules/identity/request-viewer'
import { addTeamMember, removeTeamMember } from '@/modules/project-manager/application/team-service'

export const dynamic = 'force-dynamic'

export async function POST(request, { params }) {
  return handle(async () => {
    const viewer = await resolveRequestViewer(request)
    return addTeamMember(params.id, await request.json(), { viewer })
  })
}

export async function DELETE(request, { params }) {
  return handle(async () => {
    const viewer = await resolveRequestViewer(request)
    return removeTeamMember(params.id, await request.json(), { viewer })
  })
}
