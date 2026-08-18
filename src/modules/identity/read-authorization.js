import { httpError } from '@/app/api/_helpers'
import { isInstallationOperator, seesBusiness } from './viewer-authority'

function requireViewer(viewer, context) {
  if (!viewer) throw httpError(401, 'AUTH_REQUIRED')
  return viewer
}

function notFound(resource) {
  throw httpError(404, `${resource} not found`)
}

/**
 * Require the installation-wide capability for read models that enumerate
 * every tenant or expose data that cannot be filtered by the current service.
 */
export function requireInstallationOperator(viewer, resource) {
  requireViewer(viewer, resource)
  if (!isInstallationOperator(viewer)) {
    throw httpError(
      403,
      `${resource} requires operator authority — owning Businesses or Tenants does not confer it.`
    )
  }
}

export function assertBusinessReadable(viewer, businessId) {
  requireViewer(viewer, 'business read')
  if (isInstallationOperator(viewer) || seesBusiness(viewer, businessId)) return
  notFound('Business')
}

async function assertVisibleBusinessInSharedWorkspace(viewer, workspace, db) {
  if (isInstallationOperator(viewer)) return
  const visibleBusinessIds = Array.isArray(viewer.visibleBusinessIds) ? viewer.visibleBusinessIds : []
  if (!visibleBusinessIds.length || !workspace?.tenantId) notFound('Workspace')

  const where = workspace.scopeType === 'TENANT'
    ? { id: { in: visibleBusinessIds }, tenantId: workspace.tenantId }
    : { id: { in: visibleBusinessIds }, tenant: { portfolioId: workspace.portfolioId } }
  if (!(await db.business.count({ where }))) notFound('Workspace')
}

export async function assertWorkspaceReadable(viewer, workspace, { db } = {}) {
  requireViewer(viewer, 'workspace read')
  if (!workspace || workspace.status === 'ARCHIVED') notFound('Workspace')
  if (isInstallationOperator(viewer)) return { readScope: 'PLATFORM', tenantId: workspace.tenantId }

  if (workspace.scopeType === 'BUSINESS') {
    assertBusinessReadable(viewer, workspace.businessId)
    if (!workspace.tenantId) notFound('Workspace')
    return { readScope: 'BUSINESS', tenantId: workspace.tenantId }
  }
  if (!['TENANT', 'PORTFOLIO'].includes(workspace.scopeType) || !workspace.tenantId || !db) notFound('Workspace')
  await assertVisibleBusinessInSharedWorkspace(viewer, workspace, db)
  return { readScope: `${workspace.scopeType}_SHARED`, tenantId: workspace.tenantId }
}

export async function assertProjectReadable(viewer, project, { db } = {}) {
  requireViewer(viewer, 'project read')
  if (!project || project.deletedAt) notFound('Project')
  if (isInstallationOperator(viewer)) return { readScope: 'PLATFORM', tenantId: project.workspace?.tenantId || project.business?.tenantId || null }

  if (project.businessId) {
    assertBusinessReadable(viewer, project.businessId)
    const tenantId = project.business?.tenantId || project.workspace?.tenantId || null
    if (!tenantId || (project.workspace?.scopeType === 'BUSINESS' && project.workspace.businessId !== project.businessId)) {
      notFound('Project')
    }
    if (project.workspace?.tenantId && project.workspace.tenantId !== tenantId) notFound('Project')
    return { readScope: 'BUSINESS', tenantId }
  }

  const workspace = project.workspace
  if (!workspace || !['TENANT', 'PORTFOLIO'].includes(workspace.scopeType) || !workspace.tenantId || !db) {
    notFound('Project')
  }
  await assertVisibleBusinessInSharedWorkspace(viewer, workspace, db)
  return { readScope: `${workspace.scopeType}_SHARED`, tenantId: workspace.tenantId }
}

export async function assertTenantReadable(viewer, tenantId, { db } = {}) {
  requireViewer(viewer, 'tenant read')
  if (isInstallationOperator(viewer)) return
  if (!tenantId || !db) notFound('Tenant')
  const visibleBusinessIds = Array.isArray(viewer.visibleBusinessIds) ? viewer.visibleBusinessIds : []
  if (!(await db.business.count({ where: { id: { in: visibleBusinessIds }, tenantId } }))) notFound('Tenant')
}
