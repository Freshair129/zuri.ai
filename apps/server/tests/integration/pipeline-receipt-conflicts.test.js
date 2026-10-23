// @req FR-084 — receipt unique races rollback before fresh authority and winner lookup.
// @spec ADR-035, SEC-003
import {it,expect} from 'vitest'
import prisma from '@/lib/db'
import {commitPlan,dryRunPlan} from '@/modules/project-manager/import/plan-import-service'
import {dryRunBundle} from '@/modules/project-manager/import/bundle/bundle-dry-run'
import {commitBundle} from '@/modules/project-manager/import/bundle/bundle-commit-service'
import {randomUUID} from 'node:crypto'
import {pipelineFixture,pipelinePlan,edgeCommand} from '../helpers/pipeline-handoff-fixture'
function receiptRaceDb(db,onRollback,{unrelated=false}={}) {
 let injected=false
 return new Proxy(db,{get(base,key){
  if(key==='$transaction') return async(fn,settings)=>{
   let thrown
   try {return await base.$transaction(tx=>fn(new Proxy(tx,{get(t,field){
    if(field==='planImportReceipt') return new Proxy(t.planImportReceipt,{get(d,method){
     if(method==='create' && !injected) return async()=>{injected=true;thrown=Object.assign(new Error('isolated unique race'),{code:'P2002',meta:{modelName:unrelated?'Project':'PlanImportReceipt',target:[unrelated?'code':'idempotencyKey']}});throw thrown}
     return typeof d[method]==='function'?d[method].bind(d):d[method]
    }})
    return typeof t[field]==='function'?t[field].bind(t):t[field]
   }})),settings)} catch(error){if(error===thrown) await onRollback();throw error}
  }
  return typeof base[key]==='function'?base[key].bind(base):base[key]
 }})
}
it('a matching winner replays after full rollback, with no duplicate audit or trace',async()=>{
 const f=await pipelineFixture(prisma),plan=pipelinePlan(f,edgeCommand(f.items[0],f.items[1]))
 const dry=await dryRunPlan(plan,{viewer:f.viewer});expect(dry.valid).toBe(true);plan.expectedPreviewHash=dry.previewHash
 let winner
 const db=receiptRaceDb(prisma,async()=>{winner=await commitPlan(plan,{viewer:f.viewer});expect(winner.committed).toBe(true)})
 const result=await commitPlan(plan,{viewer:f.viewer,db});expect(result.committed).toBe(true);expect(result.replay).toBe(true);expect(result.auditEventId).toBe(winner.auditEventId)
 expect(await prisma.auditEvent.count({where:{entityId:f.project.id,action:'PLAN_DELTA_COMMITTED'}})).toBe(1)
 expect(await prisma.projectExecutionRun.count({where:{correlationId:plan.trace.correlationId}})).toBe(1)
})
it('a different winner conflicts and unrelated unique violations never replay',async()=>{
 for(const unrelated of [false,true]) {
  const f=await pipelineFixture(prisma),plan=pipelinePlan(f,edgeCommand(f.items[0],f.items[1])),dry=await dryRunPlan(plan,{viewer:f.viewer});plan.expectedPreviewHash=dry.previewHash
  const db=receiptRaceDb(prisma,async()=>{
   if(unrelated)return
   const other=structuredClone(plan);other.commands[0].contract.deliverable='Winner payload';other.expectedPreviewHash=null
   const preview=await dryRunPlan(other,{viewer:f.viewer});expect(preview.valid).toBe(true)
   expect((await commitPlan({...other,expectedPreviewHash:preview.previewHash},{viewer:f.viewer})).committed).toBe(true)
  },{unrelated})
  const result=await commitPlan(plan,{viewer:f.viewer,db})
  expect(result.errors[0].code).toBe(unrelated?'GRAPH_BUSY':'IDEMPOTENCY_CONFLICT')
  expect(await prisma.auditEvent.count({where:{entityId:f.project.id,action:'PLAN_DELTA_COMMITTED'}})).toBe(unrelated?0:1)
 }
})

