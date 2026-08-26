import prisma from '@/lib/db'
import { assertProjectReadable } from './project-inventory-read-model'
import { listWork } from './work-service'

// @req FR-005, FR-046, FR-068 — scoped WorkItem reads use the same neutral
// work model and trusted viewer boundary as the HTTP Project Manager surface.
// @spec SEC-001, SEC-008
// @tested tests/unit/project-manager-mcp.test.js, tests/unit/authorization-seam-list-routes.test.js, tests/integration/work-listing-scope.test.js

function notFound(message) {
  const error = new Error(message)
  error.status = 404
  return error
}

const projectVisibilitySelect = {
  id: true,
  deletedAt: true,
  businessId: true,
  business: { select: { tenantId: true } },
  workspace: { select: { businessId: true, scopeType: true, tenantId: true, portfolioId: true } },
}

export async function assertProjectVisibleForWorkRead(projectId, viewer, { db = prisma } = {}) {
  const project = await db.project.findUnique({
    where: { id: projectId },
    select: projectVisibilitySelect,
  })
  if (!project || project.deletedAt) throw notFound('Project not found')
  await assertProjectReadable(viewer, project, { db })
  return project
}

export async function assertWorkstreamVisibleForWorkRead(workstreamId, viewer, { db = prisma } = {}) {
  const workstream = await db.workstream.findUnique({
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
    throw notFound('Workstream not found')
  }
  await assertProjectReadable(viewer, project, { db })
  return workstream
}

export async function listWorkForViewer({
  projectId,
  workstreamId,
  executionMode,
  subtype,
  status,
  q,
} = {}, { viewer, db = prisma } = {}) {
  if (!projectId && !workstreamId) {
    const error = new Error('A Project or Workstream scope is required')
    error.status = 403
    throw error
  }
  if (projectId) await assertProjectVisibleForWorkRead(projectId, viewer, { db })
  if (workstreamId) await assertWorkstreamVisibleForWorkRead(workstreamId, viewer, { db })
  return listWork({ projectId, workstreamId, executionMode, subtype, status, q })
}
