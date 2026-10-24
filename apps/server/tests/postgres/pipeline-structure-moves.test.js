// @req FR-082 — actual runtime-role subtree moves and observed graph-lock contention.
// @spec ADR-035, SDD-046, SEC-001
import {beforeAll,afterAll,it,expect} from 'vitest'
import {randomUUID} from 'node:crypto'
import {startPmRoleTarget} from '../helpers/pm-role-target'
import {pipelineFixture,pipelinePlan} from '../helpers/pipeline-handoff-fixture'
import {deferred,withinDeadline,waitForApprovalLock} from '../helpers/pm-approval-fixture'
import {readStructureCanvas} from '@/modules/project-manager/application/structure-canvas'
import {readPipelineState,pipelineSubtreeHash} from '@/modules/project-manager/application/pipeline-state'
import {dryRunPlan,commitPlan} from '@/modules/project-manager/import/plan-import-service'
let target
beforeAll(async()=>{target=await startPmRoleTarget()},120000)
afterAll(()=>target?.stop())
const opts=(f,db=target.runtime)=>({viewer:f.viewer,db})
const container=(ws,parentId=null)=>target.admin.workContainer.create({data:{code:randomUUID(),title:'C3 owned container',subtype:'EPIC',workstreamId:ws.id,parentId}})
async function move(f,id,parentId){const state=await readPipelineState(target.admin);return pipelinePlan(f,{op:'node.move',type:'WORK_CONTAINER',id,parent:{type:'WORK_CONTAINER',id:parentId},expectedEntityHash:pipelineSubtreeHash(state,{type:'WORK_CONTAINER',id}),expectedParentHash:pipelineSubtreeHash(state,{type:'WORK_CONTAINER',id:parentId})})}
async function preview(f,plan){const dry=await dryRunPlan(plan,opts(f));expect(dry.valid,JSON.stringify(dry)).toBe(true);return {...plan,expectedPreviewHash:dry.previewHash}}
it('reads valid targets and commits subtree membership using a real non-owner non-bypass role',async()=>{
 const [role]=await target.runtime.$queryRawUnsafe('SELECT current_user,rolsuper,rolbypassrls FROM pg_roles WHERE rolname=current_user')
 expect(role).toMatchObject({current_user:'zuri_web_login',rolsuper:false,rolbypassrls:false})
 const owners=await target.runtime.$queryRawUnsafe("SELECT tableowner FROM pg_tables WHERE tablename IN ('WorkContainer','WorkItem')");expect(owners.every(row=>row.tableowner!==role.current_user)).toBe(true)
 const f=await pipelineFixture(target.admin),a=await container(f.ws),child=await container(f.ws,a.id)
 const destination=await target.admin.workstream.create({data:{code:randomUUID(),name:'C3 destination',projectId:f.project.id,executionMode:'SOFTWARE_SPRINT',progressStrategy:'TASK_WEIGHT'}}),b=await container(destination)
 await target.admin.workItem.update({where:{id:f.items[0].id},data:{containerId:child.id}})
 const feature=await target.admin.projectFeature.create({data:{tenantId:f.tenant.id,businessId:f.business.id,projectId:f.project.id,code:randomUUID(),title:'C3 retained Feature',problem:'Problem',outcome:'Outcome',primaryDomainId:'DOM-DEVELOPMENT',lifecycle:'DRAFT'}})
 const link=await target.admin.featureWorkLink.create({data:{tenantId:f.tenant.id,businessId:f.business.id,featureId:feature.id,workItemId:f.items[0].id}})
 const canvas=await readStructureCanvas(f.project.id,{...opts(f),move:{type:'WORK_CONTAINER',id:a.id}})
 expect(canvas.targets.some(row=>row.id===b.id)).toBe(true);expect(canvas.targets.some(row=>row.id===child.id)).toBe(false)
 const plan=await preview(f,await move(f,a.id,b.id)),receipt=await commitPlan(plan,opts(f));expect(receipt.committed).toBe(true)
 expect(await target.admin.workContainer.findUnique({where:{id:a.id}})).toMatchObject({parentId:b.id,workstreamId:destination.id})
 expect(await target.admin.workContainer.findUnique({where:{id:child.id}})).toMatchObject({parentId:a.id,workstreamId:destination.id})
 expect(await target.admin.workItem.findUnique({where:{id:f.items[0].id}})).toMatchObject({containerId:child.id,workstreamId:destination.id})
 expect(await target.admin.featureWorkLink.findUnique({where:{id:link.id}})).toEqual(link)
 expect((await commitPlan(plan,opts(f))).auditEventId).toBe(receipt.auditEventId)
 const undo=await preview(f,pipelinePlan(f,{op:'undo',originalAuditEventId:receipt.auditEventId,expectedAfterHash:receipt.deltaReceipt.afterHash}))
 expect((await commitPlan(undo,opts(f))).committed).toBe(true)
 expect(await target.admin.workContainer.findUnique({where:{id:a.id}})).toMatchObject({parentId:null})
})
function instrument(db,hooks={}){return new Proxy(db,{get(object,key){
 if(key==='$transaction')return async(callback,settings)=>{const [{pid}]=await object.$queryRawUnsafe('SELECT pg_backend_pid() AS pid');hooks.backend?.(pid);return object.$transaction(tx=>callback(new Proxy(tx,{get(t,field){
  if(field==='auditEvent')return new Proxy(t.auditEvent,{get(delegate,method){if(method==='create')return async args=>{await hooks.beforeAudit?.();return delegate.create(args)};return typeof delegate[method]==='function'?delegate[method].bind(delegate):delegate[method]}})
  return typeof t[field]==='function'?t[field].bind(t):t[field]
 }})),settings)}
 return typeof object[key]==='function'?object[key].bind(object):object[key]
}})}
it('opposing subtree moves overlap on independent sessions with one winner and no losing receipt/audit',async()=>{
 const f=await pipelineFixture(target.admin),a=await container(f.ws),b=await container(f.ws)
 const plans=[await preview(f,await move(f,a.id,b.id)),await preview(f,await move(f,b.id,a.id))]
 const held=deferred(),release=deferred(),pids=[];let paused=false,second
 const leader=instrument(target.runtime,{backend:pid=>pids[0]=pid,beforeAudit:async()=>{if(!paused){paused=true;held.resolve();await release.promise}}})
 const follower=instrument(target.otherRuntime,{backend:pid=>pids[1]=pid})
 const first=commitPlan(plans[0],opts(f,leader))
 try{
  await withinDeadline(held.promise,'C3 leader before audit');second=commitPlan(plans[1],opts(f,follower));await waitForApprovalLock(target.admin,()=>pids)
  expect(pids[0]).not.toBe(pids[1]);release.resolve();const results=await Promise.all([first,second]);expect(results.filter(row=>row.committed)).toHaveLength(1)
  expect(await target.admin.planImportReceipt.count({where:{idempotencyKey:{in:plans.map(row=>row.trace.idempotencyKey)}}})).toBe(1)
  expect(await target.admin.auditEvent.count({where:{entityId:f.project.id,action:'PLAN_DELTA_COMMITTED'}})).toBe(1)
  expect(await target.admin.workContainer.findUnique({where:{id:b.id}})).toMatchObject({parentId:null})
 }finally{release.resolve();await Promise.allSettled([first,second].filter(Boolean))}
})
it('audit failure rolls back every moved descendant and leaves no receipt or trace',async()=>{
 const f=await pipelineFixture(target.admin),a=await container(f.ws),b=await container(f.ws),child=await container(f.ws,a.id)
 const plan=await preview(f,await move(f,a.id,b.id)),before=await target.admin.workContainer.findMany({where:{id:{in:[a.id,b.id,child.id]}},orderBy:{id:'asc'}})
 const failing=instrument(target.runtime,{beforeAudit:()=>{throw new Error('C3 injected rollback')}})
 expect((await commitPlan(plan,opts(f,failing))).committed).toBe(false)
 expect(await target.admin.workContainer.findMany({where:{id:{in:[a.id,b.id,child.id]}},orderBy:{id:'asc'}})).toEqual(before)
 expect(await target.admin.planImportReceipt.count({where:{idempotencyKey:plan.trace.idempotencyKey}})).toBe(0)
 expect(await target.admin.projectExecutionRun.count({where:{correlationId:plan.trace.correlationId}})).toBe(0)
})
