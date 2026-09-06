// @req FR-036 — project Team API delegates all membership mutations to the audited service.
// @spec SDD-015, SEC-003, docs/features/FR-036-project-team.md
// @tested tests/unit/project-team-service.test.js
// @req FR-046 — every mutating request resolves one trusted viewer and fails closed.
// @spec SEC-008, SEC-001, .brain/reviews/pm-triage-2026-08-17.md §S1
// @tested tests/unit/fr036-team-authorization.test.js
//
// These handlers resolved no viewer until 2026-08-17. `addProjectTeamMember`
// takes `role` from the request body and writes a Membership, and
// `resolveViewer` builds `ownedBusinessIds` from OWNER memberships — so a single
// unauthenticated POST minted business-owner authority over any Business that
// owned a project. The service now fails closed without a viewer; resolving one
// here is what lets the legitimate caller through.
import { handle } from '../../../_helpers'
import { addProjectTeamMember, changeProjectTeamRole, listProjectTeam, removeProjectTeamMember } from '@/modules/project-manager/application/project-team-service'
import { resolveRequestViewer } from '@/modules/identity/request-viewer'

export const dynamic = 'force-dynamic'

export async function GET(request, { params }) {
  return handle(async () => listProjectTeam(params.id, { viewer: await resolveRequestViewer(request) }))
}

export async function POST(request, { params }) {
  return handle(async () => {
    const viewer = await resolveRequestViewer(request)
    return addProjectTeamMember(params.id, await request.json(), { viewer })
  })
}

export async function PATCH(request, { params }) {
  return handle(async () => {
    const viewer = await resolveRequestViewer(request)
    return changeProjectTeamRole(params.id, await request.json(), { viewer })
  })
}

export async function DELETE(request, { params }) {
  return handle(async () => {
    const viewer = await resolveRequestViewer(request)
    return removeProjectTeamMember(params.id, await request.json(), { viewer })
  })
}
