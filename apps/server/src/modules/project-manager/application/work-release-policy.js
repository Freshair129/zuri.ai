// @req FR-085 — authorized release explanation and protected CRUD entry use one predicate.
// @spec ADR-035, BR-017, SEC-001, SEC-008
// @tested tests/unit/work-release-policy.test.js, tests/integration/work-release-gates.test.js
import prisma from '@/lib/db'
import {PIPELINE_PROTECTED_WORK_STATUSES} from '@/lib/validation/enums'
import {dependencyEndpointScope} from './handoff-evidence'
import {assertProjectReadable} from './project-inventory-read-model'
import {withPipelineTransaction,pipelineError,resolvePipelineAuthority,isPostgres} from './pipeline-transaction'
import {pipelineReleaseState,readPipelineState,hydratePipelineGates,buildPipelineReleaseIndex} from './pipeline-state'
import {readPlanDeltaSnapshot,pipelineReadableProjects,readPipelineEvidence} from '../import/plan-delta-service'

export function requiresWorkRelease(before,after) {
 return Boolean(after && !after.deletedAt && PIPELINE_PROTECTED_WORK_STATUSES.includes(after.status) &&
  (!before || before.status!==after.status || before.workstreamId!==after.workstreamId || before.containerId!==after.containerId))
}

// Snapshot and provenance loading are shared with import/undo. Gate hydration and
// audit reads happen only after the WorkItem and governing Project are readable.
export async function getWorkItemReleaseStates(ids,{viewer,db=prisma}={}) {
 return withPipelineTransaction(db,async tx=>{
  const unique=[...new Set(ids)],result={}
  if(!unique.length)return result
  const items=await tx.workItem.findMany({where:{id:{in:unique},deletedAt:null},include:{workstream:{include:{project:{include:{business:true,workspace:{include:{business:true}}}}}}}})
  if(items.length!==unique.length)throw pipelineError('SCOPE_UNAVAILABLE',404)
  const projects=new Map(),tenants=new Map()
  for(const item of items) {
   const ws=item.workstream,raw=ws?.project
   if(!ws || ws.deletedAt || !raw || raw.deletedAt)throw pipelineError('SCOPE_UNAVAILABLE',404)
   const project=raw.businessId?raw:{...raw,businessId:raw.workspace?.businessId,business:raw.workspace?.business}
   projects.set(project.id,project)
  }
  for(const project of projects.values()) {
   try {await assertProjectReadable(viewer,project,{db:tx})}catch{throw pipelineError('SCOPE_UNAVAILABLE',404)}
   const tenantId=project.business?.tenantId || project.workspace?.tenantId
   if(!tenants.has(tenantId))tenants.set(tenantId,[])
   tenants.get(tenantId).push(project.id)
  }
  const state=await readPipelineState(tx),projectIds=[...projects.keys()]
  const readableProjectIds=await pipelineReadableProjects(tx,state,projectIds,viewer)
  await hydratePipelineGates(tx,state,readableProjectIds)
  const audits=[]
  for(const [tenantId,scopedProjectIds] of tenants)audits.push(...await readPipelineEvidence(tx,state,{commands:[]},scopedProjectIds,tenantId,readableProjectIds,viewer))
  const releaseIndex=buildPipelineReleaseIndex(state,audits,unique)
  // Evidence is immutable for this transaction snapshot. Shared aggregate edges
  // must not repeat the same Person/Business/Workspace lookups for every card.
  const evidenceTx={}
  for(const model of ['person','business','workspace']) {
   const cache=new Map()
   evidenceTx[model]={findUnique:args=>{const key=JSON.stringify(args);if(!cache.has(key))cache.set(key,tx[model].findUnique(args));return cache.get(key)}}
  }
  for(const id of unique)result[id]=await pipelineReleaseState(state,id,{tx:evidenceTx,allowedProjectIds:readableProjectIds,audits,releaseIndex})
  return result
 },{write:false})
}
export async function getWorkItemReleaseState(itemId,options={}) {
 return (await getWorkItemReleaseStates([itemId],options))[itemId]
}

// Called only within the graph writer after its prospective row is persisted;
// any refusal rolls back that row and all audit/version changes in the same tx.
export async function assertWorkItemRelease(before,after,{viewer,db}) {
 if(!requiresWorkRelease(before,after))return
 const scope=await dependencyEndpointScope(db,'WORK_ITEM',after.id)
 if(!scope)throw pipelineError('SCOPE_UNAVAILABLE',404)
 const authority=await resolvePipelineAuthority(db,[scope.project.id],viewer,{postgres:isPostgres(db),write:true})
 viewer=authority.viewer
 const tenantId=scope.project.business?.tenantId || scope.project.workspace?.tenantId
 const snapshot=await readPlanDeltaSnapshot(db,{commands:[]},{viewer,scopes:[{tenant:{id:tenantId}}]},[scope.project.id])
 const release=await pipelineReleaseState(snapshot.before,after.id,{tx:db,allowedProjectIds:snapshot.readableProjectIds,audits:snapshot.audits,protectedStatus:after.status})
 if(release.restricted)throw pipelineError('SCOPE_UNAVAILABLE',404)
 if(release.held)throw pipelineError('RELEASE_HELD',409)
}
