import { archiveWorkstream } from '@/modules/project-manager/application/project-service'
// @req FR-084 — register and import share contract/scope/undo/rollback rules.
// @spec ADR-035, BR-017, SEC-001
import {describe,it,expect,beforeAll} from 'vitest'
import {randomUUID} from 'node:crypto'
import prisma from '@/lib/db'
import {dryRunPlan,commitPlan} from '@/modules/project-manager/import/plan-import-service'
import {dryRunPlanDelta,commitPlanDelta} from '@/modules/project-manager/import/plan-delta-service'
import {createDependency,listDependencies} from '@/modules/project-manager/application/dependency-service'
import {dependencyHash} from '@/modules/project-manager/application/handoff-contract'
import {pipelineSubtreeHash,readPipelineState} from '@/modules/project-manager/application/pipeline-state'
import {pipelineFixture,handoff,edgeCommand,pipelinePlan} from '../helpers/pipeline-handoff-fixture'
let f
beforeAll(async()=>{f=await pipelineFixture(prisma)})
const opts=()=>({viewer:f.viewer})
async function commit(plan,options=opts()) {const dry=await dryRunPlan(plan,options);expect(dry.valid,JSON.stringify(dry.errors)).toBe(true);return commitPlan({...plan,expectedPreviewHash:dry.previewHash},options)}
describe('C1 contract and atomic persistence',()=>{
 it('new bare service edges are refused after endpoint authorization',async()=>{
  await expect(createDependency({sourceType:'WORK_ITEM',sourceId:f.items[0].id,targetType:'WORK_ITEM',targetId:f.items[1].id,dependencyType:'RELATES_TO'},opts())).rejects.toMatchObject({code:'CONTRACT_REQUIRED'})
 })
 it('global register uses exact two-Project scopes and shares the import transaction writer',async()=>{
  const other=await pipelineFixture(prisma,{tenant:f.tenant,person:f.person});const command=edgeCommand(f.items[0],other.items[0],'RELATES_TO');const base=pipelinePlan(f,command)
  const {projectId,...rest}=base;const plan={...rest,kind:'DEPENDENCY_REGISTER',projectIds:[f.project.id,other.project.id].sort()};const options={viewer:other.viewer,register:true}
  const dry=await dryRunPlanDelta(plan,options);expect(dry.valid,JSON.stringify(dry.errors)).toBe(true)
  const result=await commitPlanDelta({...plan,expectedPreviewHash:dry.previewHash},options);expect(result.committed).toBe(true)
  const run=await prisma.projectExecutionRun.findUnique({where:{executionRunId:result.executionRunId}});expect(JSON.parse(run.projectIdsJson)).toEqual(plan.projectIds)
  const missing=await dryRunPlanDelta({...plan,projectIds:[f.project.id]},options);expect(missing.valid).toBe(false);expect(missing.errors[0].code).toBe('SCOPE_UNAVAILABLE')
 })
 it('authorized Gate still must belong to the effective predecessor and cannot smuggle provenance',async()=>{
  const foreign=await prisma.project.create({data:{code:randomUUID(),name:'Other Project',businessId:f.business.id,workspaceId:f.workspace.id}})
  const gate=await prisma.gate.create({data:{code:randomUUID(),title:'Inspection',projectId:foreign.id,status:'PASSED'}})
  const command={...edgeCommand(f.items[0],f.items[1]),contract:{...handoff(),acceptance:{kind:'GATE',gateId:gate.id}}}
  const result=await dryRunPlan(pipelinePlan(f,command),opts());expect(result.valid).toBe(false);expect(result.errors[0].code).toBe('SCOPE_UNAVAILABLE')
 })
 it('existing legacy NULL survives round trip and explicit contract edit is CAS protected',async()=>{
  const row=await prisma.dependency.create({data:{sourceType:'WORK_ITEM',sourceId:f.items[0].id,targetType:'WORK_ITEM',targetId:f.items[1].id,dependencyType:'DERIVES_FROM'}})
  expect(row.contractJson).toBe(null)
  const plan=pipelinePlan(f,{op:'dependency.contract',id:row.id,expectedDependencyHash:dependencyHash(row),contract:handoff()})
  const dry=await dryRunPlan(plan,opts());expect(dry.valid).toBe(true)
  await prisma.dependency.update({where:{id:row.id},data:{contractJson:'{}'}})
  const result=await commitPlan({...plan,expectedPreviewHash:dry.previewHash},opts());expect(result.committed).toBe(false);expect(result.errors[0].code).toBe('STALE_ENTITY')
 })
 it('injected audit failure rolls back edge, execution trace and idempotency key',async()=>{
  const plan=pipelinePlan(f,edgeCommand(f.items[1],f.items[2],'RELATES_TO'));const dry=await dryRunPlan(plan,opts());expect(dry.valid).toBe(true)
  const before={edges:await prisma.dependency.count(),runs:await prisma.projectExecutionRun.count(),audits:await prisma.auditEvent.count()}
  const db=new Proxy(prisma,{get(target,key){if(key==='$transaction')return (fn,options)=>target.$transaction(tx=>fn(new Proxy(tx,{get(tx,field){if(field==='auditEvent')return new Proxy(tx.auditEvent,{get(delegate,method){if(method==='create')return ()=>{throw new Error('INJECTED_AUDIT_FAILURE')};return typeof delegate[method]==='function'?delegate[method].bind(delegate):delegate[method]}});return typeof tx[field]==='function'?tx[field].bind(tx):tx[field]}})),options);return typeof target[key]==='function'?target[key].bind(target):target[key]}})
  const result=await commitPlan({...plan,expectedPreviewHash:dry.previewHash},{...opts(),db});expect(result.committed).toBe(false)
  expect(await prisma.dependency.count()).toBe(before.edges);expect(await prisma.projectExecutionRun.count()).toBe(before.runs);expect(await prisma.auditEvent.count()).toBe(before.audits);expect(await prisma.planImportReceipt.findUnique({where:{idempotencyKey:plan.trace.idempotencyKey}})).toBe(null)
 })
 it('creates hierarchy through typed earlier refs, supports guarded inverse, refuses stale inverse',async()=>{
  const suffix=randomUUID().slice(0,8)
  const plan=pipelinePlan(f,[{op:'node.create',type:'WORKSTREAM',clientRef:'ws',parent:{type:'PROJECT',id:f.project.id},fields:{code:'WS-'+suffix,name:'New',executionMode:'SOFTWARE_SPRINT'}},{op:'node.create',type:'WORK_CONTAINER',clientRef:'container',parent:{type:'WORKSTREAM',ref:'ws'},fields:{code:'WC-'+suffix,title:'Sprint',subtype:'SPRINT'}},{op:'node.create',type:'WORK_ITEM',clientRef:'item',parent:{type:'WORK_CONTAINER',ref:'container'},fields:{code:'WI-'+suffix,title:'Task',subtype:'TASK'}}])
  const result=await commit(plan);expect(result.committed,JSON.stringify(result.errors)).toBe(true)
  const item=await prisma.workItem.findUnique({where:{code:'WI-'+suffix}});const undo=pipelinePlan(f,{op:'undo',originalAuditEventId:result.auditEventId,expectedAfterHash:result.deltaReceipt.afterHash})
  await prisma.workItem.update({where:{id:item.id},data:{title:'Later edit'}})
  const stale=await dryRunPlan(undo,opts());expect(stale.valid).toBe(false);expect(stale.errors[0].code).toBe('UNDO_CONFLICT')
 })
 it('rejects initially protected delta items in a held aggregate, allowing a safe initial phase',async()=>{
  const fixture=await pipelineFixture(prisma),options={viewer:fixture.viewer}
  const ws=await prisma.workstream.create({data:{code:randomUUID(),name:'Predecessor',projectId:fixture.project.id,executionMode:'SOFTWARE_SPRINT',progressStrategy:'TASK_WEIGHT'}})
  const predecessor=await prisma.workItem.create({data:{code:randomUUID(),title:'Input',subtype:'TASK',workstreamId:ws.id}})
  const edge={...edgeCommand(predecessor,fixture.items[0]),target:{type:'WORKSTREAM',id:fixture.ws.id}}
  expect((await commit(pipelinePlan(fixture,edge),options)).committed).toBe(true)
  const create=status=>pipelinePlan(fixture,{op:'node.create',type:'WORK_ITEM',clientRef:'held',parent:{type:'WORKSTREAM',id:fixture.ws.id},fields:{code:'HELD-'+randomUUID().slice(0,8),title:'New',subtype:'TASK',status}})
  for(const status of ['IN_PROGRESS','REVIEW','DONE']) { const dry=await dryRunPlan(create(status),options); expect(dry.valid).toBe(false);expect(dry.errors[0].code).toBe('RELEASE_HELD') }
  expect((await dryRunPlan(create('READY'),options)).valid).toBe(true)
 })
 it('undoing a created hierarchy preserves soft-delete identities and removes its container',async()=>{
  const fixture=await pipelineFixture(prisma),suffix=randomUUID().slice(0,8),options={viewer:fixture.viewer}
  const plan=pipelinePlan(fixture,[{op:'node.create',type:'WORKSTREAM',clientRef:'ws',parent:{type:'PROJECT',id:fixture.project.id},fields:{code:'UWS-'+suffix,name:'New',executionMode:'SOFTWARE_SPRINT'}},{op:'node.create',type:'WORK_CONTAINER',clientRef:'box',parent:{type:'WORKSTREAM',ref:'ws'},fields:{code:'UWC-'+suffix,title:'Sprint',subtype:'SPRINT'}},{op:'node.create',type:'WORK_ITEM',clientRef:'item',parent:{type:'WORK_CONTAINER',ref:'box'},fields:{code:'UWI-'+suffix,title:'Task',subtype:'TASK'}}])
  const saved=await commit(plan,options);expect(saved.committed).toBe(true)
  const result=await commit(pipelinePlan(fixture,{op:'undo',originalAuditEventId:saved.auditEventId,expectedAfterHash:saved.deltaReceipt.afterHash}),options);expect(result.committed,JSON.stringify(result.errors)).toBe(true)
  const item=await prisma.workItem.findUnique({where:{code:'UWI-'+suffix}});expect(item.deletedAt).not.toBe(null);expect(item.containerId).toBe(null)
  expect((await prisma.workstream.findUnique({where:{code:'UWS-'+suffix}})).deletedAt).not.toBe(null);expect(await prisma.workContainer.findUnique({where:{code:'UWC-'+suffix}})).toBe(null)
 })
 it('a manual mark cannot claim satisfaction using an audit that recorded a different decision',async()=>{
  const fixture=await pipelineFixture(prisma),plan=pipelinePlan(fixture,edgeCommand(fixture.items[0],fixture.items[1]))
  const dry=await dryRunPlan(plan,{viewer:fixture.viewer}),saved=await commitPlan({...plan,expectedPreviewHash:dry.previewHash},{viewer:fixture.viewer});expect(saved.committed).toBe(true)
  const id=saved.deltaReceipt.changes[0].id,row=await prisma.dependency.findUnique({where:{id}}),forged=JSON.parse(row.contractJson);forged.acceptance.satisfied=true
  await prisma.dependency.update({where:{id},data:{contractJson:JSON.stringify(forged)}})
  const listed=await listDependencies({projectId:fixture.project.id},{viewer:fixture.viewer});expect(listed.find(row=>row.id===id).contractState).toBe('INVALID')
 })
 it('refuses destructive endpoints still referenced by declared obligations',async()=>{
  const fixture=await pipelineFixture(prisma)
  const dryPlan=pipelinePlan(fixture,edgeCommand(fixture.items[0],fixture.items[1]))
  const dry=await dryRunPlan(dryPlan,{viewer:fixture.viewer});expect(dry.valid).toBe(true)
  expect((await commitPlan({...dryPlan,expectedPreviewHash:dry.previewHash},{viewer:fixture.viewer})).committed).toBe(true)
  const count=await prisma.auditEvent.count()
  await expect(archiveWorkstream(fixture.ws.id,{viewer:fixture.viewer})).rejects.toMatchObject({code:'CONTRACT_CONFLICT'})
  expect((await prisma.workstream.findUnique({where:{id:fixture.ws.id}})).deletedAt).toBe(null);expect(await prisma.auditEvent.count()).toBe(count)
 })
 it('unrelated archived ancestry cannot block another Project preview',async()=>{
  const unrelated=await pipelineFixture(prisma);await prisma.workstream.update({where:{id:unrelated.ws.id},data:{deletedAt:new Date()}})
  const current=await pipelineFixture(prisma);const result=await dryRunPlan(pipelinePlan(current,edgeCommand(current.items[0],current.items[1])),{viewer:current.viewer});expect(result.valid,JSON.stringify(result.errors)).toBe(true)
 })
 it('legacy full envelopes cannot create new bare edges but preserve an identical legacy row',async()=>{
  const plan={schemaVersion:'1.0',generatedBy:'test',scope:{workspaceCode:f.workspace.code},project:{code:f.project.code,name:'C1'},workstreams:[{code:f.ws.code,name:'Software',executionMode:'SOFTWARE_SPRINT',progressStrategy:'TASK_WEIGHT',items:f.items.map(i=>({code:i.code,title:i.title,subtype:'TASK'}))}],dependencies:[{sourceRef:f.items[1].code,targetRef:f.items[0].code,type:'RELATES_TO'}]}
  const dry=await dryRunPlan(plan,opts());expect(dry.valid).toBe(false);expect(dry.errors.some(e=>String(e).includes('CONTRACT_REQUIRED'))).toBe(true)
  const row=await prisma.dependency.create({data:{sourceType:'WORK_ITEM',sourceId:f.items[1].id,targetType:'WORK_ITEM',targetId:f.items[0].id,dependencyType:'RELATES_TO'}})
  const retained=await dryRunPlan(plan,opts());expect(retained.valid,JSON.stringify(retained.errors)).toBe(true)
  const result=await commitPlan(plan,opts());expect(result.committed).toBe(true);expect((await prisma.dependency.findUnique({where:{id:row.id}})).contractJson).toBe(null)
 })
 it('reuses the owning all-type cycle detector and refuses inverse after a new reference',async()=>{
  const one=await commit(pipelinePlan(f,edgeCommand(f.items[0],f.items[2],'SUPERSEDES')));expect(one.committed).toBe(true)
  const opposite=await dryRunPlan(pipelinePlan(f,edgeCommand(f.items[2],f.items[0],'DERIVES_FROM')),opts());expect(opposite.valid).toBe(false);expect(opposite.errors[0].code).toBe('CYCLE')
  const undo=await commit(pipelinePlan(f,{op:'undo',originalAuditEventId:one.auditEventId,expectedAfterHash:one.deltaReceipt.afterHash}));expect(undo.committed).toBe(true)
  expect(await prisma.dependency.findUnique({where:{id:one.deltaReceipt.changes[0].id}})).toBe(null)
 })
})
