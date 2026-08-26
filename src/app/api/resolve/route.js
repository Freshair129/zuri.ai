// @req FR-019 — resolve external ref lookup or human code to internal id
// @req FR-106 — the Enterprise API accepts a Tenant-bound `Authorization:
// Bearer apik_...` key, checked ahead of the session seam; a key viewer
// resolves only records inside the key's own Tenant, and everything outside it
// answers exactly as a record that does not exist.
// @spec BR-002, SDD-003 — support both customer core-id mapping (system/value) and human-code lookup (type/code)
// @spec SEC-001, SEC-006
import { handle, httpError, queryParams } from '../_helpers'
import prisma from '@/lib/db'
import { lookupExternalRef, listExternalRefs } from '@/modules/project-manager/import/external-ref'
import { resolveRequestViewer } from '@/modules/identity/request-viewer'
import { resolveApiAccessViewer } from '@/modules/identity/api-access-auth'
import { isApiAccessFor, isInstallationOperator, seesBusiness } from '@/modules/identity/viewer-authority'
import { assertProjectReadable } from '@/modules/project-manager/application/project-inventory-read-model'

export const dynamic = 'force-dynamic'

const TYPE_MODEL = {
  PROJECT: 'project',
  WORKSTREAM: 'workstream',
  MILESTONE: 'milestone',
  GATE: 'gate',
  WORK_CONTAINER: 'workContainer',
  WORK_ITEM: 'workItem',
  WORKSPACE: 'workspace',
  REPOSITORY: 'repository',
}

const PROJECT_ENTITY_TYPES = new Set(
  Object.keys(TYPE_MODEL).filter((type) => type !== 'WORKSPACE' && type !== 'REPOSITORY')
)

const PROJECT_SCOPE_SELECT = {
  deletedAt: true,
  businessId: true,
  business: { select: { tenantId: true } },
  workspace: { select: { businessId: true, scopeType: true, tenantId: true, portfolioId: true } },
}

async function projectForRecord(type, record) {
  if (!record) return null
  const projectId = type === 'PROJECT'
    ? record.id
    : type === 'WORKSTREAM' || type === 'MILESTONE' || type === 'GATE'
      ? record.projectId
      : record.workstreamId
  if (!projectId) return null
  if (type === 'WORK_CONTAINER' || type === 'WORK_ITEM') {
    const workstream = await prisma.workstream.findUnique({
      where: { id: projectId },
      select: { project: { select: PROJECT_SCOPE_SELECT } },
    })
    return workstream?.project || null
  }
  return prisma.project.findUnique({ where: { id: projectId }, select: PROJECT_SCOPE_SELECT })
}

async function assertWorkspaceVisible(workspaceId, viewer, notFoundMessage) {
  const workspace = await prisma.workspace.findUnique({
    where: { id: workspaceId },
    select: { businessId: true, scopeType: true, tenantId: true, portfolioId: true },
  })
  if (!workspace) throw httpError(404, notFoundMessage)
  if (isInstallationOperator(viewer)) return
  if (workspace.businessId) {
    if (!seesBusiness(viewer, workspace.businessId)) throw httpError(404, notFoundMessage)
    return
  }
  const visibleBusinessIds = Array.isArray(viewer.visibleBusinessIds)
    ? viewer.visibleBusinessIds.filter((businessId) => seesBusiness(viewer, businessId))
    : []
  const where = workspace.scopeType === 'TENANT'
    ? { id: { in: visibleBusinessIds }, tenantId: workspace.tenantId }
    : workspace.scopeType === 'PORTFOLIO'
      ? { id: { in: visibleBusinessIds }, tenant: { portfolioId: workspace.portfolioId } }
      : null
  if (!where || !(await prisma.business.count({ where }))) throw httpError(404, notFoundMessage)
}

