// @req FR-007 — delete a dependency
import { handle } from '../../_helpers'
import { deleteDependency } from '@/modules/project-manager/application/dependency-service'

export const dynamic = 'force-dynamic'

export async function DELETE(request, { params }) {
  return handle(() => deleteDependency(params.id))
}
