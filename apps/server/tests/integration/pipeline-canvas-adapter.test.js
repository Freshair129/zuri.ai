// @req FR-083 — Project graph and import adapters share scoped contract semantics.
// @spec ADR-035, SEC-001, SDD-046
import { describe, it, expect } from 'vitest'
import { randomUUID } from 'node:crypto'
import prisma from '@/lib/db'
import { getProjectDependencyGraph } from '@/modules/project-manager/application/dependency-service'
import { dryRunPlan, commitPlan } from '@/modules/project-manager/import/plan-import-service'
import { edgePlan } from '@/modules/project-manager/components/pipeline-edge-interactions'
import { pipelineFixture, handoff } from '../helpers/pipeline-handoff-fixture'
describe('C2 Project canvas adapter',()=>{
 it('shows isolated in-scope nodes, commits the gesture command and projects only safe state',async()=>{
  const f=await pipelineFixture(prisma),other=await pipelineFixture(prisma),opts={viewer:f.viewer}
  const graph=await getProjectDependencyGraph(f.project.id,opts)
  expect(graph.nodes.map(n=>n.id)).toContain('WORK_ITEM:'+f.items[0].id)
  expect(graph.nodes.map(n=>n.id)).not.toContain('WORK_ITEM:'+other.items[0].id)
  const input={graph,source:'WORK_ITEM:'+f.items[0].id,target:'WORK_ITEM:'+f.items[1].id,dependencyType:'BLOCKS',contract:handoff()}
  const plan=edgePlan(input),before=await prisma.auditEvent.count()
  const dry=await dryRunPlan(plan,opts);expect(dry.valid,JSON.stringify(dry.errors)).toBe(true)
  expect(await prisma.auditEvent.count()).toBe(before)
  const saved=await commitPlan({...plan,expectedPreviewHash:dry.previewHash},opts)
  expect(saved.committed).toBe(true)
  const view=await getProjectDependencyGraph(f.project.id,opts)
  expect(view.edges[0].contractState).toBe('DECLARED')
  expect(view.edges[0]).not.toHaveProperty('contractJson')
  expect(JSON.stringify(view)).not.toContain('actorPersonId')
  const reverse=edgePlan({...input,source:input.target,target:input.source})
  expect((await dryRunPlan(reverse,opts)).errors[0].code).toBe('CYCLE')
  const self=edgePlan({...input,target:input.source})
  expect((await dryRunPlan(self,opts)).valid).toBe(false)
  const foreign={...plan,trace:{correlationId:randomUUID(),idempotencyKey:randomUUID()},commands:[{...plan.commands[0],target:{type:'WORK_ITEM',id:other.items[0].id}}]}
  const denied=await dryRunPlan(foreign,opts);expect(denied.valid).toBe(false);expect(denied.errors[0].code).toBe('SCOPE_UNAVAILABLE')
  await expect(getProjectDependencyGraph(f.project.id,{viewer:other.viewer})).rejects.toThrow()
  await prisma.workItem.update({where:{id:f.items[2].id},data:{deletedAt:new Date()}})
  expect((await getProjectDependencyGraph(f.project.id,opts)).nodes.some(n=>n.id==='WORK_ITEM:'+f.items[2].id)).toBe(false)
 })
})
