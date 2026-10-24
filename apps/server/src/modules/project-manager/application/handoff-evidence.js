// @req FR-084 — both endpoint read scopes precede any acceptance evidence read.
// @spec SEC-001, SEC-008, ADR-035
// @tested tests/integration/dependency-handoff.test.js
import { isApiAccessFor } from '@/modules/identity/viewer-authority'
import { assertProjectReadable } from './project-inventory-read-model'
import { handoffContractState, readStoredHandoff } from './handoff-contract'

const models = { PROJECT: 'project', WORKSTREAM: 'workstream', WORK_CONTAINER: 'workContainer', WORK_ITEM: 'workItem', MILESTONE: 'milestone', GATE: 'gate' }
export async function dependencyEndpointScope(db, type, id) {
  const row = models[type] && await db[models[type]].findUnique({ where: { id } })
  if (!row || row.deletedAt) return null
  const ws = type === 'WORKSTREAM' ? row : row.workstreamId ? await db.workstream.findUnique({ where: { id: row.workstreamId } }) : null
  if (ws?.deletedAt) return null
  const projectId = type === 'PROJECT' ? id : row.projectId || ws?.projectId
  if (!projectId) return null
  const project = await db.project.findUnique({ where: { id: projectId }, include: { business: true, workspace: true } })
  if (project && !project.businessId && project.workspace?.businessId) {
    project.businessId = project.workspace.businessId
    project.business = await db.business.findUnique({ where: { id: project.businessId } })
  }
  return project && !project.deletedAt ? { row, project, workstreamId: ws?.id || null } : null
}

export async function authorizeDependencyRead(db, edge, viewer) {
  const scopes = await Promise.all([dependencyEndpointScope(db, edge.sourceType, edge.sourceId), dependencyEndpointScope(db, edge.targetType, edge.targetId)])
  if (scopes.some(scope => !scope)) return null
  try { for (const scope of scopes) await assertProjectReadable(viewer, scope.project, { db }) } catch { return null }
  return scopes
}

export async function dependencyEvidenceState(db, edge, scopes) {
  if (!scopes || scopes.length !== 2) return 'INVALID'
  const acceptance = readStoredHandoff(edge.contractJson)?.acceptance
  const predecessor = scopes[edge.dependencyType === 'REQUIRES' ? 1 : 0]
  const gate = acceptance?.kind === 'GATE' ? await db.gate.findUnique({ where: { id: acceptance.gateId } }) : null
  const actor = acceptance?.kind === 'MANUAL' ? await db.person.findUnique({ where: { id: acceptance.actorPersonId } }) : null
  const audit = acceptance?.kind === 'MANUAL' ? await db.auditEvent.findUnique({ where: { id: acceptance.decisionAuditEventId } }) : null
  if (gate && (gate.projectId !== predecessor.project.id || (gate.workstreamId && gate.workstreamId !== predecessor.workstreamId))) return 'INVALID'
  if (audit && !scopes.some(scope => scope.project.businessId === audit.businessId && scope.project.business?.tenantId === audit.tenantId)) return 'INVALID'
  return handoffContractState(edge.contractJson, { gate, actor, audit, dependency: edge })
}

export async function readablePipelineProjects(db, projectIds, viewer) {
  const result=[]
  for (const id of new Set(projectIds)) {
    const scope=await dependencyEndpointScope(db,'PROJECT',id)
    if (!scope) continue
    try { if(!isApiAccessFor(viewer,scope.project.business?.tenantId || scope.project.workspace?.tenantId)) await assertProjectReadable(viewer,scope.project,{db}); result.push(id) } catch { /* opaque predecessor */ }
  }
  return result
}
