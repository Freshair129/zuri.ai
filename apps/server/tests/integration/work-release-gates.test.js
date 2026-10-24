// @req FR-085 — protected CRUD entry shares the declared handoff release predicate.
// @spec ADR-035, BR-017, SEC-001
import {it,expect,vi} from 'vitest'
import {randomUUID} from 'node:crypto'
import db from '@/lib/db'
import {pipelineFixture,pipelinePlan,edgeCommand} from '../helpers/pipeline-handoff-fixture'
import {dryRunPlan,commitPlan} from '@/modules/project-manager/import/plan-import-service'
import {createItem,updateItem} from '@/modules/project-manager/application/work-service'
const routeContext=vi.hoisted(()=>({viewer:null}))
vi.mock('@/modules/identity/request-viewer',()=>({resolveRequestViewer:async()=>routeContext.viewer}))
const options=f=>({viewer:f.viewer,db})
async function attach(f,command=edgeCommand(f.items[0],f.items[1])) {
 const plan=pipelinePlan(f,command),dry=await dryRunPlan(plan,options(f));expect(dry.valid,JSON.stringify(dry)).toBe(true)
 const result=await commitPlan({...plan,expectedPreviewHash:dry.previewHash},options(f));expect(result.committed,JSON.stringify(result)).toBe(true);return result
}
it('refuses a held protected CRUD transition atomically but permits pause and identical status',async()=>{
 const f=await pipelineFixture(db);await attach(f)
 const before=await db.workItem.findUnique({where:{id:f.items[1].id}}),audits=await db.auditEvent.count()
 await expect(updateItem(before.id,{title:'must roll back',status:'IN_PROGRESS'},options(f))).rejects.toMatchObject({code:'RELEASE_HELD',status:409})
 expect(await db.workItem.findUnique({where:{id:before.id}})).toEqual(before);expect(await db.auditEvent.count()).toBe(audits)
 await expect(updateItem(before.id,{status:'BLOCKED'},options(f))).resolves.toMatchObject({status:'BLOCKED'})
 await db.workItem.update({where:{id:before.id},data:{status:'IN_PROGRESS'}})
 await expect(updateItem(before.id,{title:'allowed same status',status:'IN_PROGRESS'},options(f))).resolves.toMatchObject({title:'allowed same status'})
 await expect(updateItem(before.id,{status:'DONE'},options(f))).rejects.toMatchObject({code:'RELEASE_HELD'})
})
it('refuses protected creation in aggregate scope without leaving item or audit',async()=>{
 const f=await pipelineFixture(db),other=await db.workstream.create({data:{code:randomUUID(),name:'Successor',projectId:f.project.id,executionMode:'SOFTWARE_SPRINT',progressStrategy:'TASK_WEIGHT'}})
 const c=edgeCommand(f.items[0],f.items[1]);c.target={type:'WORKSTREAM',id:other.id};await attach(f,c)
 const count=await db.workItem.count(),audit=await db.auditEvent.count()
 await expect(createItem({title:'held new',subtype:'TASK',workstreamId:other.id,status:'DONE'},options(f))).rejects.toMatchObject({code:'RELEASE_HELD'})
 expect(await db.workItem.count()).toBe(count);expect(await db.auditEvent.count()).toBe(audit)
 await expect(createItem({title:'planned new',subtype:'TASK',workstreamId:other.id},options(f))).resolves.toMatchObject({status:'PLANNED'})
})

