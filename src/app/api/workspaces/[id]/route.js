// @req FR-001 — update and archive workspace
import { handle } from '../../_helpers'
import { updateWorkspace, archiveWorkspace } from '@/modules/project-manager/application/scope-service'

export const dynamic = 'force-dynamic'

export async function PATCH(request, { params }) {
  return handle(async () => updateWorkspace(params.id, await request.json()))
}

export async function DELETE(request, { params }) {
  return handle(() => archiveWorkspace(params.id))
}
