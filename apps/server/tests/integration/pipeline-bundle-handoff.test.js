// @req FR-084 — Bundle1.1 reuses the full-plan writer and handoff transaction.
// @spec ADR-035, SDD-046, BR-017
import {beforeAll,describe,it,expect} from 'vitest'
import {randomUUID} from 'node:crypto'
import prisma from '@/lib/db'
import {dryRunBundle} from '@/modules/project-manager/import/bundle/bundle-dry-run'
import {commitBundle} from '@/modules/project-manager/import/bundle/bundle-commit-service'
import {pipelineFixture,handoff} from '../helpers/pipeline-handoff-fixture'
let f
beforeAll(async()=>{f=await pipelineFixture(prisma)})
function bundle(){const suffix=randomUUID().slice(0,8);return {kind:'EXECUTION_PLAN_BUNDLE',schemaVersion:'1.1',manifest:{code:'PKG-'+suffix,title:'C1 bundle'},scope:{businessCode:f.business.code,defaultWorkspaceCode:f.workspace.code},projects:['A','B'].map(ref=>({bundleProjectRef:ref,plan:{schemaVersion:'1.0',scope:{workspaceCode:f.workspace.code},project:{code:'P-'+ref+'-'+suffix,name:'Project '+ref},workstreams:[]}})),dependencies:[{sourceProjectRef:'A',targetProjectRef:'B',relation:'BLOCKS',contract:handoff()}],trace:{correlationId:randomUUID(),idempotencyKey:randomUUID()},expectedPreviewHash:null}}
describe('Bundle1.1',()=>{
 it('previews without mutations then deterministically commits two Projects and one declared edge under the existing receipt',async()=>{
  const input=bundle(),before={p:await prisma.project.count(),d:await prisma.dependency.count(),a:await prisma.auditEvent.count()};const dry=await dryRunBundle(input,{viewer:f.viewer});expect(dry.valid,JSON.stringify(dry.errors)).toBe(true);expect(dry.previewHash).toMatch(/^[0-9a-f]{64}$/);expect(await prisma.project.count()).toBe(before.p);expect(await prisma.dependency.count()).toBe(before.d);expect(await prisma.auditEvent.count()).toBe(before.a)
  const saved=await commitBundle({...input,expectedPreviewHash:dry.previewHash},{viewer:f.viewer});expect(saved.committed,JSON.stringify(saved.errors)).toBe(true);expect(saved.receipt.handoffReceipt.changes).toHaveLength(3);expect(saved.receipt.dependencies[0].contractState).toBe('DECLARED')
  const receipt=await prisma.planImportReceipt.findUnique({where:{idempotencyKey:input.trace.idempotencyKey}});expect(receipt.stepKey).toBe('bundle.import.commit');expect(receipt.schemaVersion).toBe('1.1')
  const edge=await prisma.dependency.findUnique({where:{id:saved.receipt.dependencies[0].id}});expect(JSON.parse(edge.contractJson).acceptance.decisionAuditEventId).toBe(receipt.auditEventId)
  const replay=await commitBundle({...input,expectedPreviewHash:dry.previewHash},{viewer:f.viewer});expect(replay.replay).toBe(true);expect(replay.receipt).toEqual(saved.receipt)
 })
 it('rejects a legacy new bare edge before creating any Project',async()=>{const input=bundle();input.schemaVersion='1.0';delete input.expectedPreviewHash;delete input.dependencies[0].contract;const count=await prisma.project.count();const result=await commitBundle(input,{viewer:f.viewer});expect(result.committed).toBe(false);expect(result.errors.some(e=>String(e).includes('CONTRACT_REQUIRED'))).toBe(true);expect(await prisma.project.count()).toBe(count)})
 it('binds new code absence and stale undo/read sets without partial audit',async()=>{const input=bundle(),dry=await dryRunBundle(input,{viewer:f.viewer});expect(dry.valid).toBe(true);await prisma.project.create({data:{code:input.projects[0].plan.project.code,name:'Competing claim',workspaceId:f.workspace.id,businessId:f.business.id}});const result=await commitBundle({...input,expectedPreviewHash:dry.previewHash},{viewer:f.viewer});expect(result.committed).toBe(false);expect(result.errors[0].code).toBe('STALE_PREVIEW');expect(await prisma.planImportReceipt.findUnique({where:{idempotencyKey:input.trace.idempotencyKey}})).toBe(null)})
 it('allocates every graph-visible nested family and checks initially protected Bundle items',async()=>{
  const input=bundle()
  for(const entry of input.projects){const p=entry.plan.project.code;entry.plan.workstreams=[{code:p+'-WS',name:'Delivery',executionMode:'SOFTWARE_SPRINT',progressStrategy:'TASK_WEIGHT',containers:[{code:p+'-BOX',title:'Sprint',subtype:'SPRINT'}],items:[{code:p+'-ITEM',title:'Work',subtype:'TASK',containerCode:p+'-BOX'}],milestones:[{code:p+'-MS',title:'Milestone'}],gates:[{code:p+'-GATE',title:'Gate',required:false}]}]}
  const blocked=structuredClone(input);blocked.projects[1].plan.workstreams[0].items[0].status='IN_PROGRESS'
  const refusal=await dryRunBundle(blocked,{viewer:f.viewer});expect(refusal.valid).toBe(false);expect(refusal.errors[0].code).toBe('RELEASE_HELD')
  const dry=await dryRunBundle(input,{viewer:f.viewer});expect(dry.valid,JSON.stringify(dry.errors)).toBe(true)
  const result=await commitBundle({...input,expectedPreviewHash:dry.previewHash},{viewer:f.viewer});expect(result.committed,JSON.stringify(result.errors)).toBe(true);expect(result.receipt.handoffReceipt.changes).toHaveLength(13)
  const repeated=structuredClone(input);repeated.trace={correlationId:randomUUID(),idempotencyKey:randomUUID()}
  const old=await prisma.dependency.findUnique({where:{id:result.receipt.dependencies[0].id}}),preview=await dryRunBundle(repeated,{viewer:f.viewer});expect(preview.valid,JSON.stringify(preview.errors)).toBe(true)
  const accepted=await commitBundle({...repeated,expectedPreviewHash:preview.previewHash},{viewer:f.viewer});expect(accepted.committed,JSON.stringify(accepted.errors)).toBe(true);expect(accepted.receipt.dependencies[0]).toMatchObject({existed:true,contractState:'DECLARED'});expect((await prisma.dependency.findUnique({where:{id:old.id}})).contractJson).toBe(old.contractJson)
  const changed=structuredClone(repeated);changed.trace={correlationId:randomUUID(),idempotencyKey:randomUUID()};changed.dependencies[0].contract.deliverable='Different'
  expect((await dryRunBundle(changed,{viewer:f.viewer})).errors[0].code).toBe('CONTRACT_CONFLICT')
 })
 it('preserves a NULL root edge and reports preserved legacy in preview and actual receipt',async()=>{
  const input=bundle(),other=await prisma.project.create({data:{code:randomUUID(),name:'Existing B',workspaceId:f.workspace.id,businessId:f.business.id}})
  input.projects[0].plan.project.code=f.project.code;input.projects[1].plan.project.code=other.code
  const row=await prisma.dependency.create({data:{sourceType:'PROJECT',sourceId:f.project.id,targetType:'PROJECT',targetId:other.id,dependencyType:'BLOCKS'}})
  const dry=await dryRunBundle(input,{viewer:f.viewer});expect(dry.valid,JSON.stringify(dry.errors)).toBe(true);expect(dry.preview.dependencies[0].description).toContain('UNDECLARED')
  const result=await commitBundle({...input,expectedPreviewHash:dry.previewHash},{viewer:f.viewer});expect(result.committed,JSON.stringify(result.errors)).toBe(true);expect(result.receipt.dependencies[0]).toMatchObject({id:row.id,existed:true,contractState:'UNDECLARED'});expect((await prisma.dependency.findUnique({where:{id:row.id}})).contractJson).toBe(null)
 })
 it('uses external-reference identity before payload codes without changing existing IDs/codes',async()=>{
  const input=bundle(),alias='ALIAS-'+randomUUID().slice(0,8)
  await prisma.externalRef.create({data:{entityType:'PROJECT',entityId:f.project.id,system:'C1',value:alias}})
  input.projects[0].plan.project={...input.projects[0].plan.project,code:alias,externalRefs:[{system:'C1',id:alias}]}
  const dry=await dryRunBundle(input,{viewer:f.viewer});expect(dry.valid,JSON.stringify(dry.errors)).toBe(true)
  const result=await commitBundle({...input,expectedPreviewHash:dry.previewHash},{viewer:f.viewer});expect(result.committed,JSON.stringify(result.errors)).toBe(true);expect(result.receipt.projects[0].projectId).toBe(f.project.id);expect((await prisma.project.findUnique({where:{id:f.project.id}})).code).toBe(f.project.code)
 })

})
