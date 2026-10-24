// @req FR-084 — both endpoint scopes precede audit/Gate evidence reads and opaque effects refuse atomically.
// @spec SEC-001, ADR-035
import {it,expect} from 'vitest'
import {randomUUID} from 'node:crypto'
import prisma from '@/lib/db'
import {dryRunPlan,commitPlan} from '@/modules/project-manager/import/plan-import-service'
import {dryRunPlanDelta,commitPlanDelta} from '@/modules/project-manager/import/plan-delta-service'
import {dryRunBundle} from '@/modules/project-manager/import/bundle/bundle-dry-run'
import {pipelineFixture,pipelinePlan,edgeCommand} from '../helpers/pipeline-handoff-fixture'
function observe(db,calls){return new Proxy(db,{get(base,key){
 if(key==='$transaction')return (fn,settings)=>base.$transaction(tx=>fn(new Proxy(tx,{get(t,field){
  if(['auditEvent','gate'].includes(field))return new Proxy(t[field],{get(d,method){if(method==='findMany')return args=>{calls.push({model:field,args});return d.findMany(args)};return typeof d[method]==='function'?d[method].bind(d):d[method]}})
  return typeof t[field]==='function'?t[field].bind(t):t[field]
 }})),settings)
 return typeof base[key]==='function'?base[key].bind(base):base[key]
}})}
async function save(plan,viewer,register=false){const opts={viewer,register},dry=await dryRunPlanDelta(plan,opts);expect(dry.valid,JSON.stringify(dry.errors)).toBe(true);const saved=await commitPlanDelta({...plan,expectedPreviewHash:dry.previewHash},opts);expect(saved.committed).toBe(true);return saved}
const full=f=>({schemaVersion:'1.0',scope:{workspaceCode:f.workspace.code},project:{code:f.project.code,name:f.project.name},workstreams:[]})
const bundle=f=>({kind:'EXECUTION_PLAN_BUNDLE',schemaVersion:'1.1',manifest:{code:'B-'+randomUUID().slice(0,8),title:'Scoped evidence'},scope:{businessCode:f.business.code,defaultWorkspaceCode:f.workspace.code},projects:[{bundleProjectRef:'A',plan:full(f)}],dependencies:[],trace:{correlationId:randomUUID(),idempotencyKey:randomUUID()},expectedPreviewHash:null})
it('Bundle ignores unrelated foreign manual audits and never loads foreign Gate facts',async()=>{
 const f=await pipelineFixture(prisma),foreign=await pipelineFixture(prisma)
 const saved=await save(pipelinePlan(foreign,edgeCommand(foreign.items[0],foreign.items[1])),foreign.viewer)
 await prisma.gate.create({data:{code:randomUUID(),title:'Foreign',projectId:foreign.project.id,status:'PASSED'}})
 const calls=[],dry=await dryRunBundle(bundle(f),{viewer:f.viewer,db:observe(prisma,calls)})
 expect(dry.valid,JSON.stringify(dry.errors)).toBe(true)
 expect(calls.filter(call=>call.model==='auditEvent').every(call=>!JSON.stringify(call.args).includes(saved.auditEventId))).toBe(true)
 expect(calls.filter(call=>call.model==='gate').every(call=>(call.args.select && Object.keys(call.args.select).every(key=>['id','projectId','workstreamId'].includes(key))) || (call.args.where?.projectId?.in||[]).every(id=>id!==foreign.project.id))).toBe(true)
})
it('Delta refuses an opaque protected effect before reading the predecessor audit',async()=>{
 const f=await pipelineFixture(prisma),other=await pipelineFixture(prisma,{tenant:f.tenant,person:f.person})
 const command={...edgeCommand(other.items[0],f.items[0]),target:{type:'WORKSTREAM',id:f.ws.id}}
 const {projectId,...base}=pipelinePlan(f,command),saved=await save({...base,kind:'DEPENDENCY_REGISTER',projectIds:[f.project.id,other.project.id].sort()},other.viewer,true)
 await prisma.membership.update({where:{id:other.membership.id},data:{status:'REVOKED'}})
 const input=pipelinePlan(f,{op:'node.create',type:'WORK_ITEM',clientRef:'new',parent:{type:'WORKSTREAM',id:f.ws.id},fields:{code:'W-'+randomUUID().slice(0,8),title:'Protected',subtype:'TASK',status:'IN_PROGRESS'}})
 const calls=[],dry=await dryRunPlan(input,{viewer:f.viewer,db:observe(prisma,calls)})
 expect(dry.valid).toBe(false);expect(dry.errors[0].code).toBe('SCOPE_UNAVAILABLE')
 expect(calls.filter(call=>call.model==='auditEvent').every(call=>!JSON.stringify(call.args).includes(saved.auditEventId))).toBe(true)
})
it('a satisfied readable predecessor outside the Bundle does not cause a false restricted hold',async()=>{
 const f=await pipelineFixture(prisma),external=await prisma.project.create({data:{code:randomUUID(),name:'External predecessor',businessId:f.business.id,workspaceId:f.workspace.id}})
 const ws=await prisma.workstream.create({data:{code:randomUUID(),name:'External delivery',projectId:external.id,executionMode:'SOFTWARE_SPRINT',progressStrategy:'TASK_WEIGHT'}})
 const item=await prisma.workItem.create({data:{code:randomUUID(),title:'Accepted input',subtype:'TASK',workstreamId:ws.id}})
 const command={...edgeCommand(item,f.items[0]),target:{type:'WORKSTREAM',id:f.ws.id}};command.contract.acceptance.satisfied=true
 const {projectId,...base}=pipelinePlan(f,command);await save({...base,kind:'DEPENDENCY_REGISTER',projectIds:[f.project.id,external.id].sort()},f.viewer,true)
 const input=bundle(f);input.projects[0].plan.workstreams=[{code:f.ws.code,name:f.ws.name,executionMode:'SOFTWARE_SPRINT',progressStrategy:'TASK_WEIGHT',items:[{code:f.items[0].code,title:f.items[0].title,subtype:'TASK',status:'DONE'}]}]
 const dry=await dryRunBundle(input,{viewer:f.viewer});expect(dry.valid,JSON.stringify(dry.errors)).toBe(true)
})

it('cross-Project undo refuses from scope metadata before fetching the private original audit',async()=>{
 const f=await pipelineFixture(prisma),other=await pipelineFixture(prisma,{tenant:f.tenant,person:f.person}),[a,b]=[f,other].sort((a,b)=>a.project.id.localeCompare(b.project.id))
 const {projectId,...base}=pipelinePlan(a,edgeCommand(a.items[0],b.items[0])),saved=await save({...base,kind:'DEPENDENCY_REGISTER',projectIds:[a.project.id,b.project.id]},other.viewer,true)
 await prisma.membership.update({where:{id:b.membership.id},data:{status:'REVOKED'}})
 const calls=[],undo=pipelinePlan(a,{op:'undo',originalAuditEventId:saved.auditEventId,expectedAfterHash:saved.deltaReceipt.afterHash})
 expect((await dryRunPlan(undo,{viewer:other.viewer,db:observe(prisma,calls)})).errors[0].code).toBe('SCOPE_UNAVAILABLE')
 expect(calls.filter(call=>call.model==='auditEvent').every(call=>!JSON.stringify(call.args).includes(saved.auditEventId))).toBe(true)
})
