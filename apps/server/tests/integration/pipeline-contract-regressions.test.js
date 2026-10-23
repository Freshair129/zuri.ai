// @req FR-084 — independent-review regressions over actual persisted Identity/scopes.
// @spec ADR-035, SEC-001, BR-017
import { it, expect, vi } from 'vitest'
import { randomUUID } from 'node:crypto'
import prisma from '@/lib/db'
import { resolveViewer } from '@/modules/identity/resolve-viewer'
import { makeViewer } from '../factories/viewer'
import { dryRunPlan, commitPlan } from '@/modules/project-manager/import/plan-import-service'
import { dryRunPlanDelta, commitPlanDelta, readPipelineEvidence } from '@/modules/project-manager/import/plan-delta-service'
import { listDependencies } from '@/modules/project-manager/application/dependency-service'
import { pipelineReleaseState,readPipelineState } from '@/modules/project-manager/application/pipeline-state'
import { pipelineFixture, pipelinePlan, edgeCommand } from '../helpers/pipeline-handoff-fixture'
vi.mock('@/modules/identity/request-viewer',()=>({resolveRequestViewer:async request=>request.__viewer}))
const {GET}=await import('@/app/api/dependencies/route')
const {GET:resolveGET}=await import('@/app/api/resolve/route')
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

it('GET refuses a persisted foreign Gate independently of its status',async()=>{
 const f=await pipelineFixture(prisma),foreign=await pipelineFixture(prisma)
 const gate=await prisma.gate.create({data:{code:randomUUID(),title:'Foreign acceptance',projectId:foreign.project.id,status:'PASSED'}})
 const edge=await prisma.dependency.create({data:{sourceType:'WORK_ITEM',sourceId:f.items[0].id,targetType:'WORK_ITEM',targetId:f.items[1].id,dependencyType:'BLOCKS',contractJson:JSON.stringify({version:1,deliverable:'Invalid foreign evidence',acceptance:{kind:'GATE',gateId:gate.id}})}})
 for(const status of ['PASSED','OPEN']) {
  await prisma.gate.update({where:{id:gate.id},data:{status}})
  expect((await listDependencies({projectId:f.project.id},{viewer:f.viewer})).find(row=>row.id===edge.id).contractState).toBe('INVALID')
 }
})

it('opt-in resolver Project scope is authorized and default DTO stays unchanged',async()=>{
 const f=await pipelineFixture(prisma),other=await pipelineFixture(prisma)
 for(const include of ['', '&includeProjectScope=true']) {
  const req=new Request('http://localhost/api/resolve?type=WORK_ITEM&code='+f.items[0].code+include);req.__viewer=f.viewer
  const res=await resolveGET(req),body=await res.json();expect(res.status).toBe(200)
  if(include) expect(body.projectId).toBe(f.project.id);else expect(body).not.toHaveProperty('projectId')
 }
 const req=new Request('http://localhost/api/resolve?type=WORK_ITEM&code='+other.items[0].code+'&includeProjectScope=true');req.__viewer=f.viewer
 expect((await resolveGET(req)).status).toBe(404)
})

it('retains a cross-Business successor locator when its container is lost after acceptance',async()=>{
 const f=await pipelineFixture(prisma),other=await pipelineFixture(prisma,{tenant:f.tenant,person:f.person})
 const [a,b]=[f,other].sort((a,b)=>a.project.id.localeCompare(b.project.id))
 const box=await prisma.workContainer.create({data:{code:randomUUID(),title:'Prior aggregate',subtype:'SPRINT',workstreamId:b.ws.id}})
 await prisma.workItem.update({where:{id:b.items[0].id},data:{containerId:box.id}})
 const command={...edgeCommand(a.items[0],b.items[0]),target:{type:'WORK_CONTAINER',id:box.id}}
 const {projectId,...base}=pipelinePlan(a,command),register={...base,kind:'DEPENDENCY_REGISTER',projectIds:[a.project.id,b.project.id]}
 const saved=await save(register,other.viewer,true)
 expect((await prisma.auditEvent.findUnique({where:{id:saved.auditEventId}})).businessId).toBe(a.business.id)
 await prisma.workItem.update({where:{id:b.items[0].id},data:{containerId:null}})
 await prisma.workContainer.delete({where:{id:box.id}})
 const state=await readPipelineState(prisma),proposal=create(b)
 const audits=await readPipelineEvidence(prisma,state,proposal,[b.project.id],b.tenant.id)
 expect(audits.some(event=>event.id===saved.auditEventId)).toBe(true)
 expect(await pipelineReleaseState(state,b.items[0].id,{tx:prisma,allowedProjectIds:[b.project.id],audits})).toEqual({held:true,blockers:[],truncated:false,restricted:true})
})

