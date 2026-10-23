// @req FR-084 — independent-review regressions over actual persisted Identity/scopes.
// @spec ADR-035, SEC-001, BR-017
import { it, expect, vi } from 'vitest'
import { randomUUID } from 'node:crypto'
import prisma from '@/lib/db'
import { resolveViewer } from '@/modules/identity/resolve-viewer'
import { makeViewer } from '../factories/viewer'
import { dryRunPlan, commitPlan } from '@/modules/project-manager/import/plan-import-service'
import { dryRunPlanDelta, commitPlanDelta } from '@/modules/project-manager/import/plan-delta-service'
import { listDependencies } from '@/modules/project-manager/application/dependency-service'
import { pipelineReleaseState,readPipelineState } from '@/modules/project-manager/application/pipeline-state'
import { pipelineFixture, pipelinePlan, edgeCommand } from '../helpers/pipeline-handoff-fixture'
vi.mock('@/modules/identity/request-viewer',()=>({resolveRequestViewer:async request=>request.__viewer}))
const {GET}=await import('@/app/api/dependencies/route')
async function save(plan,viewer,register=false) { const options={viewer,register};const dry=await dryRunPlanDelta(plan,options);expect(dry.valid,JSON.stringify(dry.errors)).toBe(true);const result=await commitPlanDelta({...plan,expectedPreviewHash:dry.previewHash},options);expect(result.committed,JSON.stringify(result.errors)).toBe(true);return result }
const create = (f,fields={}) => pipelinePlan(f,{op:'node.create',type:'WORK_ITEM',clientRef:'item',parent:{type:'WORKSTREAM',id:f.ws.id},fields:{code:'WI-'+randomUUID().slice(0,8),title:'New',subtype:'TASK',...fields}})
it('an unrelated disconnected Project edit does not invalidate an authorized preview',async()=>{
 const f=await pipelineFixture(prisma),other=await pipelineFixture(prisma),plan=pipelinePlan(f,edgeCommand(f.items[0],f.items[1],'RELATES_TO'))
 const dry=await dryRunPlan(plan,{viewer:f.viewer});expect(dry.valid).toBe(true)
 await prisma.workItem.update({where:{id:other.items[0].id},data:{title:'Unrelated change'}})
 expect((await commitPlan({...plan,expectedPreviewHash:dry.previewHash},{viewer:f.viewer})).committed).toBe(true)
})
it('GET authorizes both endpoint scopes before exposing only the adopted state/hash fields',async()=>{
 const f=await pipelineFixture(prisma),other=await pipelineFixture(prisma)
 const bridge=await prisma.dependency.create({data:{sourceType:'WORK_ITEM',sourceId:f.items[0].id,targetType:'WORK_ITEM',targetId:other.items[0].id,dependencyType:'RELATES_TO'}})
 const request=new Request('http://localhost/api/dependencies?projectId='+f.project.id);request.__viewer=f.viewer
 const response=await GET(request);expect(response.status).toBe(200);expect((await response.json()).some(row=>row.id===bridge.id)).toBe(false)
 const result=await save(pipelinePlan(f,edgeCommand(f.items[1],f.items[2],'RELATES_TO')),f.viewer)
 const row=(await listDependencies({projectId:f.project.id},{viewer:f.viewer})).find(row=>row.id===result.deltaReceipt.changes[0].id)
 expect(row.contractState).toBe('DECLARED');expect(row.expectedDependencyHash).toMatch(/^[a-f0-9]{64}$/)
 expect(Object.keys(row).sort()).toEqual(['id','sourceType','sourceId','targetType','targetId','dependencyType','createdAt','source','target','contractState','expectedDependencyHash'].sort())
})
it('legacy Project Business binding is derived from its Workspace without backfill',async()=>{
 const f=await pipelineFixture(prisma);await prisma.project.update({where:{id:f.project.id},data:{businessId:null}})
 const result=await save(pipelinePlan(f,edgeCommand(f.items[0],f.items[1],'RELATES_TO')),f.viewer)
 expect((await prisma.project.findUnique({where:{id:f.project.id}})).businessId).toBe(null)
 expect((await listDependencies({projectId:f.project.id},{viewer:f.viewer})).find(row=>row.id===result.deltaReceipt.changes[0].id).contractState).toBe('DECLARED')
})
it('a satisfied cross-Business register remains valid for its authorized successor Project delta',async()=>{
 const f=await pipelineFixture(prisma),other=await pipelineFixture(prisma,{tenant:f.tenant,person:f.person})
 const command={...edgeCommand(f.items[0],other.items[0]),target:{type:'WORKSTREAM',id:other.ws.id},contract:{version:1,deliverable:'Accepted input',acceptance:{kind:'MANUAL',satisfied:true}}}
 const {projectId,...base}=pipelinePlan(f,command),register={...base,kind:'DEPENDENCY_REGISTER',projectIds:[f.project.id,other.project.id].sort()}
 await save(register,other.viewer,true)
 const input=create(other,{status:'IN_PROGRESS'}),dry=await dryRunPlan(input,{viewer:other.viewer});expect(dry.valid,JSON.stringify(dry.errors)).toBe(true)
 expect((await commitPlan({...input,expectedPreviewHash:dry.previewHash},{viewer:other.viewer})).committed).toBe(true)
})
it('refuses an assignee scoped only to another Business in the same Tenant',async()=>{
 const f=await pipelineFixture(prisma),other=await pipelineFixture(prisma,{tenant:f.tenant})
 const result=await dryRunPlan(create(f,{assigneeRef:other.person.id}),{viewer:f.viewer})
 expect(result.valid).toBe(false);expect(result.errors[0].code).toBe('SCOPE_UNAVAILABLE')
})
it('refreshes and fences the existing trusted Superadmin grant, including revocation before commit',async()=>{
 const f=await pipelineFixture(prisma);await prisma.membership.update({where:{id:f.membership.id},data:{status:'REVOKED'}})
 const grant=await prisma.platformGrant.create({data:{personId:f.person.id,capability:'SUPERADMIN',status:'ACTIVE',standing:false,expiresAt:new Date(Date.now()+3600000),grantedByPersonId:f.person.id,grantReason:'C1 isolated fixture'}})
 const viewer=makeViewer(await resolveViewer({principalId:f.person.id,superadminGrant:true})),input=create(f),dry=await dryRunPlan(input,{viewer})
 expect(dry.valid,JSON.stringify(dry.errors)).toBe(true)
 expect((await commitPlan({...input,expectedPreviewHash:dry.previewHash},{viewer})).committed).toBe(true)
 const second=create(f),preview=await dryRunPlan(second,{viewer});expect(preview.valid).toBe(true)
 await prisma.platformGrant.update({where:{id:grant.id},data:{status:'REVOKED'}})
 const result=await commitPlan({...second,expectedPreviewHash:preview.previewHash},{viewer});expect(result.committed).toBe(false);expect(result.errors[0].code).toBe('SCOPE_UNAVAILABLE')
})
it('missing or truncated inverse evidence refuses with UNDO_CONFLICT before writing',async()=>{
 const f=await pipelineFixture(prisma),saved=await save(pipelinePlan(f,edgeCommand(f.items[0],f.items[1],'RELATES_TO')),f.viewer)
 const event=await prisma.auditEvent.findUnique({where:{id:saved.auditEventId}}),original=JSON.parse(event.payloadJson)
 const undo=pipelinePlan(f,{op:'undo',originalAuditEventId:event.id,expectedAfterHash:saved.deltaReceipt.afterHash})
 for(const stateImages of [undefined,[]]) {
  await prisma.auditEvent.update({where:{id:event.id},data:{payloadJson:JSON.stringify({...original,stateImages})}})
  const result=await dryRunPlan(undo,{viewer:f.viewer});expect(result.valid).toBe(false);expect(result.errors[0].code).toBe('UNDO_CONFLICT')
 }
 await prisma.auditEvent.update({where:{id:event.id},data:{payloadJson:event.payloadJson}})
 expect(await prisma.planImportReceipt.findUnique({where:{idempotencyKey:undo.trace.idempotencyKey}})).toBe(null)
})
it('dangling declared aggregate successors retain their last accepted item scope',async()=>{
 const f=await pipelineFixture(prisma),other=await prisma.workstream.create({data:{code:randomUUID(),name:'Prior',projectId:f.project.id,executionMode:'SOFTWARE_SPRINT',progressStrategy:'TASK_WEIGHT'}})
 const source=await prisma.workItem.create({data:{code:randomUUID(),title:'Input',subtype:'TASK',workstreamId:other.id}})
 const command={...edgeCommand(source,f.items[0]),target:{type:'WORKSTREAM',id:f.ws.id}}
 const saved=await save(pipelinePlan(f,command),f.viewer),event=await prisma.auditEvent.findUnique({where:{id:saved.auditEventId}})
 expect(JSON.parse(event.payloadJson).releaseScopes[0].successorItemIds).toContain(f.items[0].id)
 await prisma.workstream.update({where:{id:f.ws.id},data:{deletedAt:new Date()}})
 const result=await pipelineReleaseState(await readPipelineState(prisma),f.items[0].id,{tx:prisma,allowedProjectIds:[f.project.id],audits:[event]})
 expect(result).toEqual({held:true,blockers:[],truncated:false,restricted:true})
 // An unrelated later audit merely mentioning the UUID must not mask its locator.
 await prisma.auditEvent.create({data:{entityType:'PROJECT',entityId:f.project.id,action:'PLAN_DELTA_COMMITTED',businessId:f.business.id,tenantId:f.tenant.id,payloadJson:JSON.stringify({commands:[{deliverable:saved.deltaReceipt.changes[0].id}]})}})
 const safe=pipelinePlan(f,{op:'node.create',type:'WORK_ITEM',clientRef:'safe',parent:{type:'WORKSTREAM',id:other.id},fields:{code:'SAFE-'+randomUUID().slice(0,8),title:'Safe',subtype:'TASK'}})
 expect((await dryRunPlan(safe,{viewer:f.viewer})).valid).toBe(true)
})
