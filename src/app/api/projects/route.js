// @req FR-003 — project CRUD: list and create
// @req FR-046 — every mutating request resolves one trusted viewer and fails closed.
// @req FR-072 — the service refuses this write unless the viewer owns the governing Business.
// @spec SEC-001, SEC-008
// @tested tests/integration/fr072-project-service-authorization.test.js
import { handle, queryParams } from '../_helpers'
import {
  listProjects,
  listProjectsForOverview,
  listProjectsForTimeline,
  listProjectsForWorkspace,
  createProject,
} from '@/modules/project-manager/application/project-service'
import { parseProjectListQuery } from '@/modules/project-manager/application/project-list-read-model'
import { resolveRequestViewer } from '@/modules/identity/request-viewer'

export const dynamic = 'force-dynamic'

export async function GET(request) {
  return handle(() => {
    const { view, ...filters } = parseProjectListQuery(queryParams(request))
    if (view === 'overview') return listProjectsForOverview(filters)
    if (view === 'timeline') return listProjectsForTimeline(filters)
    if (view === 'workspace') return listProjectsForWorkspace(filters)
    return listProjects(filters)
  })
}

export async function POST(request) {
  return handle(async () => {
    const viewer = await resolveRequestViewer(request)
    return createProject(await request.json(), { viewer })
  })
}
