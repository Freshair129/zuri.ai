import prisma from '@/lib/db'
import { handle, httpError } from '../../../_helpers'
import { resolveRequestViewer } from '@/modules/identity/request-viewer'
import { assertProjectReadable } from '@/modules/project-manager/application/project-inventory-read-model'

// @req FR-017 — the work-breakdown tree (Project → Workstream → WorkContainer → WorkItem)
//   backing the Structure Plan (WBS) canvas.
// @tested tests/integration/project-core.test.js
// @req FR-046 — resolve the Project scope before loading its work-breakdown
// children.
// @spec SEC-001, SEC-008
// @tested tests/unit/authorization-seam-routes.test.js
export const dynamic = 'force-dynamic'

export async function GET(request, { params }) {
  const { id: projectId } = params
  return handle(async () => {
    const viewer = await resolveRequestViewer(request)
    const target = await prisma.project.findUnique({
      where: { id: projectId },
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
    const project = await prisma.project.findUnique({
      where: { id: projectId },
      include: {
        workspace: true,
        workstreams: {
          orderBy: { createdAt: 'asc' },
          include: {
            containers: {
              where: { parentId: null },
              orderBy: { createdAt: 'asc' },
              include: {
                items: { where: { deletedAt: null }, orderBy: { createdAt: 'asc' } },
                children: {
                  orderBy: { createdAt: 'asc' },
                  include: { items: { where: { deletedAt: null }, orderBy: { createdAt: 'asc' } } },
                },
              },
            },
            items: { where: { deletedAt: null, containerId: null }, orderBy: { createdAt: 'asc' } },
          },
        },
      },
    })
    if (!project) throw httpError(404, 'Project not found')
    return project
  })
}
