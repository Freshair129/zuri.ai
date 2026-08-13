import prisma from '@/lib/db'
import { uniqueHumanCode } from '@/lib/ids'
import {
  zProjectInput,
  zProjectUpdate,
  zWorkstreamInput,
  zWorkstreamUpdate,
} from '@/lib/validation/entities'
import { MODE_DEFAULT_STRATEGY } from '@/lib/validation/enums'
import { recordAudit } from './audit'

// @req FR-003, FR-004 — project CRUD/archive + workstream mode/strategy/weight
// @spec BR-004, SDD-004 — seven canonical modes (Zod-enforced); archive is a
// soft delete (deletedAt) with a version counter, never a hard delete
// @req FR-043 - direct Project Business ownership with Space as Development context
// @spec ADR-014, SDD-021, BR-001, SEC-001
// @tested tests/integration/project-core.test.js, tests/integration/project-business-binding.test.js

const codeExists = (model) => async (code) =>
  Boolean(await prisma[model].findUnique({ where: { code } }))

const hasOwn = (value, key) => Object.prototype.hasOwnProperty.call(value, key)

/**
 * Resolve and enforce the Project owner/Space invariant. A null owner is only
 * valid for a portfolio/tenant shared Space; Business Spaces always own their
 * Projects directly.
 */
function resolveProjectBusinessId(workspace, requestedBusinessId, explicit = false) {
  const spaceBusinessId = workspace.businessId || null
  if (workspace.scopeType === 'BUSINESS' && !spaceBusinessId) {
    throw new Error('Business Space must have a Business owner')
  }
  if (spaceBusinessId && workspace.scopeType !== 'BUSINESS') {
    throw new Error('Business-owned Project requires a BUSINESS Space')
  }
  if (explicit && requestedBusinessId === null && spaceBusinessId) {
    throw new Error('Business Space Project cannot have a null Business owner')
  }
  const businessId = explicit ? (requestedBusinessId || null) : spaceBusinessId
  if (businessId !== spaceBusinessId) {
    throw new Error('Project Business owner must match its Space Business')
  }
  return businessId
}

export async function listProjects({ workspaceId, businessId, tenantId, status, q } = {}) {
  const where = { deletedAt: null }
  if (workspaceId) where.workspaceId = workspaceId
  if (status) where.status = status
  if (q) {
    where.OR = [{ name: { contains: q } }, { code: { contains: q } }]
  }
  // Tenant isolation flows through the Space; Business ownership is direct.
  if (businessId || tenantId) {
    where.workspace = {}
    if (businessId) where.businessId = businessId
    if (tenantId) where.workspace.tenantId = tenantId
  }
  return prisma.project.findMany({
    where,
    orderBy: { updatedAt: 'desc' },
    include: {
      business: { select: { id: true, code: true, name: true, tenantId: true } },
      workspace: { select: { code: true, name: true, businessId: true, tenantId: true, scopeType: true } },
      workstreams: { where: { deletedAt: null } },
      milestones: true,
      gates: true,
    },
  })
}

export async function getProject(id) {
  return prisma.project.findUnique({
    where: { id },
    include: {
      business: true,
      workspace: true,
      workstreams: {
        where: { deletedAt: null },
        include: { containers: true, items: { where: { deletedAt: null } } },
      },
      milestones: { orderBy: { targetAt: 'asc' } },
      gates: { orderBy: { createdAt: 'asc' } },
      repositories: { include: { repo: true } },
    },
  })
}

export async function createProject(input) {
  const data = zProjectInput.parse(input)
  const workspace = await prisma.workspace.findUnique({ where: { id: data.workspaceId } })
  if (!workspace) throw new Error('Workspace not found')
  const businessId = resolveProjectBusinessId(workspace, data.businessId, hasOwn(data, 'businessId'))
  const code = data.code || (await uniqueHumanCode('PRJ', data.name, codeExists('project')))
  const project = await prisma.project.create({
    data: {
      code,
      businessId,
      workspaceId: data.workspaceId,
      name: data.name,
      description: data.description ?? null,
      type: data.type || 'GENERAL',
      status: data.status || 'PLANNED',
      startAt: data.startAt ?? null,
      targetAt: data.targetAt ?? null,
    },
  })
  await recordAudit(prisma, { entityType: 'PROJECT', entityId: project.id, action: 'CREATED', payload: { code, businessId, workspaceId: data.workspaceId } })
  return project
}

