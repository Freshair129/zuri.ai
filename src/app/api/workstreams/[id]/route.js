// @req FR-004 — update or archive workstreams with mode, strategy, and weight
import { handle } from '../../_helpers'
import { updateWorkstream, archiveWorkstream } from '@/modules/project-manager/application/project-service'

export const dynamic = 'force-dynamic'

export async function PATCH(request, { params }) {
  return handle(async () => updateWorkstream(params.id, await request.json()))
}

export async function DELETE(request, { params }) {
  return handle(() => archiveWorkstream(params.id))
}
