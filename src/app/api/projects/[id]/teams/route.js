// @req FR-089 — the Teams attached to a Project, and the attach/detach that
// maintains them. Many-to-many (ADR-037 D3), so POST adds a link and never
// displaces one.
// @req FR-046 — every mutating request resolves one trusted viewer and fails closed.
// @spec BR-018, SEC-001, SEC-008,
//   docs/decisions/ADR-037-TEAM-IS-AN-ORGANISATIONAL-GROUPING-NOT-AN-AUTHORITY.md
// @tested tests/integration/fr089-team-scope.test.js
//
// Distinct from `./team`, which is FR-036's "people in the Business who may work
// here" and is untouched by this feature (ADR-037 D5). Two paths, two meanings,
// stated here because for a while the product genuinely has both.
import { handle } from '../../../_helpers'
import { resolveRequestViewer } from '@/modules/identity/request-viewer'
import {
  attachTeamToProject,
  detachTeamFromProject,
  listProjectTeams,
} from '@/modules/project-manager/application/team-service'

export const dynamic = 'force-dynamic'

export async function GET(request, { params }) {
  return handle(async () => listProjectTeams(params.id, { viewer: await resolveRequestViewer(request) }))
}

export async function POST(request, { params }) {
  return handle(async () => {
    const viewer = await resolveRequestViewer(request)
    return attachTeamToProject(params.id, await request.json(), { viewer })
  })
}

export async function DELETE(request, { params }) {
  return handle(async () => {
    const viewer = await resolveRequestViewer(request)
    return detachTeamFromProject(params.id, await request.json(), { viewer })
  })
}
