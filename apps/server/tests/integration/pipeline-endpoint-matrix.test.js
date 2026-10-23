// @req FR-084 — all six endpoint families and all seven stored edge types use the actual shared writer.
// @spec ADR-035, BR-017
import { beforeAll, it, expect } from 'vitest'
import { randomUUID } from 'node:crypto'
import prisma from '@/lib/db'
import { DEPENDENCY_TYPES, DEPENDENCY_ENDPOINT_TYPES } from '@/lib/validation/enums'
import { dryRunPlanDelta,commitPlanDelta } from '@/modules/project-manager/import/plan-delta-service'
import { pipelineFixture,pipelinePlan,handoff } from '../helpers/pipeline-handoff-fixture'
let a,b,endpointsA,endpointsB
async function endpoints(f) {
 const container=await prisma.workContainer.create({data:{code:randomUUID(),title:'Sprint',subtype:'SPRINT',workstreamId:f.ws.id}})
 await prisma.workItem.update({where:{id:f.items[0].id},data:{containerId:container.id}})
 const gate=await prisma.gate.create({data:{code:randomUUID(),title:'Gate',projectId:f.project.id,workstreamId:f.ws.id}})
 const milestone=await prisma.milestone.create({data:{code:randomUUID(),title:'Milestone',projectId:f.project.id,workstreamId:f.ws.id}})
 return {PROJECT:f.project.id,WORKSTREAM:f.ws.id,WORK_CONTAINER:container.id,WORK_ITEM:f.items[0].id,GATE:gate.id,MILESTONE:milestone.id}
}
beforeAll(async()=>{a=await pipelineFixture(prisma);b=await pipelineFixture(prisma,{tenant:a.tenant,person:a.person});endpointsA=await endpoints(a);endpointsB=await endpoints(b)})
async function apply(command) {
 const {projectId,...base}=pipelinePlan(a,command),plan={...base,kind:'DEPENDENCY_REGISTER',projectIds:[a.project.id,b.project.id].sort()},options={viewer:b.viewer,register:true}
 const dry=await dryRunPlanDelta(plan,options);expect(dry.valid,JSON.stringify(dry.errors)).toBe(true)
 const result=await commitPlanDelta({...plan,expectedPreviewHash:dry.previewHash},options);expect(result.committed,JSON.stringify(result.errors)).toBe(true);return result
}
it.each(DEPENDENCY_ENDPOINT_TYPES.flatMap(type=>DEPENDENCY_TYPES.map(relation=>[type,relation])))('%s / %s persists declared provenance, then removes through the same CAS writer',async(type,relation)=>{
 const saved=await apply({op:'dependency.create',clientRef:'edge',source:{type,id:endpointsA[type]},target:{type,id:endpointsB[type]},dependencyType:relation,contract:handoff()})
 const change=saved.deltaReceipt.changes.find(row=>row.type==='DEPENDENCY'),row=await prisma.dependency.findUnique({where:{id:change.id}})
 expect(row).toMatchObject({sourceType:type,targetType:type,dependencyType:relation});expect(JSON.parse(row.contractJson).acceptance.decisionAuditEventId).toBe(saved.auditEventId)
 await apply({op:'dependency.remove',id:row.id,expectedDependencyHash:change.afterHash})
 expect(await prisma.dependency.findUnique({where:{id:row.id}})).toBe(null)
})

it('refuses an aggregate above the adopted affected-node budget before Cartesian expansion',async()=>{
 const rows=[];for(let i=0;i<1000;i++)for(const f of [a,b])rows.push({code:'BIG-'+randomUUID(),title:'Budget',subtype:'TASK',workstreamId:f.ws.id})
 await prisma.workItem.createMany({data:rows})
 const {projectId,...base}=pipelinePlan(a,{op:'dependency.create',clientRef:'large',source:{type:'PROJECT',id:a.project.id},target:{type:'PROJECT',id:b.project.id},dependencyType:'BLOCKS',contract:handoff()})
 const plan={...base,kind:'DEPENDENCY_REGISTER',projectIds:[a.project.id,b.project.id].sort()},before=await prisma.dependency.count()
 const result=await dryRunPlanDelta(plan,{viewer:b.viewer,register:true});expect(result.valid).toBe(false);expect(result.errors[0].code).toBe('GRAPH_LIMIT');expect(await prisma.dependency.count()).toBe(before)
},30000)
