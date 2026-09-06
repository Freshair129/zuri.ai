// @req FR-007 — list or create dependencies with self/cycle rejection and blocked evaluation
// @req FR-046 — every mutating request resolves one trusted viewer and fails closed.
// @req FR-072 — the service refuses this write unless the viewer owns the governing Business.
// @spec SEC-001, SEC-008
// @tested tests/integration/fr072-dependency-authorization.test.js
// @req FR-046 — a dependency list resolves a trusted viewer and requires a
// Project or visible Business scope before the compatibility read runs.
// @tested tests/unit/authorization-seam-routes.test.js
import { handle, httpError, queryParams } from '../_helpers'
import prisma from '@/lib/db'
import { listDependencies, createDependency } from '@/modules/project-manager/application/dependency-service'
import { resolveRequestViewer } from '@/modules/identity/request-viewer'
import { isInstallationOperator, seesBusiness } from '@/modules/identity/viewer-authority'
import { assertProjectReadable } from '@/modules/project-manager/application/project-inventory-read-model'

export const dynamic = 'force-dynamic'

async function assertProjectVisible(projectId, viewer) {
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: {
      id: true,
      deletedAt: true,
      businessId: true,
      business: { select: { tenantId: true } },
      workspace: { select: { businessId: true, scopeType: true, tenantId: true, portfolioId: true } },
    },
  })
  if (!project || project.deletedAt) {
    throw httpError(404, 'Project not found')
  }
  await assertProjectReadable(viewer, project, { db: prisma })
}

export async function GET(request) {
  return handle(async () => {
    const viewer = await resolveRequestViewer(request)
    const q = queryParams(request)
    if (q.projectId) await assertProjectVisible(q.projectId, viewer)
    else if (q.businessId) {
      if (!seesBusiness(viewer, q.businessId)) throw httpError(404, 'Business not found')
    } else if (!isInstallationOperator(viewer)) throw httpError(403, 'A Project scope is required')
    const filters = {}
    if (q.projectId) filters.projectId = q.projectId
    if (q.businessId) filters.businessId = q.businessId
    return listDependencies(filters)
  })
}

export async function POST(request) {
  return handle(async () => {
    const viewer = await resolveRequestViewer(request)
    return createDependency(await request.json(), { viewer })
  })
}
