import {DEPENDENCY_ENDPOINT_TYPES,DEPENDENCY_TYPES} from '@/lib/validation/enums'
import {dryRunPlanDelta,commitPlanDelta} from '@/modules/project-manager/import/plan-delta-service'
import {createProjectFeature,replaceProjectFeatureWorkLinks} from '@/modules/project-manager/application/project-feature-service'
import {updateGate} from '@/modules/project-manager/application/milestone-gate-service'
// @req FR-084 — isolated actual runtime-role serialization and provider persistence.
// @spec ADR-035, ADR-057, SEC-001
import {randomUUID} from 'node:crypto'
import {readFile,writeFile,mkdtemp,rm} from 'node:fs/promises'
import {execFile} from 'node:child_process'
import {promisify} from 'node:util'
import path from 'node:path'
import {tmpdir} from 'node:os'
import {computeSnapshotSha256} from '@/modules/project-manager/application/phase-b-backup'
import {beforeAll,afterAll,describe,it,expect} from 'vitest'
import {startPmRoleTarget} from '../helpers/pm-role-target'
import {pipelineFixture,pipelinePlan,edgeCommand} from '../helpers/pipeline-handoff-fixture'
import {dryRunPlan,commitPlan} from '@/modules/project-manager/import/plan-import-service'
import {deferred,withinDeadline,waitForApprovalLock} from '../helpers/pm-approval-fixture'
import {PIPELINE_GRAPH_LOCK} from '@/modules/project-manager/application/pipeline-transaction'
let target
beforeAll(async()=>{target=await startPmRoleTarget()},120000)
afterAll(async()=>{await target?.stop()})
const options=(f,db=target.runtime)=>({viewer:f.viewer,db})
async function preview(f,plan){const dry=await dryRunPlan(plan,options(f));expect(dry.valid,JSON.stringify(dry.errors)).toBe(true);return {...plan,expectedPreviewHash:dry.previewHash}}
function instrument(db,hooks={}) {return new Proxy(db,{get(object,key){if(key==='$transaction')return async (fn,settings)=>{const [{pid}]=await object.$queryRawUnsafe('SELECT pg_backend_pid() AS pid');hooks.backend?.(pid);return object.$transaction(async tx=>{return fn(new Proxy(tx,{get(t,field){if(field==='auditEvent')return new Proxy(t.auditEvent,{get(d,m){if(m==='create')return async args=>{await hooks.beforeAudit?.();return d.create(args)};return typeof d[m]==='function'?d[m].bind(d):d[m]}});return typeof t[field]==='function'?t[field].bind(t):t[field]}}))},settings)};return typeof object[key]==='function'?object[key].bind(object):object[key]}})}
async function race(first,second) {
 const held=deferred(),release=deferred(),pids=[];let paused=false
 const leader=instrument(target.runtime,{backend:pid=>pids[0]=pid,beforeAudit:async()=>{if(!paused){paused=true;held.resolve();await release.promise}}})
 const follower=instrument(target.otherRuntime,{backend:pid=>pids[1]=pid})
 const one=first(leader);let two
 try{await withinDeadline(held.promise,'C1 leader before audit');two=second(follower);const both=Promise.all([one,two]);await waitForApprovalLock(target.admin,()=>pids)
  const locks=await target.admin.$queryRawUnsafe("SELECT pid,granted FROM pg_locks WHERE (locktype='advisory' OR (locktype='relation' AND relation='public.\"Dependency\"'::regclass)) AND pid IN ($1,$2)",pids[0],pids[1]);expect(locks.some(r=>r.granted)).toBe(true);expect(locks.some(r=>!r.granted)).toBe(true)
  release.resolve();return await both
 }finally{release.resolve();await Promise.allSettled([one,two].filter(Boolean))}
}
describe('C1 real PostgreSQL runtime role',()=>{
 it('applies the issued additive PG migration to an actual pre-column legacy row',async()=>{
  const id=randomUUID(),source=randomUUID(),destination=randomUUID()
  await target.admin.$transaction(async tx=>{
   await tx.$executeRawUnsafe('ALTER TABLE "Dependency" DROP COLUMN "contractJson"')
   await tx.$executeRawUnsafe(`INSERT INTO "Dependency" ("id","sourceType","sourceId","targetType","targetId","dependencyType","createdAt") VALUES ($1,'PROJECT',$2,'PROJECT',$3,'BLOCKS',CURRENT_TIMESTAMP)`,id,source,destination)
   await tx.$executeRawUnsafe(await readFile('supabase/migrations/20261024010000_dependency_handoff.sql','utf8'))
  })
  expect((await target.runtime.dependency.findUnique({where:{id}})).contractJson).toBe(null)
 })

 it('is non-owner non-superuser non-bypass with provider column parity and exact global lock key',async()=>{
  const [row]=await target.runtime.$queryRawUnsafe('SELECT current_user, session_user');expect(row).toEqual({current_user:'zuri_web_login',session_user:'zuri_web_login'})
  const [role]=await target.admin.$queryRawUnsafe("SELECT rolsuper,rolbypassrls FROM pg_roles WHERE rolname='zuri_web_login'");expect(role).toEqual({rolsuper:false,rolbypassrls:false})
  const [column]=await target.runtime.$queryRawUnsafe("SELECT is_nullable,data_type FROM information_schema.columns WHERE table_name='Dependency' AND column_name='contractJson'");expect(column).toEqual({is_nullable:'YES',data_type:'text'})
  expect(PIPELINE_GRAPH_LOCK).toBe('-3484339379872079051')
 })
 it('serializes opposing all-type edges on independent runtime connections with no losing receipt/audit',async()=>{
  const f=await pipelineFixture(target.admin)
  const a=await preview(f,pipelinePlan(f,edgeCommand(f.items[0],f.items[1],'RELATES_TO'))),b=await preview(f,pipelinePlan(f,edgeCommand(f.items[1],f.items[0],'DERIVES_FROM')))
  const results=await race(db=>commitPlan(a,options(f,db)),db=>commitPlan(b,options(f,db)));expect(results.filter(r=>r.committed)).toHaveLength(1);expect(results.find(r=>!r.committed).errors[0].code).toBe('CYCLE')
  expect(await target.runtime.planImportReceipt.count({where:{idempotencyKey:{in:[a.trace.idempotencyKey,b.trace.idempotencyKey]}}})).toBe(1)
  expect(await target.runtime.auditEvent.count({where:{entityId:f.project.id,action:'PLAN_DELTA_COMMITTED'}})).toBe(1)
 })
 it('serializes separate Tenants over preserved legacy bridges, retaining both bridge rows',async()=>{
  const a=await pipelineFixture(target.admin),b=await pipelineFixture(target.admin)
  const bridge=[];for(const [source,targetItem] of [[a.items[1],b.items[0]],[b.items[1],a.items[0]]])bridge.push(await target.admin.dependency.create({data:{sourceType:'WORK_ITEM',sourceId:source.id,targetType:'WORK_ITEM',targetId:targetItem.id,dependencyType:'BLOCKS'}}))
  const one=await preview(a,pipelinePlan(a,edgeCommand(a.items[0],a.items[1]))),two=await preview(b,pipelinePlan(b,edgeCommand(b.items[0],b.items[1])))
  const results=await race(db=>commitPlan(one,options(a,db)),db=>commitPlan(two,options(b,db)));expect(results.filter(r=>r.committed)).toHaveLength(1);expect(results.find(r=>!r.committed).errors[0].code).toBe('CYCLE')
  expect((await target.runtime.dependency.findMany({where:{id:{in:bridge.map(r=>r.id)}}})).map(r=>r.contractJson)).toEqual([null,null])
 })
 it('a Gate update and a handoff commit use the same observed global serializer',async()=>{
  const f=await pipelineFixture(target.admin),gate=await target.admin.gate.create({data:{code:randomUUID(),title:'Acceptance',projectId:f.project.id,workstreamId:f.ws.id,status:'PASSED'}})
  const command={...edgeCommand(f.items[0],f.items[1]),contract:{version:1,deliverable:'Accepted drawing',acceptance:{kind:'GATE',gateId:gate.id}}}
  const plan=await preview(f,pipelinePlan(f,command))
  const result=await race(db=>updateGate(gate.id,{status:'OPEN'},{viewer:f.viewer,db}),db=>commitPlan(plan,options(f,db)))
  expect(result[0].status).toBe('OPEN');expect(result[1].committed).toBe(false);expect(result[1].errors[0].code).toBe('STALE_PREVIEW')
  expect(await target.runtime.planImportReceipt.findUnique({where:{idempotencyKey:plan.trace.idempotencyKey}})).toBe(null)
 })
 it('undo sees a real RLS-protected FeatureWorkLink and refuses before removing its item',async()=>{
  const f=await pipelineFixture(target.admin),plan=pipelinePlan(f,{op:'node.create',type:'WORK_ITEM',clientRef:'created',parent:{type:'WORKSTREAM',id:f.ws.id},fields:{code:'RLS-'+randomUUID().slice(0,8),title:'Linked',subtype:'TASK'}})
  const saved=await commitPlan(await preview(f,plan),options(f));expect(saved.committed).toBe(true)
  const itemId=saved.deltaReceipt.changes.find(row=>row.type==='WORK_ITEM').id
  const feature=await createProjectFeature(f.project.id,{code:randomUUID(),title:'RLS reference',problem:'Undo safety',outcome:'Retained reference',primaryDomainId:'DOM-DEVELOPMENT'},{db:target.runtime,viewer:f.viewer,idempotencyKey:randomUUID()})
  await replaceProjectFeatureWorkLinks(f.project.id,feature.receipt.resourceId,{allocationMode:'COMPLETE_SPLIT',links:[{workItemId:itemId,allocationBps:10000}]},{db:target.runtime,viewer:f.viewer,idempotencyKey:randomUUID(),ifMatch:feature.receipt.etag})
  expect(await target.runtime.featureWorkLink.count()).toBe(0) // no ambient scope is a deny, not absence proof
  const undo=pipelinePlan(f,{op:'undo',originalAuditEventId:saved.auditEventId,expectedAfterHash:saved.deltaReceipt.afterHash})
  const result=await dryRunPlan(undo,options(f));expect(result.valid).toBe(false);expect(result.errors[0].code).toBe('UNDO_CONFLICT');expect((await target.runtime.workItem.findUnique({where:{id:itemId}})).deletedAt).toBe(null)
 })
 it('qualifies every endpoint and edge type through the real runtime-role register',async()=>{
  const a=await pipelineFixture(target.admin),b=await pipelineFixture(target.admin,{tenant:a.tenant,person:a.person}),maps=[]
  for(const f of [a,b]){
   const box=await target.admin.workContainer.create({data:{code:randomUUID(),title:'Sprint',subtype:'SPRINT',workstreamId:f.ws.id}})
   await target.admin.workItem.update({where:{id:f.items[0].id},data:{containerId:box.id}})
   const gate=await target.admin.gate.create({data:{code:randomUUID(),title:'Gate',projectId:f.project.id,workstreamId:f.ws.id}}),milestone=await target.admin.milestone.create({data:{code:randomUUID(),title:'Milestone',projectId:f.project.id,workstreamId:f.ws.id}})
   maps.push({PROJECT:f.project.id,WORKSTREAM:f.ws.id,WORK_CONTAINER:box.id,WORK_ITEM:f.items[0].id,GATE:gate.id,MILESTONE:milestone.id})
  }
  async function apply(command){const {projectId,...base}=pipelinePlan(a,command),plan={...base,kind:'DEPENDENCY_REGISTER',projectIds:[a.project.id,b.project.id].sort()},opts={viewer:b.viewer,db:target.runtime,register:true};const dry=await dryRunPlanDelta(plan,opts);expect(dry.valid,JSON.stringify(dry.errors)).toBe(true);const saved=await commitPlanDelta({...plan,expectedPreviewHash:dry.previewHash},opts);expect(saved.committed,JSON.stringify(saved.errors)).toBe(true);return saved}
  let qualified=0
  for(const type of DEPENDENCY_ENDPOINT_TYPES) for(const relation of DEPENDENCY_TYPES){
   const saved=await apply({op:'dependency.create',clientRef:'edge',source:{type,id:maps[0][type]},target:{type,id:maps[1][type]},dependencyType:relation,contract:{version:1,deliverable:'Runtime qualification',acceptance:{kind:'MANUAL',satisfied:false}}})
   const change=saved.deltaReceipt.changes.find(row=>row.type==='DEPENDENCY');expect((await target.runtime.dependency.findUnique({where:{id:change.id}})).dependencyType).toBe(relation)
   await apply({op:'dependency.remove',id:change.id,expectedDependencyHash:change.afterHash});qualified++
  }
  expect(qualified).toBe(42)
 },120000)
 it('same global key across distinct Tenants refuses a changed actor/payload after full losing rollback',async()=>{
  const a=await pipelineFixture(target.admin),b=await pipelineFixture(target.admin)
  const first=pipelinePlan(a,edgeCommand(a.items[0],a.items[1])),second=pipelinePlan(b,edgeCommand(b.items[0],b.items[1]));second.trace.idempotencyKey=first.trace.idempotencyKey
  const one=await preview(a,first),two=await preview(b,second)
  const result=await race(db=>commitPlan(one,options(a,db)),db=>commitPlan(two,options(b,db)))
  expect(result[0].committed).toBe(true);expect(result[1].committed).toBe(false);expect(result[1].errors[0].code).toBe('IDEMPOTENCY_CONFLICT')
  expect(await target.runtime.dependency.count({where:{sourceId:b.items[0].id,targetId:b.items[1].id}})).toBe(0)
  expect(await target.runtime.auditEvent.count({where:{entityId:b.project.id,action:'PLAN_DELTA_COMMITTED'}})).toBe(0)
 })
 it('same-key identical requests replay exactly once under observed contention',async()=>{
  const f=await pipelineFixture(target.admin),plan=await preview(f,pipelinePlan(f,edgeCommand(f.items[0],f.items[1])))
  const results=await race(db=>commitPlan(plan,options(f,db)),db=>commitPlan(plan,options(f,db)));expect(results.every(r=>r.committed)).toBe(true);expect(results.filter(r=>r.replay)).toHaveLength(1);expect(results[0].auditEventId).toBe(results[1].auditEventId)
 })
})