export async function updateProject(id, patch) {
  const data = zProjectUpdate.parse(patch)
  const existing = await prisma.project.findUnique({ where: { id }, include: { workspace: true } })
  if (!existing || existing.deletedAt) throw new Error('Project not found')
  const targetWorkspaceId = data.workspaceId ?? existing.workspaceId
  const targetWorkspace = targetWorkspaceId === existing.workspaceId
    ? existing.workspace
    : await prisma.workspace.findUnique({ where: { id: targetWorkspaceId } })
  if (!targetWorkspace) throw new Error('Workspace not found')
  const workspaceChanged = targetWorkspaceId !== existing.workspaceId
  const explicitBusiness = hasOwn(data, 'businessId')
  const requestedBusinessId = explicitBusiness
    ? data.businessId
    : workspaceChanged
      ? targetWorkspace.businessId
      : (existing.businessId ?? targetWorkspace.businessId ?? null)
  const businessId = resolveProjectBusinessId(targetWorkspace, requestedBusinessId, explicitBusiness || workspaceChanged)
  if (workspaceChanged && existing.businessId && businessId && existing.businessId !== businessId) {
    throw new Error('Cannot move a Project across Business Spaces')
  }
  const project = await prisma.project.update({
    where: { id },
    data: {
      businessId,
      workspaceId: targetWorkspaceId,
      name: data.name ?? existing.name,
      description: data.description === undefined ? existing.description : data.description,
      type: data.type ?? existing.type,
      status: data.status ?? existing.status,
      startAt: data.startAt === undefined ? existing.startAt : data.startAt,
      targetAt: data.targetAt === undefined ? existing.targetAt : data.targetAt,
      version: { increment: 1 },
    },
  })
  await recordAudit(prisma, { entityType: 'PROJECT', entityId: id, action: 'UPDATED', payload: { ...data, businessId, workspaceId: targetWorkspaceId } })
  return project
}

export async function archiveProject(id) {
  const project = await prisma.project.update({
    where: { id },
    data: { status: 'ARCHIVED', deletedAt: new Date(), version: { increment: 1 } },
  })
  await recordAudit(prisma, { entityType: 'PROJECT', entityId: id, action: 'ARCHIVED' })
  return project
}

// ---- Workstreams -----------------------------------------------------------

export async function createWorkstream(input) {
  const data = zWorkstreamInput.parse(input)
  const project = await prisma.project.findUnique({ where: { id: data.projectId } })
  if (!project || project.deletedAt) throw new Error('Project not found')
  const strategy = data.progressStrategy || MODE_DEFAULT_STRATEGY[data.executionMode]
  const code = data.code || (await uniqueHumanCode('WST', data.name, codeExists('workstream')))
  const workstream = await prisma.workstream.create({
    data: {
      code,
      projectId: data.projectId,
      name: data.name,
      executionMode: data.executionMode,
      progressStrategy: strategy,
      progressWeight: data.progressWeight ?? 1,
      status: data.status || 'PLANNED',
      viewConfigJson: JSON.stringify(data.viewConfig || {}),
    },
  })
  await recordAudit(prisma, {
    entityType: 'WORKSTREAM',
    entityId: workstream.id,
    action: 'CREATED',
    payload: { code, executionMode: data.executionMode, progressStrategy: strategy },
  })
  return workstream
}

export async function updateWorkstream(id, patch) {
  const data = zWorkstreamUpdate.parse(patch)
  const existing = await prisma.workstream.findUnique({ where: { id } })
  if (!existing || existing.deletedAt) throw new Error('Workstream not found')
  const workstream = await prisma.workstream.update({
    where: { id },
    data: {
      name: data.name ?? existing.name,
      executionMode: data.executionMode ?? existing.executionMode,
      progressStrategy: data.progressStrategy ?? existing.progressStrategy,
      progressWeight: data.progressWeight ?? existing.progressWeight,
      status: data.status ?? existing.status,
      viewConfigJson: data.viewConfig ? JSON.stringify(data.viewConfig) : existing.viewConfigJson,
      version: { increment: 1 },
    },
  })
  await recordAudit(prisma, { entityType: 'WORKSTREAM', entityId: id, action: 'UPDATED', payload: data })
  return workstream
}

export async function archiveWorkstream(id) {
  const workstream = await prisma.workstream.update({
    where: { id },
    data: { status: 'ARCHIVED', deletedAt: new Date(), version: { increment: 1 } },
  })
  await recordAudit(prisma, { entityType: 'WORKSTREAM', entityId: id, action: 'ARCHIVED' })
  return workstream
}

export async function listWorkstreams({ projectId, executionMode } = {}) {
  const where = { deletedAt: null }
  if (projectId) where.projectId = projectId
  if (executionMode) where.executionMode = executionMode
  return prisma.workstream.findMany({
    where,
    orderBy: { code: 'asc' },
    include: {
      project: { select: { id: true, code: true, name: true, businessId: true, workspaceId: true } },
      containers: { orderBy: { createdAt: 'asc' } },
      items: { where: { deletedAt: null }, orderBy: { createdAt: 'asc' } },
      milestones: true,
      gates: true,
    },
  })
}
