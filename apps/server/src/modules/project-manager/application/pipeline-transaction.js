import { hasSuperadminGrant } from '@/modules/identity/superadmin-grant'
// @req FR-084 — one provider-owned graph transaction, authority refresh and CAS fence.
// @spec ADR-035, SEC-001, SDD-046
// @tested tests/integration/plan-delta.test.js
// @tested tests/postgres/pipeline-handoff-races.test.js
import { resolveViewer } from '@/modules/identity/resolve-viewer'
import { assertProjectWritable } from './project-authorization'
import { ownsBusiness } from '@/modules/identity/viewer-authority'

import { PIPELINE_GRAPH_LOCK, pipelineError, isPipelineTransaction, pipelineTransactionFacade, isPostgres, lockPipelineGraph, withPipelineTransaction } from './pipeline-writer'
export { PIPELINE_GRAPH_LOCK, pipelineError, isPipelineTransaction, pipelineTransactionFacade, isPostgres, lockPipelineGraph, withPipelineTransaction }

// Lock current resolver inputs, not a caller-supplied grant list. Names below
// are fixed code constants, values are bound parameters. The rows/fingerprints
// stay internal and must never be added to response DTOs.
async function currentRows(tx, model, delegate, where, postgres, write) {
  const rows = await tx[delegate].findMany({ where, orderBy: { id: 'asc' } })
  if (postgres && write) for (const row of rows) await tx.$queryRawUnsafe(`SELECT "id" FROM "${model}" WHERE "id"=$1 FOR SHARE`, row.id)
  return rows.map(row => ({ model, id: row.id, row }))
}

export async function resolvePipelineActor(tx, suppliedViewer, { postgres = false, write = false } = {}) {
  const principalId = suppliedViewer?.principal?.id
  if (!principalId) throw pipelineError('UNAUTHENTICATED', 401)
  const rows = await currentRows(tx, 'Person', 'person', { id: principalId }, postgres, write)
  if (!rows.length || rows[0].row.accessDisabledAt) throw pipelineError('SCOPE_UNAVAILABLE', 404)
  rows.push(...await currentRows(tx, 'Membership', 'membership', { personId: principalId }, postgres, write))
  rows.push(...await currentRows(tx, 'RoleBinding', 'roleBinding', { personId: principalId }, postgres, write))
  let superadminGrant = false
  if (suppliedViewer.isSuperadmin === true) {
    rows.push(...await currentRows(tx, 'PlatformGrant', 'platformGrant', { personId: principalId }, postgres, write))
    superadminGrant = await hasSuperadminGrant(principalId, tx)
  }
  const viewer = await resolveViewer({ principalId, db: tx, superadminGrant })
  return { viewer, rows }
}

export async function resolvePipelineBusinessAuthority(tx, businessId, suppliedViewer, { postgres = false, write = false } = {}) {
  const { viewer, rows } = await resolvePipelineActor(tx, suppliedViewer, { postgres, write })
  if (!ownsBusiness(viewer, businessId)) throw pipelineError('SCOPE_UNAVAILABLE', 404)
  const business = await tx.business.findUnique({ where: { id: businessId } })
  const tenant = business && await tx.tenant.findUnique({ where: { id: business.tenantId } })
  if (!business || !tenant || [business, tenant].some(row => ['DELETED', 'ARCHIVED', 'SUSPENDED'].includes(row.status))) throw pipelineError('SCOPE_UNAVAILABLE', 404)
  rows.push(...await currentRows(tx, 'Business', 'business', { id: business.id }, postgres, write))
  rows.push(...await currentRows(tx, 'Tenant', 'tenant', { id: tenant.id }, postgres, write))
  rows.push(...await currentRows(tx, 'Workspace', 'workspace', { businessId }, postgres, write))
  return { viewer, rows: rows.sort((a, b) => a.model.localeCompare(b.model) || a.id.localeCompare(b.id)), business, tenant }
}

export async function resolvePipelineAuthority(tx, projectIds, suppliedViewer, { postgres = false, write = false, workspaceId } = {}) {
  const { viewer, rows } = await resolvePipelineActor(tx, suppliedViewer, { postgres, write })
  const scopes = []
  for (const projectId of projectIds) {
    let project
    try { project = await assertProjectWritable(viewer, projectId, { db: tx }) }
    catch { throw pipelineError('SCOPE_UNAVAILABLE', 404) }
    const workspace = await tx.workspace.findUnique({ where: { id: project.workspaceId } })
    const business = await tx.business.findUnique({ where: { id: project.businessId || workspace?.businessId || '' } })
    const tenant = business && await tx.tenant.findUnique({ where: { id: business.tenantId } })
    if (!workspace || !business || !tenant || (workspace.businessId && workspace.businessId !== business.id) || (workspace.tenantId && workspace.tenantId !== tenant.id) || [workspace, business, tenant].some(row => ['DELETED', 'ARCHIVED', 'SUSPENDED'].includes(row.status))) throw pipelineError('SCOPE_UNAVAILABLE', 404)
    if (workspaceId && workspaceId !== workspace.id) throw pipelineError('SCOPE_UNAVAILABLE', 404)
    for (const [model, delegate, row] of [['Project', 'project', project], ['Workspace', 'workspace', workspace], ['Business', 'business', business], ['Tenant', 'tenant', tenant]]) {
      const lockedRows = await currentRows(tx, model, delegate, { id: row.id }, postgres, write)
      if (model !== 'Project') rows.push(...lockedRows)
    }
    scopes.push({ project, workspace, business, tenant })
  }
  if (new Set(scopes.map(scope => scope.tenant.id)).size !== 1) throw pipelineError('SCOPE_UNAVAILABLE', 404)
  const unique = new Map(rows.map(row => [row.model + ':' + row.id, row]))
  return { viewer, scopes, rows: [...unique.values()].sort((a, b) => a.model.localeCompare(b.model) || a.id.localeCompare(b.id)) }
}

// Legacy full envelopes retain Enterprise API service-account authority. Re-read
// its actual credential row under the same fence instead of trusting a cached DTO.
export async function resolvePipelineImportViewer(tx, workspace, suppliedViewer, settings = {}) {
  if (suppliedViewer?.isApiAccess !== true) return (await resolvePipelineBusinessAuthority(tx, workspace.businessId, suppliedViewer, settings)).viewer
  const rows = await currentRows(tx, 'ApiAccessKey', 'apiAccessKey', { id: suppliedViewer.serviceAccountId || '' }, settings.postgres, true)
  const key = rows[0]?.row
  const business = await tx.business.findUnique({ where: { id: workspace.businessId || '' } })
  const tenant = business && await tx.tenant.findUnique({ where: { id: business.tenantId } })
  if (!key || key.status !== 'ACTIVE' || !business || !tenant || key.tenantId !== tenant.id || key.tenantId !== suppliedViewer.tenantId || [business,tenant].some(row=>['DELETED','ARCHIVED','SUSPENDED'].includes(row.status))) throw pipelineError('SCOPE_UNAVAILABLE',404)
  for (const [model,delegate,id] of [['Business','business',business.id],['Tenant','tenant',tenant.id]]) await currentRows(tx,model,delegate,{id},settings.postgres,true)
  await currentRows(tx,'Workspace','workspace',workspace.id ? {id:workspace.id} : {businessId:business.id},settings.postgres,true)
  return { isApiAccess:true,tenantId:key.tenantId,serviceAccountId:key.id }
}