it('legacy full-plan commit refreshes a revoked owner before any business writes',async()=>{
 const f=await pipelineFixture(prisma),plan={schemaVersion:'1.0',scope:{workspaceCode:f.workspace.code},project:{code:f.project.code,name:'Must not change'},workstreams:[]}
 await prisma.membership.update({where:{id:f.membership.id},data:{status:'REVOKED'}})
 await expect(commitPlan(plan,{viewer:f.viewer})).rejects.toMatchObject({code:'SCOPE_UNAVAILABLE'})
 expect((await prisma.project.findUnique({where:{id:f.project.id}})).name).toBe(f.project.name)
})
it('legacy full-plan cannot activate work behind an unsatisfied declared handoff',async()=>{
 const f=await pipelineFixture(prisma);await save(pipelinePlan(f,edgeCommand(f.items[0],f.items[1])),f.viewer)
 const plan={schemaVersion:'1.0',scope:{workspaceCode:f.workspace.code},project:{code:f.project.code,name:f.project.name},workstreams:[{code:f.ws.code,name:f.ws.name,executionMode:'SOFTWARE_SPRINT',progressStrategy:'TASK_WEIGHT',items:[{code:f.items[1].code,title:f.items[1].title,subtype:'TASK',status:'DONE'}]}]}
 await expect(commitPlan(plan,{viewer:f.viewer})).rejects.toMatchObject({code:'RELEASE_HELD'})
 expect((await prisma.workItem.findUnique({where:{id:f.items[1].id}})).status).toBe('PLANNED')
})

it('manual acceptance with a mismatched audit Tenant is INVALID in both GET and release policy',async()=>{
 const f=await pipelineFixture(prisma),other=await pipelineFixture(prisma)
 const command=edgeCommand(f.items[0],f.items[1]);command.contract.acceptance.satisfied=true
 const saved=await save(pipelinePlan(f,command),f.viewer),edgeId=saved.deltaReceipt.changes[0].id
 await prisma.auditEvent.update({where:{id:saved.auditEventId},data:{tenantId:other.tenant.id}})
 const audit=await prisma.auditEvent.findUnique({where:{id:saved.auditEventId}}),state=await readPipelineState(prisma)
 expect((await listDependencies({projectId:f.project.id},{viewer:f.viewer})).find(edge=>edge.id===edgeId).contractState).toBe('INVALID')
 expect((await pipelineReleaseState(state,f.items[1].id,{tx:prisma,allowedProjectIds:[f.project.id],audits:[audit]})).held).toBe(true)
})

it('Project-local undo cannot remove a two-Project register edge after secondary access is revoked',async()=>{
 const f=await pipelineFixture(prisma),other=await pipelineFixture(prisma,{tenant:f.tenant,person:f.person}),[a,b]=[f,other].sort((a,b)=>a.project.id.localeCompare(b.project.id))
 const {projectId,...base}=pipelinePlan(a,edgeCommand(a.items[0],b.items[0])),saved=await save({...base,kind:'DEPENDENCY_REGISTER',projectIds:[a.project.id,b.project.id]},other.viewer,true)
 await prisma.membership.update({where:{id:b.membership.id},data:{status:'REVOKED'}})
 const undo=pipelinePlan(a,{op:'undo',originalAuditEventId:saved.auditEventId,expectedAfterHash:saved.deltaReceipt.afterHash}),dry=await dryRunPlan(undo,{viewer:other.viewer})
 expect(dry.valid).toBe(false);expect(dry.errors[0].code).toBe('SCOPE_UNAVAILABLE')
 expect(await prisma.dependency.findUnique({where:{id:saved.deltaReceipt.changes[0].id}})).not.toBe(null)
})
it('successor membership changes refresh the cross-Project locator through delta, full import and CRUD',async()=>{
 const f=await pipelineFixture(prisma),other=await pipelineFixture(prisma,{tenant:f.tenant,person:f.person}),box=await prisma.workContainer.create({data:{code:randomUUID(),title:'Target aggregate',subtype:'SPRINT',workstreamId:other.ws.id}})
 await prisma.workItem.update({where:{id:other.items[0].id},data:{containerId:box.id}})
 const command={...edgeCommand(f.items[0],other.items[0]),target:{type:'WORK_CONTAINER',id:box.id}}, {projectId,...base}=pipelinePlan(f,command)
 const edge=await save({...base,kind:'DEPENDENCY_REGISTER',projectIds:[f.project.id,other.project.id].sort()},other.viewer,true),edgeId=edge.deltaReceipt.changes[0].id
 const added=await save(pipelinePlan(other,{op:'node.create',type:'WORK_ITEM',clientRef:'new',parent:{type:'WORK_CONTAINER',id:box.id},fields:{code:'D-'+randomUUID().slice(0,8),title:'Delta child',subtype:'TASK'}}),other.viewer)
 const deltaItem=added.deltaReceipt.changes.find(change=>change.type==='WORK_ITEM').id
 expect(JSON.parse((await prisma.auditEvent.findUnique({where:{id:added.auditEventId}})).payloadJson).releaseScopes.find(scope=>scope.dependencyId===edgeId).successorItemIds).toContain(deltaItem)
 const code='F-'+randomUUID().slice(0,8),full={schemaVersion:'1.0',scope:{workspaceCode:other.workspace.code},project:{code:other.project.code,name:other.project.name},workstreams:[{code:other.ws.code,name:other.ws.name,executionMode:'SOFTWARE_SPRINT',progressStrategy:'TASK_WEIGHT',containers:[{code:box.code,title:box.title,subtype:'SPRINT'}],items:[{code,title:'Full child',subtype:'TASK',containerCode:box.code}]}]}
 const imported=await commitPlan(full,{viewer:other.viewer});expect(imported.committed).toBe(true)
 const fullItem=await prisma.workItem.findUnique({where:{code}})
 expect(JSON.parse((await prisma.auditEvent.findUnique({where:{id:imported.auditEventId}})).payloadJson).releaseScopes.find(scope=>scope.dependencyId===edgeId).successorItemIds).toContain(fullItem.id)
 const {createItem}=await import('@/modules/project-manager/application/work-service'),crud=await createItem({workstreamId:other.ws.id,containerId:box.id,title:'CRUD child',subtype:'TASK'},{viewer:other.viewer})
 await prisma.workItem.updateMany({where:{containerId:box.id},data:{containerId:null}});await prisma.workContainer.delete({where:{id:box.id}})
 const state=await readPipelineState(prisma),audits=await readPipelineEvidence(prisma,state,{commands:[]},[other.project.id],other.tenant.id,[f.project.id,other.project.id])
 for(const id of [deltaItem,fullItem.id,crud.id]) expect((await pipelineReleaseState(state,id,{tx:prisma,allowedProjectIds:[other.project.id],audits})).held).toBe(true)
})

