// @req FR-037 — Project Files list/create route.
// @spec SDD-016, SEC-003, docs/features/FR-037-project-files.md
// @tested tests/unit/project-file-service.test.js
// @req FR-046 — every mutating request resolves one trusted viewer and fails closed.
// @req FR-072 — the service refuses this write unless the viewer owns the governing Business.
// @spec SEC-001, SEC-008
// @tested tests/integration/fr072-project-file-authorization.test.js
// @req FR-046 — Project file reads resolve and check the target Project before
// the compatibility file read model runs.
// @spec SEC-001, SEC-008
// @tested tests/unit/authorization-seam-routes.test.js
import prisma from '@/lib/db'
import { handle, httpError } from '../../../_helpers'
import { createProjectFile, listProjectFiles } from '@/modules/project-manager/application/project-file-service'
import { resolveRequestViewer } from '@/modules/identity/request-viewer'
import { assertProjectReadable } from '@/modules/project-manager/application/project-inventory-read-model'

export const dynamic = 'force-dynamic'

export async function GET(request, { params }) {
  return handle(async () => {
    const viewer = await resolveRequestViewer(request)
    const project = await prisma.project.findUnique({
      where: { id: params.id },
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
    return listProjectFiles(params.id)
  })
}

export async function POST(request, { params }) {
  return handle(async () => {
    const viewer = await resolveRequestViewer(request)
    return createProjectFile(params.id, await request.json(), { viewer })
  })
}
