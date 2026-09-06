// @req FR-003 — project CRUD: get, update, and archive
// @req FR-046 — every mutating request resolves one trusted viewer and fails closed.
// @req FR-072 — the service refuses this write unless the viewer owns the governing Business.
// @spec SEC-001, SEC-008
// @tested tests/integration/fr072-project-service-authorization.test.js
// @req FR-046 — the Project read resolves and checks the target scope before
// the relation-rich read model runs.
// @spec SEC-001, SEC-008
// @tested tests/unit/authorization-seam-routes.test.js
import prisma from '@/lib/db'
import { handle, httpError } from '../../_helpers'
import { getProject, updateProject, archiveProject } from '@/modules/project-manager/application/project-service'
import { resolveRequestViewer } from '@/modules/identity/request-viewer'
import { assertProjectReadable } from '@/modules/project-manager/application/project-inventory-read-model'

export const dynamic = 'force-dynamic'

export async function GET(request, { params }) {
  return handle(async () => {
    const viewer = await resolveRequestViewer(request)
    const target = await prisma.project.findUnique({
      where: { id: params.id },
      select: {
        id: true,
        deletedAt: true,
        businessId: true,
        business: { select: { tenantId: true } },
        workspace: { select: { businessId: true, scopeType: true, tenantId: true, portfolioId: true } },
      },
    })
    if (!target || target.deletedAt) {
      throw httpError(404, 'Project not found')
    }
    await assertProjectReadable(viewer, target, { db: prisma })
    const project = await getProject(params.id)
    if (!project) throw new Error('Project not found')
    return project
  })
}

export async function PATCH(request, { params }) {
  return handle(async () => {
    const viewer = await resolveRequestViewer(request)
    return updateProject(params.id, await request.json(), { viewer })
  })
}

export async function DELETE(request, { params }) {
  return handle(async () => archiveProject(params.id, { viewer: await resolveRequestViewer(request) }))
}
