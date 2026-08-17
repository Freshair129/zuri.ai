// @req FR-006 — update a weighted gate with required flag and evidence
import { handle } from '../../_helpers'
import { updateGate } from '@/modules/project-manager/application/milestone-gate-service'

export const dynamic = 'force-dynamic'

export async function PATCH(request, { params }) {
  return handle(async () => updateGate(params.id, await request.json()))
}
