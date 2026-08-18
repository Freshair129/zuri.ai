import { handle } from '../../../_helpers'
import { getProjectRoadmap } from '@/modules/project-manager/application/project-roadmap-read-model'
import { resolveRequestViewer } from '@/modules/identity/request-viewer'

// @req FR-068 — authorized Project-scoped Execution Roadmap read contract.
// @spec SDD-039, ADR-028, FR-070
// @tested tests/integration/project-roadmap.test.js

export const dynamic = 'force-dynamic'

export async function GET(request, { params }) {
  return handle(async () => {
    const viewer = await resolveRequestViewer(request)
    return getProjectRoadmap(params.id, { viewer })
  })
}
