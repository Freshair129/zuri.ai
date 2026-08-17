// @req FR-005 — update a work container in the neutral WorkContainer/WorkItem model
import { handle } from '../../_helpers'
import { updateContainer } from '@/modules/project-manager/application/work-service'

export const dynamic = 'force-dynamic'

export async function PATCH(request, { params }) {
  return handle(async () => updateContainer(params.id, await request.json()))
}
