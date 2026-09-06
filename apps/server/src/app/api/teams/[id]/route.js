// @req FR-089 — one Team: its roster, its Projects, its name, and its retirement.
// @req FR-046 — every request resolves one trusted viewer and fails closed.
// @spec BR-018, SEC-001, SEC-008,
//   docs/decisions/ADR-037-TEAM-IS-AN-ORGANISATIONAL-GROUPING-NOT-AN-AUTHORITY.md
// @tested tests/integration/fr089-team-scope.test.js
//
// DELETE archives (soft delete). A Team grants nothing, so retiring one revokes
// nothing either — which is precisely why it can be a reversible record rather
// than a destructive one.
import { handle } from '../../_helpers'
import { resolveRequestViewer } from '@/modules/identity/request-viewer'
import { archiveTeam, getTeam, updateTeam } from '@/modules/project-manager/application/team-service'

export const dynamic = 'force-dynamic'

export async function GET(request, { params }) {
  return handle(async () => getTeam(params.id, { viewer: await resolveRequestViewer(request) }))
}

export async function PATCH(request, { params }) {
  return handle(async () => {
    const viewer = await resolveRequestViewer(request)
    return updateTeam(params.id, await request.json(), { viewer })
  })
}

export async function DELETE(request, { params }) {
  return handle(async () => archiveTeam(params.id, { viewer: await resolveRequestViewer(request) }))
}
