// @req FR-005 — list or create work items in the neutral WorkContainer/WorkItem model
// @req FR-046 — every mutating request resolves one trusted viewer and fails closed.
// @req FR-072 — the service refuses this write unless the viewer owns the governing Business.
// @spec SEC-001, SEC-008
// @tested tests/integration/fr072-work-service-authorization.test.js
// @req FR-046 — a work list resolves a trusted viewer and requires a Project
// or Workstream scope before the unscoped compatibility read runs.
// @tested tests/unit/authorization-seam-routes.test.js
import { handle, httpError, queryParams } from '../_helpers'
import prisma from '@/lib/db'
import { listWork, createItem } from '@/modules/project-manager/application/work-service'
import { resolveRequestViewer } from '@/modules/identity/request-viewer'
import { isInstallationOperator } from '@/modules/identity/viewer-authority'
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
    const allowedBusinessIds = isInstallationOperator(viewer)
      ? undefined
      : (viewer.visibleBusinessIds?.length ? viewer.visibleBusinessIds : undefined)
    if (!q.projectId && !q.workstreamId && !isInstallationOperator(viewer) && !allowedBusinessIds) {
      throw httpError(403, 'A Project or Workstream scope is required')
    }
    return listWork({
      workstreamId: q.workstreamId || undefined,
      projectId: q.projectId || undefined,
      executionMode: q.executionMode || undefined,
      subtype: q.subtype || undefined,
      status: q.status || undefined,
      q: q.q || undefined,
      businessIds: allowedBusinessIds,
    })
  })
}

export async function POST(request) {
  return handle(async () => {
    const viewer = await resolveRequestViewer(request)
    return createItem(await request.json(), { viewer })
  })
}
