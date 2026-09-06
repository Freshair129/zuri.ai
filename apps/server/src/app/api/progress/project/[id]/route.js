// @req FR-011 — compute weighted project roll-up of workstream progress
// @req FR-046 — a Project progress read resolves and checks the target scope
// before the calculator reads workstreams and refreshes cache state.
// @spec SEC-001, SEC-008
// @tested tests/unit/authorization-seam-routes.test.js
import prisma from '@/lib/db'
import { handle, httpError } from '../../../_helpers'
import { computeProjectProgress } from '@/modules/project-manager/application/progress-service'
import { resolveRequestViewer } from '@/modules/identity/request-viewer'
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

export async function GET(request, { params }) {
  return handle(async () => {
    const viewer = await resolveRequestViewer(request)
    await assertProjectVisible(params.id, viewer)
    return computeProjectProgress(params.id)
  })
}
