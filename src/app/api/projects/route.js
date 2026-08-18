// @req FR-003 — project CRUD: list and create
// @req FR-046 — every mutating request resolves one trusted viewer and fails closed.
// @req FR-072 — the service refuses this write unless the viewer owns the governing Business.
// @spec SEC-001, SEC-008
// @tested tests/integration/fr072-project-service-authorization.test.js
import { handle, httpError, queryParams } from '../_helpers'
import prisma from '@/lib/db'
import {
  listProjects,
  listProjectsForOverview,
  listProjectsForTimeline,
  listProjectsForWorkspace,
  createProject,
} from '@/modules/project-manager/application/project-service'
import { parseProjectListQuery } from '@/modules/project-manager/application/project-list-read-model'
import { resolveRequestViewer } from '@/modules/identity/request-viewer'
import { isInstallationOperator, seesBusiness } from '@/modules/identity/viewer-authority'

export const dynamic = 'force-dynamic'

async function assertWorkspaceVisible(workspaceId, viewer) {
  const workspace = await prisma.workspace.findUnique({
    where: { id: workspaceId },
    select: { businessId: true, scopeType: true, tenantId: true, portfolioId: true },
  })
  if (!workspace) throw httpError(404, 'Workspace not found')
  if (workspace.businessId) {
    if (!seesBusiness(viewer, workspace.businessId)) throw httpError(404, 'Workspace not found')
    return
  }

  const visibleBusinessIds = Array.isArray(viewer.visibleBusinessIds)
    ? viewer.visibleBusinessIds.filter((businessId) => seesBusiness(viewer, businessId))
    : []
  const where = workspace.scopeType === 'TENANT'
    ? { id: { in: visibleBusinessIds }, tenantId: workspace.tenantId }
    : workspace.scopeType === 'PORTFOLIO'
      ? { id: { in: visibleBusinessIds }, tenant: { portfolioId: workspace.portfolioId } }
      : null
  if (!where || !(await prisma.business.count({ where }))) throw httpError(404, 'Workspace not found')
}

export async function GET(request) {
  return handle(async () => {
    const viewer = await resolveRequestViewer(request)
    const { view, ...filters } = parseProjectListQuery(queryParams(request))
    if (!isInstallationOperator(viewer)) {
      if (filters.businessId) {
        if (!seesBusiness(viewer, filters.businessId)) throw httpError(404, 'Business not found')
      } else if (filters.workspaceId) {
        await assertWorkspaceVisible(filters.workspaceId, viewer)
      } else if (filters.tenantId) {
        const visibleBusinessIds = (viewer.visibleBusinessIds || []).filter((businessId) => seesBusiness(viewer, businessId))
        const visibleBusiness = await prisma.business.findFirst({
          where: { tenantId: filters.tenantId, id: { in: visibleBusinessIds } },
          select: { id: true },
        })
        if (!visibleBusiness) throw httpError(404, 'Tenant not found')
      } else {
        throw httpError(403, 'A Business or Workspace scope is required')
      }
    }
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