import {getWorkItemReleaseState} from '@/modules/project-manager/application/work-release-policy'
import {dependencyHash} from '@/modules/project-manager/application/handoff-contract'
import {createProjectManagerMcpTransport} from '@/modules/project-manager/mcp/transport'
it('manual decisions bind evidence, never rewrite active history, and new protected entry rechecks',async()=>{
 const f=await pipelineFixture(db);await attach(f)
 const edge=await db.dependency.findFirst({where:{sourceId:f.items[0].id,targetId:f.items[1].id}})
 expect(await getWorkItemReleaseState(f.items[1].id,options(f))).toMatchObject({held:true,restricted:false,blockers:[{state:'DECLARED',reason:'UNSATISFIED',predecessor:{id:f.items[0].id}}]})
 const contract=JSON.parse(edge.contractJson),input={version:1,deliverable:contract.deliverable,acceptance:{kind:'MANUAL',satisfied:true}}
 await attach(f,{op:'dependency.contract',id:edge.id,expectedDependencyHash:dependencyHash(edge),contract:input})
 await expect(updateItem(f.items[1].id,{status:'DONE'},options(f))).resolves.toMatchObject({status:'DONE'})
 const current=await db.dependency.findUnique({where:{id:edge.id}})
 await attach(f,{op:'dependency.contract',id:edge.id,expectedDependencyHash:dependencyHash(current),contract:{...input,acceptance:{kind:'MANUAL',satisfied:false}}})
 expect((await db.workItem.findUnique({where:{id:f.items[1].id}})).status).toBe('DONE')
 expect((await getWorkItemReleaseState(f.items[1].id,options(f))).held).toBe(true)
 await expect(updateItem(f.items[1].id,{status:'REVIEW'},options(f))).rejects.toMatchObject({code:'RELEASE_HELD'})
 const latest=await db.dependency.findUnique({where:{id:edge.id}}),stored=JSON.parse(latest.contractJson)
 await db.auditEvent.delete({where:{id:stored.acceptance.decisionAuditEventId}})
 expect((await getWorkItemReleaseState(f.items[1].id,options(f))).blockers[0]).toMatchObject({state:'INVALID',reason:'EVIDENCE_UNAVAILABLE'})
})
it('redacts every blocker for an opaque predecessor and denies unreadable target first',async()=>{
 const f=await pipelineFixture(db),foreign=await pipelineFixture(db)
 await db.dependency.create({data:{sourceType:'WORK_ITEM',sourceId:foreign.items[0].id,targetType:'WORK_ITEM',targetId:f.items[1].id,dependencyType:'BLOCKS',contractJson:'invalid'}})
 const result=await getWorkItemReleaseState(f.items[1].id,options(f))
 expect(result).toEqual({held:true,blockers:[],truncated:false,restricted:true})
 expect(JSON.stringify(result)).not.toContain(foreign.items[0].id)
 await expect(getWorkItemReleaseState(foreign.items[0].id,options(f))).rejects.toThrow()
 await expect(updateItem(f.items[1].id,{status:'DONE'},options(f))).rejects.toMatchObject({code:'SCOPE_UNAVAILABLE',status:404})
})
it('legacy null does not hold and Gate finish-only guards only DONE, not starting',async()=>{
 const f=await pipelineFixture(db)
 await db.dependency.create({data:{sourceType:'WORK_ITEM',sourceId:f.items[0].id,targetType:'WORK_ITEM',targetId:f.items[1].id,dependencyType:'BLOCKS'}})
 await expect(updateItem(f.items[1].id,{status:'DONE'},options(f))).resolves.toMatchObject({status:'DONE'})
 const gate=await db.gate.create({data:{code:randomUUID(),title:'Acceptance',projectId:f.project.id,workstreamId:f.ws.id,status:'OPEN'}})
 const command=edgeCommand(f.items[0],f.items[2],'FINISH_BEFORE');command.contract.acceptance={kind:'GATE',gateId:gate.id};await attach(f,command)
 await expect(updateItem(f.items[2].id,{status:'IN_PROGRESS'},options(f))).resolves.toMatchObject({status:'IN_PROGRESS'})
 await expect(updateItem(f.items[2].id,{status:'DONE'},options(f))).rejects.toMatchObject({code:'RELEASE_HELD'})
 await db.gate.update({where:{id:gate.id},data:{status:'WAIVED'}})
 await expect(updateItem(f.items[2].id,{status:'DONE'},options(f))).resolves.toMatchObject({status:'DONE'})
})
it('default MCP transport cannot bypass the canonical protected writer',async()=>{
 const f=await pipelineFixture(db);await attach(f)
 const transport=createProjectManagerMcpTransport()
 const init=await transport.handle({jsonrpc:'2.0',id:1,method:'initialize',params:{protocolVersion:'2024-11-05',capabilities:{},clientInfo:{name:'C4',version:'1'}}},{viewer:f.viewer})
 await transport.handle({jsonrpc:'2.0',method:'notifications/initialized'},{viewer:f.viewer,sessionId:init.sessionId})
 const response=await transport.handle({jsonrpc:'2.0',id:2,method:'tools/call',params:{name:'project_manager.work_status_update',arguments:{workItemId:f.items[1].id,status:'DONE'}}},{viewer:f.viewer,sessionId:init.sessionId})
 expect(JSON.stringify(response)).toContain('RELEASE_HELD')
 expect((await db.workItem.findUnique({where:{id:f.items[1].id}})).status).toBe('PLANNED')
})

