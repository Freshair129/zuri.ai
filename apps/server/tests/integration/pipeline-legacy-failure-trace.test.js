// @req FR-069, FR-070 — root failure evidence survives business rollback; nested Bundle traces remain atomic.
// @spec ADR-102, ADR-035, SEC-003
import {it,expect} from 'vitest'
import {randomUUID} from 'node:crypto'
import prisma from '@/lib/db'
import {commitPlan} from '@/modules/project-manager/import/plan-import-service'
import {dryRunBundle} from '@/modules/project-manager/import/bundle/bundle-dry-run'
import {commitBundle} from '@/modules/project-manager/import/bundle/bundle-commit-service'
import {pipelineFixture} from '../helpers/pipeline-handoff-fixture'
it('records a root failed trace after rollback and never a nested failed trace',async()=>{
 const f=await pipelineFixture(prisma),suffix=randomUUID().replaceAll('-',''),code='FAIL-'+suffix,trigger='c1_failure_'+suffix
 const makePlan=()=>({schemaVersion:'1.2',scope:{workspaceCode:f.workspace.code},project:{code:f.project.code,name:f.project.name},trace:{correlationId:randomUUID(),idempotencyKey:randomUUID()},domainBinding:{primaryDomainId:'DOM-DEVELOPMENT',supportingDomainIds:[],technicalOwnerDomainId:'TD-PROJECT-MANAGER'},identityRefs:{},workstreams:[{code:f.ws.code,name:f.ws.name,executionMode:'SOFTWARE_SPRINT',executionModeId:'EXM-SOFTWARE-SPRINT',executionContractId:'EXC-SOFTWARE-SPRINT-V1',contractVersion:'1.0.0',progressStrategy:'TASK_WEIGHT',items:[{code,title:'Refused by isolated trigger',subtype:'TASK'}]}]})
 await prisma.$executeRawUnsafe(`CREATE TRIGGER "${trigger}" BEFORE INSERT ON "WorkItem" WHEN NEW."code"='${code}' BEGIN SELECT RAISE(ABORT,'C1 isolated transactional failure'); END`)
 try {
  const plan=makePlan();await expect(commitPlan(plan,{viewer:f.viewer})).rejects.toThrow()
  const run=await prisma.projectExecutionRun.findFirst({where:{correlationId:plan.trace.correlationId}})
  expect(run?.status).toBe('FAILED');expect(run?.failureCode).toBe('PM_EXECUTION_TRANSACTION_FAILED');expect(run?.auditEventId).toBeTruthy()
  expect(await prisma.planImportReceipt.findUnique({where:{idempotencyKey:plan.trace.idempotencyKey}})).toBe(null)
  expect(await prisma.workItem.findUnique({where:{code}})).toBe(null)
  const nested=makePlan(),input={kind:'EXECUTION_PLAN_BUNDLE',schemaVersion:'1.1',manifest:{code:'B-'+suffix,title:'Atomic failure'},scope:{businessCode:f.business.code,defaultWorkspaceCode:f.workspace.code},projects:[{bundleProjectRef:'A',plan:nested}],dependencies:[],trace:{correlationId:randomUUID(),idempotencyKey:randomUUID()},expectedPreviewHash:null}
  const dry=await dryRunBundle(input,{viewer:f.viewer});expect(dry.valid,JSON.stringify(dry.errors)).toBe(true)
  expect((await commitBundle({...input,expectedPreviewHash:dry.previewHash},{viewer:f.viewer})).committed).toBe(false)
  expect(await prisma.projectExecutionRun.count({where:{correlationId:{in:[input.trace.correlationId,nested.trace.correlationId]}}})).toBe(0)
  expect(await prisma.workItem.findUnique({where:{code}})).toBe(null)
  const legacyNested=makePlan(),legacy={...input,schemaVersion:'1.0',projects:[{bundleProjectRef:'A',plan:legacyNested}],trace:{correlationId:randomUUID(),idempotencyKey:randomUUID()}}
  delete legacy.expectedPreviewHash
  await expect(commitBundle(legacy,{viewer:f.viewer})).rejects.toThrow()
  expect((await prisma.projectExecutionRun.findFirst({where:{correlationId:legacy.trace.correlationId}}))?.status).toBe('FAILED')
  expect(await prisma.projectExecutionRun.count({where:{correlationId:legacyNested.trace.correlationId}})).toBe(0)
 } finally {await prisma.$executeRawUnsafe(`DROP TRIGGER "${trigger}"`)}
})