const execute=promisify(execFile)
async function recoveryCli(script,url,args) {
 const env={...process.env,ZURI_PHASE_B_RECOVERY_DATABASE_URL:url};delete env.DATABASE_URL
 try{const {stdout}=await execute(process.execPath,[`scripts/${script}.mjs`,...args],{cwd:process.cwd(),env,windowsHide:true,timeout:60000,maxBuffer:1024*1024});return JSON.parse(stdout.trim())}
 catch(error){if(error.stdout?.trim().startsWith('{'))return JSON.parse(error.stdout.trim());throw new Error(`C1_RECOVERY_PROCESS_FAILED:${error.code}`)}
}
it('process recovery retains declared/legacy bytes and audit/trace/receipt lineage; rejects corruption and wrong target schema',async()=>{
 const directory=await mkdtemp(path.join(tmpdir(),'pm-c1-recovery-'));const clean=await startPmRoleTarget()
 try{
  const file=path.join(directory,'snapshot.json')
  const exported=await recoveryCli('phase-b-protected-export',target.recoveryUrl,['--output',file]);expect(exported.status,JSON.stringify(exported)).toBe('EXPORTED')
  const bytes=await readFile(file),snapshot=JSON.parse(bytes)
  expect(snapshot.tables.dependency.some(row=>row.contractJson===null)).toBe(true)
  expect(snapshot.tables.dependency.some(row=>row.contractJson!==null)).toBe(true)
  const bad=structuredClone(snapshot);bad.tables.dependency.find(row=>row.contractJson!==null).contractJson='{"version":999}'
  const invalid=Buffer.from(JSON.stringify(bad)),invalidPath=path.join(directory,'invalid.json');await writeFile(invalidPath,invalid)
  expect((await recoveryCli('phase-b-clean-target-restore',clean.recoveryUrl,['--snapshot',invalidPath,'--snapshot-sha256',computeSnapshotSha256(invalid),'--confirm-empty-target','PHASE_B_EMPTY_TARGET'])).status).toBe('REFUSED')
  expect(await clean.admin.dependency.count()).toBe(0)
  const args=['--snapshot',file,'--snapshot-sha256',computeSnapshotSha256(bytes),'--confirm-empty-target','PHASE_B_EMPTY_TARGET']
  await clean.admin.$executeRawUnsafe('ALTER TABLE "Dependency" DROP COLUMN "contractJson"')
  expect(await recoveryCli('phase-b-clean-target-restore',clean.recoveryUrl,args)).toMatchObject({status:'REFUSED',errorCode:'TARGET_SCHEMA_UNVERIFIED'})
  await clean.admin.$executeRawUnsafe(await readFile('supabase/migrations/20261024010000_dependency_handoff.sql','utf8'))
  expect((await recoveryCli('phase-b-clean-target-restore',clean.recoveryUrl,args)).status).toBe('RESTORED')
  for(const delegate of ['dependency','auditEvent','planImportReceipt','projectExecutionRun','projectExecutionStep']){
   const rows=await clean.admin[delegate].findMany(),source=snapshot.tables[delegate]
   const order=rows=>rows.sort((a,b)=>(a.id||a.idempotencyKey).localeCompare(b.id||b.idempotencyKey))
   expect(JSON.parse(JSON.stringify(order(rows)))).toEqual(order(source))
  }
  const receipt=await clean.runtime.planImportReceipt.findFirst({where:{schemaVersion:'1.3'}})
  expect(receipt).not.toBeNull();const event=await clean.runtime.auditEvent.findUnique({where:{id:receipt.auditEventId}});expect(JSON.parse(event.payloadJson).deltaReceipt).toBeDefined()
 }finally{await clean.stop();if(path.dirname(directory)!==tmpdir()||!path.basename(directory).startsWith('pm-c1-recovery-'))throw new Error('OWNED_TEMP_DIRECTORY_REQUIRED');await rm(directory,{recursive:true,force:true})}
},120000)