it('HTTP release/listing precedes status editing; PATCH/create cannot bypass and foreign targets redact',async()=>{
 const f=await pipelineFixture(db);await attach(f);routeContext.viewer=f.viewer
 const {GET,PATCH}=await import('@/app/api/work/[id]/route')
 const response=await GET(new Request('http://local/api/work/'+f.items[1].id),{params:{id:f.items[1].id}})
 expect(response.status).toBe(200);expect(await response.json()).toMatchObject({held:true,restricted:false})
 const patch=await PATCH(new Request('http://local/api/work/'+f.items[1].id,{method:'PATCH',body:JSON.stringify({status:'DONE'})}),{params:{id:f.items[1].id}})
 expect(patch.status).toBe(409);expect((await patch.json()).error).toBe('RELEASE_HELD')
 const {GET:list}=await import('@/app/api/work/route')
 const listing=await list(new Request('http://local/api/work?projectId='+f.project.id+'&release=1'))
 expect(listing.status).toBe(200);expect((await listing.json()).items.find(item=>item.id===f.items[1].id).release.held).toBe(true)
 const foreign=await pipelineFixture(db)
 const unavailable=await GET(new Request('http://local'),{params:{id:foreign.items[0].id}}),missing=await GET(new Request('http://local'),{params:{id:randomUUID()}})
 expect(unavailable.status).toBe(404);expect(await unavailable.json()).toEqual(await missing.json())
})
it('full import and delta initial protected status retain the same release guard',async()=>{
 const f=await pipelineFixture(db),other=await db.workstream.create({data:{code:randomUUID(),name:'Import successor',projectId:f.project.id,executionMode:'SOFTWARE_SPRINT',progressStrategy:'TASK_WEIGHT'}})
 const command=edgeCommand(f.items[0],f.items[1]);command.target={type:'WORKSTREAM',id:other.id};await attach(f,command)
 const code=randomUUID()
 const plan={schemaVersion:'1.0',generatedBy:'C4 test',scope:{workspaceCode:f.workspace.code},project:{code:f.project.code,name:f.project.name},workstreams:[{code:other.code,name:other.name,executionMode:'SOFTWARE_SPRINT',progressStrategy:'TASK_WEIGHT',items:[{code,title:'Held import',subtype:'TASK',status:'DONE'}]}]}
 const before=[await db.auditEvent.count({where:{action:'PLAN_IMPORTED'}}),await db.planImportReceipt.count()]
 await expect(commitPlan(plan,options(f))).rejects.toMatchObject({code:'RELEASE_HELD',status:409})
 expect(await db.workItem.findUnique({where:{code}})).toBeNull();expect([await db.auditEvent.count({where:{action:'PLAN_IMPORTED'}}),await db.planImportReceipt.count()]).toEqual(before)
 // Legacy full import intentionally persists a failed execution trace after rollback.
 const failed=await db.projectExecutionRun.findFirst({where:{projectId:f.project.id,status:'FAILED'}});expect(failed).not.toBeNull()
 const delta=pipelinePlan(f,{op:'node.create',type:'WORK_ITEM',clientRef:'held',parent:{type:'WORKSTREAM',id:other.id},fields:{code:randomUUID(),title:'Held delta',subtype:'TASK',status:'DONE'}})
 const dry=await dryRunPlan(delta,options(f));expect(dry.valid).toBe(false);expect(dry.errors[0].code).toBe('RELEASE_HELD')
})

it('protected CRUD cannot join a foreign or deleted container while keeping its old Workstream',async()=>{
 const f=await pipelineFixture(db),foreign=await pipelineFixture(db)
 const container=await db.workContainer.create({data:{code:randomUUID(),title:'Private parent',subtype:'EPIC',workstreamId:foreign.ws.id}})
 await expect(updateItem(f.items[0].id,{containerId:container.id,status:'DONE'},options(f))).rejects.toMatchObject({status:404})
 expect((await db.workItem.findUnique({where:{id:f.items[0].id}})).containerId).toBeNull()
})

it('rechecks current owner membership under the graph fence before protected release',async()=>{
 const f=await pipelineFixture(db)
 await db.membership.update({where:{id:f.membership.id},data:{role:'MEMBER'}})
 const before=await db.workItem.findUnique({where:{id:f.items[0].id}})
 await expect(updateItem(before.id,{status:'DONE'},options(f))).rejects.toMatchObject({code:'SCOPE_UNAVAILABLE',status:404})
 expect(await db.workItem.findUnique({where:{id:before.id}})).toEqual(before)
})
it('batch release projection loads the graph once for multiple authorized Projects',async()=>{
 const f=await pipelineFixture(db),g=await pipelineFixture(db,{tenant:f.tenant,person:f.person})
 let graphReads=0
 const observed=new Proxy(db,{get(object,key){
  if(key==='$transaction')return (callback,settings)=>object.$transaction(tx=>callback(new Proxy(tx,{get(t,model){
   if(model==='dependency')return new Proxy(t.dependency,{get(delegate,method){if(method==='findMany')return args=>{graphReads++;return delegate.findMany(args)};return typeof delegate[method]==='function'?delegate[method].bind(delegate):delegate[method]}})
   return typeof t[model]==='function'?t[model].bind(t):t[model]
  }})),settings)
  return typeof object[key]==='function'?object[key].bind(object):object[key]
 }})
 const {getWorkItemReleaseStates}=await import('@/modules/project-manager/application/work-release-policy')
 const states=await getWorkItemReleaseStates([...f.items,...g.items].map(row=>row.id),{viewer:g.viewer,db:observed})
 expect(Object.keys(states)).toHaveLength(6);expect(graphReads).toBe(1)
})