/**
 * @req FR-106 — an Enterprise API key viewer resolves the record's Tenant from
 * the database (never from the request) and sees it only when that Tenant is
 * the key's own. Every other outcome — other Tenant, no resolvable Tenant,
 * dangling scope — throws the identical not-found the session path throws, so
 * a key can never be used to enumerate what exists outside its Tenant
 * (SEC-001, SEC-006, BR-002).
 */
async function assertKeyViewerVisible(type, record, viewer, notFoundMessage) {
  let tenantId = null
  if (PROJECT_ENTITY_TYPES.has(type)) {
    const project = await projectForRecord(type, record)
    if (!project || project.deletedAt) throw httpError(404, notFoundMessage)
    tenantId = project.business?.tenantId || project.workspace?.tenantId || null
  } else if (type === 'WORKSPACE') {
    const workspace = await prisma.workspace.findUnique({
      where: { id: record.id },
      select: { tenantId: true, business: { select: { tenantId: true } } },
    })
    tenantId = workspace?.business?.tenantId || workspace?.tenantId || null
  } else if (type === 'REPOSITORY') {
    const business = record.businessId
      ? await prisma.business.findUnique({ where: { id: record.businessId }, select: { tenantId: true } })
      : null
    tenantId = business?.tenantId || null
  }
  if (!isApiAccessFor(viewer, tenantId)) throw httpError(404, notFoundMessage)
}

async function assertResolvedVisible(type, record, viewer, notFoundMessage) {
  if (viewer?.isApiAccess === true) {
    return assertKeyViewerVisible(type, record, viewer, notFoundMessage)
  }
  if (PROJECT_ENTITY_TYPES.has(type)) {
    const project = await projectForRecord(type, record)
    if (!project || project.deletedAt) throw httpError(404, notFoundMessage)
    await assertProjectReadable(viewer, project, { db: prisma })
    return
  }
  if (type === 'WORKSPACE') {
    await assertWorkspaceVisible(record.id, viewer, notFoundMessage)
    return
  }
  if (type === 'REPOSITORY' && seesBusiness(viewer, record.businessId)) return
  throw httpError(404, notFoundMessage)
}

// Resolve to an internal id, either by our human code (`type` + `code`) or by
// the customer's own core id (`system` + `value`) — FR-019.
export async function GET(request) {
  const { type, code, system, value } = queryParams(request)
  return handle(async () => {
    const viewer = (await resolveApiAccessViewer(request)) ?? await resolveRequestViewer(request)
    if (system || value) {
      if (!system || !value) throw httpError(400, 'Both system and value are required to resolve an external id')
      const hit = await lookupExternalRef(system, value)
      if (!hit) throw httpError(404, `External id ${system}:${value} is not mapped to any record`)
      if (!hit.record) {
        // A dangling mapping has no surviving scope row to authorize against.
        // Keep its existence installation-operator-only; ordinary viewers get
        // the same not-found answer as an unknown external id.
        if (!isInstallationOperator(viewer)) throw httpError(404, `External id ${system}:${value} is not mapped to any record`)
        throw httpError(410, `External id ${system}:${value} maps to a record that no longer exists`)
      }
      await assertResolvedVisible(hit.ref.entityType, hit.record, viewer, `External id ${system}:${value} is not mapped to any record`)
      return {
        id: hit.record.id,
        code: hit.record.code,
        type: hit.ref.entityType,
        externalRef: {
          system: hit.ref.system,
          value: hit.ref.value,
          labelAs: hit.ref.labelAs,
          verifiedAt: hit.ref.verifiedAt,
        },
      }
    }
    const model = TYPE_MODEL[type]
    if (!model) throw new Error(`Unknown entity type: ${type}`)
    const record = await prisma[model].findUnique({ where: { code } })
    const notFoundMessage = `${type} with code "${code}" not found`
    if (!record) throw new Error(notFoundMessage)
    await assertResolvedVisible(type, record, viewer, notFoundMessage)
    return {
      id: record.id,
      code: record.code,
      type,
      externalRefs: await listExternalRefs({ entityType: type, entityId: record.id }),
    }
  })
}
