// @req FR-084 — real persisted Identity/scope fixtures, no fabricated grants.
import { randomUUID } from 'node:crypto'
import { resolveViewer } from '@/modules/identity/resolve-viewer'
import { makeViewer } from '../factories/viewer'
export async function pipelineFixture(db, {tenant: suppliedTenant,person: suppliedPerson}={}) {
 const key=()=>randomUUID(), identity=()=>({code:key(),name:'C1 isolated'})
 const portfolio=suppliedTenant?null:await db.portfolio.create({data:identity()})
 const tenant=suppliedTenant||await db.tenant.create({data:{...identity(),portfolioId:portfolio.id}})
 const business=await db.business.create({data:{...identity(),tenantId:tenant.id}})
 const workspace=await db.workspace.create({data:{...identity(),scopeType:'BUSINESS',businessId:business.id,tenantId:tenant.id}})
 const project=await db.project.create({data:{...identity(),workspaceId:workspace.id,businessId:business.id}})
 const person=suppliedPerson||await db.person.create({data:{code:key(),displayName:'C1 Owner'}})
 const membership=await db.membership.create({data:{personId:person.id,tenantId:tenant.id,businessId:business.id,role:'OWNER'}})
 const viewer=makeViewer(await resolveViewer({principalId:person.id,db}))
 const ws=await db.workstream.create({data:{...identity(),projectId:project.id,executionMode:'SOFTWARE_SPRINT',progressStrategy:'TASK_WEIGHT'}})
 const items=[];for(let i=0;i<3;i++)items.push(await db.workItem.create({data:{code:key(),title:'Drawing '+i,subtype:'TASK',workstreamId:ws.id}}))
 return {portfolio,tenant,business,workspace,project,person,membership,viewer,ws,items}
}
export const handoff=()=>({version:1,deliverable:'Signed drawing',acceptance:{kind:'MANUAL',satisfied:false}})
export const edgeCommand=(a,b,type='BLOCKS')=>({op:'dependency.create',clientRef:'edge',source:{type:'WORK_ITEM',id:a.id},target:{type:'WORK_ITEM',id:b.id},dependencyType:type,contract:handoff()})
export const pipelinePlan=(fixture,commands)=>({schemaVersion:'1.3',kind:'PROJECT_DELTA',projectId:fixture.project.id,trace:{correlationId:randomUUID(),idempotencyKey:randomUUID()},expectedPreviewHash:null,commands:Array.isArray(commands)?commands:[commands]})
