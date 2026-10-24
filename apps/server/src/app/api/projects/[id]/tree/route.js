import prisma from '@/lib/db'
import { handle, httpError } from '../../../_helpers'
import { resolveRequestViewer } from '@/modules/identity/request-viewer'
import { assertProjectReadable } from '@/modules/project-manager/application/project-inventory-read-model'
import { readStructureCanvas, nestStructureContainers } from '@/modules/project-manager/application/structure-canvas'

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
    // @req FR-082 — optional authorized editing projection; plain tree stays compatible.
    // @tested tests/integration/plan-delta-moves.test.js
    const query = new URL(request.url).searchParams
    if (query.get('canvas') === '1') {
      const move = query.has('moveId') ? { type: query.get('moveType'), id: query.get('moveId') } : null
      return readStructureCanvas(projectId, { viewer, move })
    }
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
          where: { deletedAt: null },
          orderBy: { createdAt: 'asc' },
          include: {
            containers: {
              orderBy: { createdAt: 'asc' },
              include: {
                items: { where: { deletedAt: null }, orderBy: { createdAt: 'asc' } },
              },
            },
            items: { where: { deletedAt: null, containerId: null }, orderBy: { createdAt: 'asc' } },
          },
        },
      },
    })
    if (!project) throw httpError(404, 'Project not found')
    // @req FR-082 — created/reparented deep containers remain visible to read-only users.
    // @tested tests/unit/project-structure-tree.test.js
    for (const ws of project.workstreams) ws.containers = nestStructureContainers(ws.containers)
    return project
  })
}
