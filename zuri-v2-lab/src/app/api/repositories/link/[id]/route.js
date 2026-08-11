import { handle } from '../../../_helpers'
import { unlinkRepository } from '@/modules/project-manager/application/repository-service'

export const dynamic = 'force-dynamic'

export async function DELETE(request, { params }) {
  return handle(() => unlinkRepository(params.id))
}
