// @req FR-006 — update a weighted milestone with gates
import { handle } from '../../_helpers'
import { updateMilestone } from '@/modules/project-manager/application/milestone-gate-service'

export const dynamic = 'force-dynamic'

export async function PATCH(request, { params }) {
  return handle(async () => updateMilestone(params.id, await request.json()))
}
