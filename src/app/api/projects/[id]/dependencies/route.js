// @req FR-046 — a Project dependency graph is visible only after the target
// Project's Business scope has been resolved and checked.
// @spec SEC-001, SEC-008
// @tested tests/unit/authorization-seam-routes.test.js
import prisma from '@/lib/db'
import { handle, httpError } from '../../../_helpers'
import { getProjectDependencyGraph } from '@/modules/project-manager/application/dependency-service'
import { resolveRequestViewer } from '@/modules/identity/request-viewer'
import { assertProjectReadable } from '@/modules/project-manager/application/project-inventory-read-model'

// @req FR-040 - expose a Project-contained Dependency Map read contract.
// @spec SDD-019, ADR-012
// @tested tests/unit/project-dependency-route.test.js
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

export async function GET(request, { params }) {
  return handle(async () => {
    const viewer = await resolveRequestViewer(request)
    await assertProjectVisible(params.id, viewer)
    return getProjectDependencyGraph(params.id)
  })
}
