// @req FR-085 — actual runtime roles serialize protected release against evidence changes.
// @spec ADR-035, BR-017, SEC-001
import {beforeAll,afterAll,it,expect} from 'vitest'
import {randomUUID} from 'node:crypto'
import {startPmRoleTarget} from '../helpers/pm-role-target'
import {pipelineFixture,pipelinePlan,edgeCommand} from '../helpers/pipeline-handoff-fixture'
import {deferred,withinDeadline,waitForApprovalLock} from '../helpers/pm-approval-fixture'
import {updateItem} from '@/modules/project-manager/application/work-service'
import {updateGate} from '@/modules/project-manager/application/milestone-gate-service'
import {getWorkItemReleaseState} from '@/modules/project-manager/application/work-release-policy'
import {dryRunPlan,commitPlan} from '@/modules/project-manager/import/plan-import-service'
import {dependencyHash} from '@/modules/project-manager/application/handoff-contract'
let target
beforeAll(async()=>{target=await startPmRoleTarget()},120000)
afterAll(()=>target?.stop())
const options=(f,db=target.runtime)=>({viewer:f.viewer,db})
async function fixture(){
 const f=await pipelineFixture(target.admin)
 const gate=await target.admin.gate.create({data:{code:randomUUID(),title:'C4 acceptance',projectId:f.project.id,workstreamId:f.ws.id,status:'PASSED'}})
 await target.admin.dependency.create({data:{sourceType:'WORK_ITEM',sourceId:f.items[0].id,targetType:'WORK_ITEM',targetId:f.items[1].id,dependencyType:'BLOCKS',contractJson:JSON.stringify({version:1,deliverable:'Drawing',acceptance:{kind:'GATE',gateId:gate.id}})}})
 return {...f,gate}
}
function instrument(db,hooks={}){return new Proxy(db,{get(object,key){
 if(key==='$transaction')return async(callback,settings)=>{const [{pid}]=await object.$queryRawUnsafe('SELECT pg_backend_pid() AS pid');hooks.backend?.(pid);return object.$transaction(tx=>callback(new Proxy(tx,{get(t,field){
  if(field==='auditEvent')return new Proxy(t.auditEvent,{get(delegate,method){if(method==='create')return async args=>{await hooks.beforeAudit?.();return delegate.create(args)};return typeof delegate[method]==='function'?delegate[method].bind(delegate):delegate[method]}})
  return typeof t[field]==='function'?t[field].bind(t):t[field]
 }})),settings)}
 return typeof object[key]==='function'?object[key].bind(object):object[key]
}})}
async function overlap(leader,follower){
 const held=deferred(),release=deferred(),pids=[];let paused=false,second
 const a=instrument(target.runtime,{backend:pid=>pids[0]=pid,beforeAudit:async()=>{if(!paused){paused=true;held.resolve();await release.promise}}})
 const b=instrument(target.otherRuntime,{backend:pid=>pids[1]=pid})
 const first=leader(a).then(value=>({value}),error=>({error}))
 try{
  await withinDeadline(held.promise,'C4 leader before audit')
  second=follower(b).then(value=>({value}),error=>({error}))
  await waitForApprovalLock(target.admin,()=>pids);expect(pids[0]).not.toBe(pids[1]);release.resolve()
  return await Promise.all([first,second])
 }finally{release.resolve();await Promise.allSettled([first,second].filter(Boolean))}
}
it('non-owner/non-superuser/non-bypass runtime role reads and writes the accepted engine',async()=>{
 const [role]=await target.runtime.$queryRawUnsafe('SELECT current_user,rolsuper,rolbypassrls FROM pg_roles WHERE rolname=current_user')
 expect(role).toMatchObject({current_user:'zuri_web_login',rolsuper:false,rolbypassrls:false})
 const owners=await target.runtime.$queryRawUnsafe("SELECT tableowner FROM pg_tables WHERE tablename IN ('WorkItem','Dependency','Gate')")
 expect(owners.every(row=>row.tableowner!==role.current_user)).toBe(true)
 const f=await fixture();expect((await getWorkItemReleaseState(f.items[1].id,options(f))).held).toBe(false)
 await expect(updateItem(f.items[1].id,{status:'DONE'},options(f))).resolves.toMatchObject({status:'DONE'})
})
it('Gate revocation wins before release: follower re-reads after observed independent-session wait',async()=>{
 const f=await fixture(),before=await target.admin.workItem.findUnique({where:{id:f.items[1].id}})
 const [first,second]=await overlap(db=>updateGate(f.gate.id,{status:'OPEN'},options(f,db)),db=>updateItem(f.items[1].id,{status:'DONE'},options(f,db)))
 expect(first.error).toBeUndefined();expect(second.error).toMatchObject({code:'RELEASE_HELD'})
 expect(await target.admin.workItem.findUnique({where:{id:before.id}})).toEqual(before)
 expect(await target.admin.auditEvent.count({where:{entityId:before.id,action:'UPDATED'}})).toBe(0)
})
it('release can win first; subsequent evidence change displays held without rewriting DONE',async()=>{
 const f=await fixture()
 const [first,second]=await overlap(db=>updateItem(f.items[1].id,{status:'DONE'},options(f,db)),db=>updateGate(f.gate.id,{status:'OPEN'},options(f,db)))
 expect(first.error).toBeUndefined();expect(second.error).toBeUndefined()
 expect((await target.admin.workItem.findUnique({where:{id:f.items[1].id}})).status).toBe('DONE')
 expect((await getWorkItemReleaseState(f.items[1].id,options(f))).held).toBe(true)
 await expect(updateItem(f.items[1].id,{status:'REVIEW'},options(f))).rejects.toMatchObject({code:'RELEASE_HELD'})
})
it('manual contract revocation and protected writer share the same global transaction fence',async()=>{
 const f=await pipelineFixture(target.admin),command=edgeCommand(f.items[0],f.items[1]);command.contract.acceptance.satisfied=true
 let plan=pipelinePlan(f,command),dry=await dryRunPlan(plan,options(f));expect(dry.valid).toBe(true)
 expect((await commitPlan({...plan,expectedPreviewHash:dry.previewHash},options(f))).committed).toBe(true)
 const edge=await target.admin.dependency.findFirst({where:{sourceId:f.items[0].id,targetId:f.items[1].id}})
 plan=pipelinePlan(f,{op:'dependency.contract',id:edge.id,expectedDependencyHash:dependencyHash(edge),contract:{version:1,deliverable:'Drawing',acceptance:{kind:'MANUAL',satisfied:false}}})
 dry=await dryRunPlan(plan,options(f));expect(dry.valid).toBe(true)
 const [first,second]=await overlap(db=>commitPlan({...plan,expectedPreviewHash:dry.previewHash},options(f,db)),db=>updateItem(f.items[1].id,{status:'IN_PROGRESS'},options(f,db)))
 expect(first.value.committed).toBe(true);expect(second.error).toMatchObject({code:'RELEASE_HELD'})
 expect((await target.admin.workItem.findUnique({where:{id:f.items[1].id}})).status).toBe('PLANNED')
})
it('audit failure rolls a permitted protected status and version back atomically',async()=>{
 const f=await fixture(),before=await target.admin.workItem.findUnique({where:{id:f.items[1].id}}),count=await target.admin.auditEvent.count()
 const failing=instrument(target.runtime,{beforeAudit:()=>{throw new Error('C4 audit rollback')}})
 await expect(updateItem(before.id,{status:'DONE'},options(f,failing))).rejects.toThrow('C4 audit rollback')
 expect(await target.admin.workItem.findUnique({where:{id:before.id}})).toEqual(before);expect(await target.admin.auditEvent.count()).toBe(count)
})

it('protected runtime write rechecks revoked membership and rolls every field back',async()=>{
 const f=await fixture(),before=await target.admin.workItem.findUnique({where:{id:f.items[1].id}})
 await target.admin.membership.update({where:{id:f.membership.id},data:{role:'MEMBER'}})
 await expect(updateItem(before.id,{title:'must not survive',status:'DONE'},options(f))).rejects.toMatchObject({code:'SCOPE_UNAVAILABLE',status:404})
 expect(await target.admin.workItem.findUnique({where:{id:before.id}})).toEqual(before)
})
