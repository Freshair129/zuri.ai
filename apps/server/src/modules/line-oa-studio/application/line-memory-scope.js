import prisma from '@/lib/db'

/** Resolve only a live Project and its same-tenant, same-business Workspace. */
export async function resolveLineMemoryProject({ db = prisma, tenantId, businessId, projectId } = {}) {
  if (![tenantId, businessId, projectId].every(value => typeof value === 'string' && value.trim())) return null
  const [business, project] = await Promise.all([
    db.business.findUnique({ where: { id: businessId }, select: { tenantId: true, status: true } }),
    db.project.findUnique({ where: { id: projectId }, include: { workspace: true } }),
  ])
  const workspace = project?.workspace
  if (!business || business.tenantId !== tenantId || business.status !== 'ACTIVE'
    || !project || project.businessId !== businessId || project.deletedAt || project.status === 'ARCHIVED'
    || !workspace || workspace.id !== project.workspaceId || workspace.tenantId !== tenantId
    || workspace.businessId !== businessId || workspace.status !== 'ACTIVE') return null
  return { projectId: project.id, workspaceId: workspace.id }
}

/** Publisher-facing choices are restricted to this account's valid Project scopes. */
export async function listLineMemoryProjects({ db = prisma, tenantId, businessId } = {}) {
  if (![tenantId, businessId].every(value => typeof value === 'string' && value.trim())) return []
  const business = await db.business.findUnique({ where: { id: businessId }, select: { tenantId: true, status: true } })
  if (!business || business.tenantId !== tenantId || business.status !== 'ACTIVE') return []
  const rows = await db.project.findMany({
    where: { businessId, deletedAt: null, status: { not: 'ARCHIVED' },
      workspace: { is: { tenantId, businessId, status: 'ACTIVE' } } },
    orderBy: [{ name: 'asc' }, { id: 'asc' }],
    select: { id: true, code: true, name: true, workspace: { select: { name: true } } },
  })
  return rows.map(row => ({ id: row.id, code: row.code, name: row.name, workspaceName: row.workspace.name }))
}
