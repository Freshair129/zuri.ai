import { handle } from '../../../_helpers'
import { getProjectDependencyGraph } from '@/modules/project-manager/application/dependency-service'

// @req FR-040 - expose a Project-contained Dependency Map read contract.
// @spec SDD-019, ADR-012
// @tested tests/unit/project-dependency-route.test.js
export const dynamic = 'force-dynamic'

export async function GET(_request, { params }) {
  return handle(() => getProjectDependencyGraph(params.id))
}