it('undo refuses restoration when another dependency owns its endpoint tuple',async()=>{
 const f=await pipelineFixture(prisma),command=edgeCommand(f.items[0],f.items[1]),created=await save(pipelinePlan(f,command),f.viewer),id=created.deltaReceipt.changes[0].id
 const row=(await listDependencies({projectId:f.project.id},{viewer:f.viewer})).find(row=>row.id===id)
 const removed=await save(pipelinePlan(f,{op:'dependency.remove',id,expectedDependencyHash:row.expectedDependencyHash}),f.viewer)
 await save(pipelinePlan(f,{...command,clientRef:'replacement'}),f.viewer)
 const undo=pipelinePlan(f,{op:'undo',originalAuditEventId:removed.auditEventId,expectedAfterHash:removed.deltaReceipt.afterHash}),dry=await dryRunPlan(undo,{viewer:f.viewer})
 expect(dry.valid).toBe(false);expect(dry.errors[0].code).toBe('UNDO_CONFLICT')
 expect(await prisma.dependency.findUnique({where:{id}})).toBe(null)
})
it('undo restores manual acceptance with its original decision in the preview read set',async()=>{
 const f=await pipelineFixture(prisma),command=edgeCommand(f.items[0],f.items[1]);command.contract.acceptance.satisfied=true
 const created=await save(pipelinePlan(f,command),f.viewer),id=created.deltaReceipt.changes[0].id,row=(await listDependencies({projectId:f.project.id},{viewer:f.viewer})).find(row=>row.id===id)
 const removed=await save(pipelinePlan(f,{op:'dependency.remove',id,expectedDependencyHash:row.expectedDependencyHash}),f.viewer)
 const undo=pipelinePlan(f,{op:'undo',originalAuditEventId:removed.auditEventId,expectedAfterHash:removed.deltaReceipt.afterHash}),dry=await dryRunPlan(undo,{viewer:f.viewer})
 expect(dry.valid,JSON.stringify(dry.errors)).toBe(true)
 const evidence=await readPipelineEvidence(prisma,await readPipelineState(prisma),undo,[f.project.id],f.tenant.id);expect(evidence.some(row=>row.id===created.auditEventId)).toBe(true)
 expect(dry.preview.releaseEffects.every(effect=>!effect.after.held)).toBe(true)
 const original=await prisma.auditEvent.findUnique({where:{id:created.auditEventId}})
 await prisma.auditEvent.update({where:{id:original.id},data:{payloadJson:JSON.stringify({...JSON.parse(original.payloadJson),tampered:true})}})
 const stale=await commitPlan({...undo,expectedPreviewHash:dry.previewHash},{viewer:f.viewer})
 expect(stale.committed).toBe(false);expect(stale.errors[0].code).toBe('STALE_PREVIEW')
})
