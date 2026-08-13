// @req FR-036 — project Team API delegates all membership mutations to the audited service.
// @spec SDD-015, SEC-003, docs/features/FR-036-project-team.md
// @tested tests/unit/project-team-service.test.js
import { handle } from '../../../_helpers'
import { addProjectTeamMember, changeProjectTeamRole, listProjectTeam, removeProjectTeamMember } from '@/modules/project-manager/application/project-team-service'

export const dynamic = 'force-dynamic'

export async function GET(request, { params }) {
  return handle(() => listProjectTeam(params.id))
}

export async function POST(request, { params }) {
  return handle(async () => addProjectTeamMember(params.id, await request.json()))
}

export async function PATCH(request, { params }) {
  return handle(async () => changeProjectTeamRole(params.id, await request.json()))
}

export async function DELETE(request, { params }) {
  return handle(async () => removeProjectTeamMember(params.id, await request.json()))
}
