import { handle } from '../../_helpers'
import { updateRepository } from '@/modules/project-manager/application/repository-service'

export const dynamic = 'force-dynamic'

export async function PATCH(request, { params }) {
  return handle(async () => updateRepository(params.id, await request.json()))
}
