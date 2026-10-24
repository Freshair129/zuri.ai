// @req FR-083 — the canvas read/commit contract on a disposable PostgreSQL runtime role.
// @spec ADR-035, ADR-057, SEC-001
import { beforeAll, afterAll, it, expect } from 'vitest'
import { randomUUID } from 'node:crypto'
import { startPmRoleTarget } from '../helpers/pm-role-target'
import { pipelineFixture, handoff } from '../helpers/pipeline-handoff-fixture'
import { getProjectDependencyGraph } from '@/modules/project-manager/application/dependency-service'
import { edgePlan } from '@/modules/project-manager/components/pipeline-edge-interactions'
import { dryRunPlan, commitPlan } from '@/modules/project-manager/import/plan-import-service'
let target
beforeAll(async()=>{target=await startPmRoleTarget()},120000)
afterAll(async()=>{await target?.stop()})
it('reads isolated nodes, commits and rereads manual/Gate state using the real non-owner role',async()=>{
 const f=await pipelineFixture(target.admin),options={viewer:f.viewer,db:target.runtime}
 const roles=await target.runtime.$queryRawUnsafe('SELECT current_user AS name, rolsuper, rolbypassrls FROM pg_roles WHERE rolname=current_user')
 expect(roles[0].rolsuper).toBe(false);expect(roles[0].rolbypassrls).toBe(false)
 const graph=await getProjectDependencyGraph(f.project.id,options)
 expect(graph.nodes.some(node=>node.id==='WORK_ITEM:'+f.items[2].id)).toBe(true)
 const plan=edgePlan({graph,source:'WORK_ITEM:'+f.items[0].id,target:'WORK_ITEM:'+f.items[1].id,dependencyType:'RELATES_TO',contract:handoff()})
 const dry=await dryRunPlan(plan,options);expect(dry.valid,JSON.stringify(dry.errors)).toBe(true)
 const saved=await commitPlan({...plan,expectedPreviewHash:dry.previewHash},options);expect(saved.committed).toBe(true)
 const first=await getProjectDependencyGraph(f.project.id,options);expect(first.edges[0].contractState).toBe('DECLARED')
 const row=await target.admin.dependency.findUnique({where:{id:saved.deltaReceipt.changes[0].id}})
 await target.admin.dependency.update({where:{id:row.id},data:{contractJson:null}})
 expect((await getProjectDependencyGraph(f.project.id,options)).edges[0].contractState).toBe('UNDECLARED')
 await target.admin.dependency.update({where:{id:row.id},data:{contractJson:'{}'}})
 expect((await getProjectDependencyGraph(f.project.id,options)).edges[0].contractState).toBe('INVALID')
 const gate=await target.admin.gate.create({data:{code:randomUUID(),title:'Canvas acceptance',projectId:f.project.id,status:'PASSED'}})
 await target.admin.dependency.update({where:{id:row.id},data:{contractJson:JSON.stringify({version:1,deliverable:'Accepted drawing',acceptance:{kind:'GATE',gateId:gate.id}})}})
 expect((await getProjectDependencyGraph(f.project.id,options)).edges[0].contractState).toBe('SATISFIED')
 expect(first.edges[0]).not.toHaveProperty('contractJson')
})