it('retained Plan and both Bundle transports replay only a winner after a receipt race',async()=>{
 for(const transport of ['PLAN12','BUNDLE10','BUNDLE11']) {
  const f=await pipelineFixture(prisma),suffix=randomUUID().slice(0,8),trace={correlationId:randomUUID(),idempotencyKey:randomUUID()}
  const full={schemaVersion:transport==='PLAN12'?'1.2':'1.0',scope:{workspaceCode:f.workspace.code},project:{code:'RC-'+suffix,name:'Receipt race'},workstreams:[],...(transport==='PLAN12'?{trace,domainBinding:{primaryDomainId:'DOM-DEVELOPMENT',supportingDomainIds:[],technicalOwnerDomainId:'TD-PROJECT-MANAGER'},identityRefs:{}}:{})}
  let input=transport==='PLAN12'?full:{schemaVersion:transport==='BUNDLE11'?'1.1':'1.0',kind:'EXECUTION_PLAN_BUNDLE',scope:{businessCode:f.business.code,defaultWorkspaceCode:f.workspace.code},manifest:{code:'BC-'+suffix,title:'Receipt race'},projects:[{bundleProjectRef:'A',plan:full}],dependencies:[],trace,...(transport==='BUNDLE11'?{expectedPreviewHash:null}:{})}
  const commit=transport==='PLAN12'?commitPlan:commitBundle
  if(transport==='BUNDLE11'){const dry=await dryRunBundle(input,{viewer:f.viewer});expect(dry.valid,JSON.stringify(dry.errors)).toBe(true);input={...input,expectedPreviewHash:dry.previewHash}}
  let winner
  const db=receiptRaceDb(prisma,async()=>{winner=await commit(input,{viewer:f.viewer});expect(winner.committed,JSON.stringify(winner.errors)).toBe(true)})
  const result=await commit(input,{viewer:f.viewer,db});expect(result.committed,JSON.stringify(result.errors)).toBe(true);expect(result.replay).toBe(true)
  expect(await prisma.project.count({where:{code:full.project.code}})).toBe(1)
  expect(await prisma.projectExecutionRun.count({where:{correlationId:trace.correlationId,status:'FAILED'}})).toBe(0)
 }
})
it('reauthorizes the caller before reading a matching winner in the fresh transaction',async()=>{
 const f=await pipelineFixture(prisma),plan=pipelinePlan(f,edgeCommand(f.items[0],f.items[1])),dry=await dryRunPlan(plan,{viewer:f.viewer});plan.expectedPreviewHash=dry.previewHash
 const db=receiptRaceDb(prisma,async()=>{expect((await commitPlan(plan,{viewer:f.viewer})).committed).toBe(true);await prisma.membership.update({where:{id:f.membership.id},data:{status:'REVOKED'}})})
 expect((await commitPlan(plan,{viewer:f.viewer,db})).errors[0].code).toBe('SCOPE_UNAVAILABLE')
})

it('pre-C1 legacy receipts replay with current scope and their historical actor evidence',async()=>{
 for(const transport of ['PLAN12','BUNDLE10']) {
  const f=await pipelineFixture(prisma),trace={correlationId:randomUUID(),idempotencyKey:randomUUID()},suffix=randomUUID().slice(0,8)
  const full={schemaVersion:transport==='PLAN12'?'1.2':'1.0',scope:{workspaceCode:f.workspace.code},project:{code:'OLD-'+suffix,name:'Historical receipt'},workstreams:[],...(transport==='PLAN12'?{trace,domainBinding:{primaryDomainId:'DOM-DEVELOPMENT',supportingDomainIds:[],technicalOwnerDomainId:'TD-PROJECT-MANAGER'},identityRefs:{}}:{})}
  const input=transport==='PLAN12'?full:{schemaVersion:'1.0',kind:'EXECUTION_PLAN_BUNDLE',scope:{businessCode:f.business.code,defaultWorkspaceCode:f.workspace.code},manifest:{code:'OLD-B-'+suffix,title:'Historical receipt'},projects:[{bundleProjectRef:'A',plan:full}],dependencies:[],trace},commit=transport==='PLAN12'?commitPlan:commitBundle
  const saved=await commit(input,{viewer:f.viewer});expect(saved.committed).toBe(true)
  const receipt=await prisma.planImportReceipt.findUnique({where:{idempotencyKey:trace.idempotencyKey}})
  const event=transport==='PLAN12'?await prisma.auditEvent.findFirst({where:{entityId:receipt.projectId,action:'PLAN_IMPORTED'}}):await prisma.auditEvent.findUnique({where:{id:receipt.auditEventId}})
  const payload=JSON.parse(event.payloadJson);delete payload.receiptActor
  await prisma.auditEvent.update({where:{id:event.id},data:{payloadJson:JSON.stringify(payload),...(transport==='BUNDLE10'?{actorId:null,businessId:null,tenantId:null}:{})}})
  const replay=await commit(input,{viewer:f.viewer});expect(replay.committed,JSON.stringify(replay.errors)).toBe(true);expect(replay.replay).toBe(true)
  if(transport==='PLAN12') {
   await prisma.auditEvent.update({where:{id:event.id},data:{actorId:randomUUID()}})
   await expect(commit(input,{viewer:f.viewer})).rejects.toMatchObject({code:'IDEMPOTENCY_CONFLICT'})
  }
  await prisma.membership.update({where:{id:f.membership.id},data:{status:'REVOKED'}})
  await expect(commit(input,{viewer:f.viewer})).rejects.toMatchObject({code:'SCOPE_UNAVAILABLE'})
 }
})
