// @req FR-082 — create/reparent through the existing atomic intake lane.
// @spec ADR-035, SDD-046, SEC-001
import { it, expect } from 'vitest'
import { existsSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import db from '@/lib/db'
import { pipelineFixture, pipelinePlan } from '../helpers/pipeline-handoff-fixture'
import { dryRunPlan, commitPlan } from '@/modules/project-manager/import/plan-import-service'
import { readPipelineState, pipelineSubtreeHash } from '@/modules/project-manager/application/pipeline-state'
const options=f=>({viewer:f.viewer,db})
const container=(ws,parentId=null)=>db.workContainer.create({data:{code:randomUUID(),title:'Container',subtype:'EPIC',workstreamId:ws.id,parentId}})
const move=async(type,id,parent)=>{const state=await readPipelineState(db);return {op:'node.move',type,id,parent,expectedEntityHash:pipelineSubtreeHash(state,{type,id}),expectedParentHash:pipelineSubtreeHash(state,parent)}}
async function apply(f,command){const plan=pipelinePlan(f,command),dry=await dryRunPlan(plan,options(f));expect(dry.valid,JSON.stringify(dry)).toBe(true);const result=await commitPlan({...plan,expectedPreviewHash:dry.previewHash},options(f));expect(result.committed,JSON.stringify(result)).toBe(true);return result}
it('projects safe subtree hashes and only compiler-approved targets, with no preview writes',async()=>{
 expect(existsSync('src/modules/project-manager/application/structure-canvas.js')).toBe(true)
 const {readStructureCanvas}=await import('@/modules/project-manager/application/structure-canvas')
 const f=await pipelineFixture(db),root=await container(f.ws),child=await container(f.ws,root.id),sibling=await container(f.ws)
 const before=[await db.auditEvent.count(),await db.planImportReceipt.count()]
 const result=await readStructureCanvas(f.project.id,{...options(f),move:{type:'WORK_CONTAINER',id:root.id}})
 expect(result.nodes.find(n=>n.id===root.id).hash).toMatch(/^[0-9a-f]{64}$/)
 expect(result.targets.some(n=>n.id===root.id||n.id===child.id)).toBe(false)
 expect(result.targets.some(n=>n.id===f.ws.id)).toBe(false) // current parent is not a move
 expect(result.targets.some(n=>n.id===sibling.id)).toBe(true)
 for(const target of result.targets){const dry=await dryRunPlan(pipelinePlan(f,await move('WORK_CONTAINER',root.id,target)),options(f));expect(dry.valid).toBe(true)}
 expect(JSON.stringify(result)).not.toMatch(/payloadJson|authorityHash|contractJson|metricDataJson/)
 expect([await db.auditEvent.count(),await db.planImportReceipt.count()]).toEqual(before)
})
it('creates all three node families through dry-run/commit with canonical mode defaults',async()=>{
 const f=await pipelineFixture(db)
 const commands=[{op:'node.create',type:'WORKSTREAM',clientRef:'ws',parent:{type:'PROJECT',id:f.project.id},fields:{code:randomUUID(),name:'Added stream',executionMode:'SOFTWARE_SPRINT'}},{op:'node.create',type:'WORK_CONTAINER',clientRef:'container',parent:{type:'WORKSTREAM',ref:'ws'},fields:{code:randomUUID(),title:'Added container',subtype:'EPIC'}},{op:'node.create',type:'WORK_ITEM',clientRef:'item',parent:{type:'WORK_CONTAINER',ref:'container'},fields:{code:randomUUID(),title:'Added item',subtype:'TASK'}}]
 const receipt=await apply(f,commands)
 const created=receipt.deltaReceipt.changes.find(c=>c.type==='WORKSTREAM')
 expect(await db.workstream.findUnique({where:{id:created.id}})).toMatchObject({executionMode:'SOFTWARE_SPRINT',progressStrategy:'TASK_WEIGHT'})
})
it('reads the shared graph snapshot once while validating every candidate parent',async()=>{
 const {readStructureCanvas}=await import('@/modules/project-manager/application/structure-canvas')
 const f=await pipelineFixture(db),source=await container(f.ws)
 for(let index=0;index<8;index++)await container(f.ws)
 let graphReads=0
 const observed=new Proxy(db,{get(object,key){
  if(key==='$transaction')return (callback,settings)=>object.$transaction(tx=>callback(new Proxy(tx,{get(t,model){
   if(model==='workItem')return new Proxy(t.workItem,{get(delegate,method){if(method==='findMany')return args=>{graphReads++;return delegate.findMany(args)};return typeof delegate[method]==='function'?delegate[method].bind(delegate):delegate[method]}})
   return typeof t[model]==='function'?t[model].bind(t):t[model]
  }})),settings)
  return typeof object[key]==='function'?object[key].bind(object):object[key]
 }})
 const result=await readStructureCanvas(f.project.id,{viewer:f.viewer,db:observed,move:{type:'WORK_CONTAINER',id:source.id}})
 expect(result.targets).toHaveLength(8)
 expect(graphReads).toBe(1)
})
it('moves a deep subtree atomically without changing IDs or Feature links; newer edit fences undo',async()=>{
 const f=await pipelineFixture(db),root=await container(f.ws),child=await container(f.ws,root.id)
 const destination=await db.workstream.create({data:{code:randomUUID(),name:'Destination',projectId:f.project.id,executionMode:'SOFTWARE_SPRINT',progressStrategy:'TASK_WEIGHT'}})
 await db.workItem.update({where:{id:f.items[0].id},data:{containerId:child.id}})
 const feature=await db.projectFeature.create({data:{tenantId:f.tenant.id,businessId:f.business.id,projectId:f.project.id,code:randomUUID(),title:'Feature',problem:'Problem',outcome:'Outcome',primaryDomainId:'DOM-DEVELOPMENT',lifecycle:'DRAFT'}})
 const link=await db.featureWorkLink.create({data:{tenantId:f.tenant.id,businessId:f.business.id,featureId:feature.id,workItemId:f.items[0].id}})
 const receipt=await apply(f,await move('WORK_CONTAINER',root.id,{type:'WORKSTREAM',id:destination.id}))
 expect(await db.workContainer.findUnique({where:{id:child.id}})).toMatchObject({parentId:root.id,workstreamId:destination.id})
 expect(await db.workItem.findUnique({where:{id:f.items[0].id}})).toMatchObject({containerId:child.id,workstreamId:destination.id})
 expect(await db.featureWorkLink.findUnique({where:{id:link.id}})).toEqual(link)
 await db.workItem.update({where:{id:f.items[0].id},data:{title:'Newer edit'}})
 const refused=await dryRunPlan(pipelinePlan(f,{op:'undo',originalAuditEventId:receipt.auditEventId,expectedAfterHash:receipt.deltaReceipt.afterHash}),options(f))
 expect(refused.errors[0].code).toBe('UNDO_CONFLICT')
})
it('refuses invalid hierarchy, descendant cycle, foreign Project and incompatible mode without writes',async()=>{
 const f=await pipelineFixture(db),root=await container(f.ws),child=await container(f.ws,root.id),foreign=await pipelineFixture(db)
 const wrongMode=await db.workstream.create({data:{code:randomUUID(),name:'Sales',projectId:f.project.id,executionMode:'B2B_SALES',progressStrategy:'WEIGHTED_PIPELINE'}})
 const before=[await db.auditEvent.count(),await db.workItem.count()]
 for(const parent of [{type:'WORK_ITEM',id:f.items[1].id},{type:'WORK_CONTAINER',id:child.id},{type:'WORKSTREAM',id:foreign.ws.id},{type:'WORKSTREAM',id:wrongMode.id}]){
  const result=await dryRunPlan(pipelinePlan(f,await move('WORK_CONTAINER',root.id,parent)),options(f));expect(result.valid).toBe(false)
 }
 expect([await db.auditEvent.count(),await db.workItem.count()]).toEqual(before)
 expect(await db.workContainer.findUnique({where:{id:root.id}})).toMatchObject({workstreamId:f.ws.id,parentId:null})
})
it('refuses stale destination membership and preserves source/receipt/audit',async()=>{
 const f=await pipelineFixture(db),destination=await container(f.ws),command=await move('WORK_ITEM',f.items[0].id,{type:'WORK_CONTAINER',id:destination.id})
 const plan=pipelinePlan(f,command),dry=await dryRunPlan(plan,options(f));expect(dry.valid).toBe(true)
 await db.workItem.update({where:{id:f.items[1].id},data:{containerId:destination.id}})
 const before=[await db.auditEvent.count(),await db.planImportReceipt.count()]
 const result=await commitPlan({...plan,expectedPreviewHash:dry.previewHash},options(f));expect(result.committed).toBe(false)
 expect(['STALE_ENTITY','STALE_PREVIEW']).toContain(result.errors[0].code)
 expect(await db.workItem.findUnique({where:{id:f.items[0].id}})).toMatchObject({containerId:null,workstreamId:f.ws.id})
 expect([await db.auditEvent.count(),await db.planImportReceipt.count()]).toEqual(before)
})
