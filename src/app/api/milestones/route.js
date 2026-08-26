// @req FR-006 — list or create weighted milestones with gates
// @req FR-046 — every mutating request resolves one trusted viewer and fails closed.
// @req FR-072 — the service refuses this write unless the viewer owns the governing Business.
// @spec SEC-001, SEC-008
// @tested tests/integration/fr072-milestone-gate-authorization.test.js
// @req FR-046 — a milestone/gate list resolves a trusted viewer and requires
// a Project, Workstream or visible Business scope before the read runs.
// @tested tests/unit/authorization-seam-routes.test.js
import { handle, httpError, queryParams } from '../_helpers'
import prisma from '@/lib/db'
import { listMilestonesAndGates, createMilestone } from '@/modules/project-manager/application/milestone-gate-service'
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

async function assertWorkstreamVisible(workstreamId, viewer) {
  const workstream = await prisma.workstream.findUnique({
    where: { id: workstreamId },
    select: {
      id: true,
      deletedAt: true,
      project: {
        select: {
          deletedAt: true,
          businessId: true,
          business: { select: { tenantId: true } },
          workspace: { select: { businessId: true, scopeType: true, tenantId: true, portfolioId: true } },
        },
      },
    },
  })
  const project = workstream?.project
  if (!workstream || workstream.deletedAt || !project || project.deletedAt) {
    throw httpError(404, 'Workstream not found')
  }
  await assertProjectReadable(viewer, project, { db: prisma })
}

export async function GET(request) {
  return handle(async () => {
    const viewer = await resolveRequestViewer(request)
    const q = queryParams(request)
    if (q.projectId) await assertProjectVisible(q.projectId, viewer)
    if (q.workstreamId) await assertWorkstreamVisible(q.workstreamId, viewer)
    if (!q.projectId && !q.workstreamId && q.businessId && !seesBusiness(viewer, q.businessId)) {
      throw httpError(404, 'Business not found')
    }
    if (!q.projectId && !q.workstreamId && !q.businessId && !isInstallationOperator(viewer)) {
      throw httpError(403, 'A Project, Workstream or Business scope is required')
    }
    const filters = {}
    if (q.projectId) filters.projectId = q.projectId
    if (q.workstreamId) filters.workstreamId = q.workstreamId
    if (q.businessId) filters.businessId = q.businessId
    return listMilestonesAndGates(filters)
  })
}

export async function POST(request) {
  return handle(async () => {
    const viewer = await resolveRequestViewer(request)
    return createMilestone(await request.json(), { viewer })
  })
}
