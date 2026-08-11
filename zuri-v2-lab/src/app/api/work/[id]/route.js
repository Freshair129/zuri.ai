import { handle } from '../../_helpers'
import { updateItem, deleteItem } from '@/modules/project-manager/application/work-service'

export const dynamic = 'force-dynamic'

export async function PATCH(request, { params }) {
  return handle(async () => updateItem(params.id, await request.json()))
}

export async function DELETE(request, { params }) {
  return handle(() => deleteItem(params.id))
}
