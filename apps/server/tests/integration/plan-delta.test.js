// @req FR-084 — shared intake delta persistence, idempotency and transaction rollback.
// @spec ADR-035, SDD-046, SEC-001
import { beforeAll, describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import prisma from '@/lib/db'
import { dryRunPlan, commitPlan } from '@/modules/project-manager/import/plan-import-service'
import { resolveViewer } from '@/modules/identity/resolve-viewer'
import { makeViewer } from '../factories/viewer'
let a, viewer
const key=()=>randomUUID()
const contract=()=>({version:1,deliverable:'Drawing',acceptance:{kind:'MANUAL',satisfied:false}})
const envelope=command=>({schemaVersion:'1.3',kind:'PROJECT_DELTA',projectId:a.project.id,trace:{correlationId:key(),idempotencyKey:key()},expectedPreviewHash:null,commands:[command]})
const edge=()=>({op:'dependency.create',clientRef:'edge',source:{type:'WORK_ITEM',id:a.items[0].id},target:{type:'WORK_ITEM',id:a.items[1].id},dependencyType:'BLOCKS',contract:contract()})
const opts=()=>({viewer,workspaceId:a.workspace.id})
beforeAll(async()=>{
 const portfolio=await prisma.portfolio.create({data:{code:key(),name:'C1 isolated'}})
 const tenant=await prisma.tenant.create({data:{code:key(),name:'C1',portfolioId:portfolio.id}})
 const business=await prisma.business.create({data:{code:key(),name:'C1',tenantId:tenant.id}})
 const workspace=await prisma.workspace.create({data:{code:key(),name:'C1',scopeType:'BUSINESS',businessId:business.id,tenantId:tenant.id}})
 const project=await prisma.project.create({data:{code:key(),name:'C1',workspaceId:workspace.id,businessId:business.id}})
 const person=await prisma.person.create({data:{code:key(),displayName:'C1 Owner'}})
 await prisma.membership.create({data:{personId:person.id,tenantId:tenant.id,businessId:business.id,role:'OWNER'}})
 viewer=makeViewer(await resolveViewer({principalId:person.id}))
 const ws=await prisma.workstream.create({data:{code:key(),name:'C1',projectId:project.id,executionMode:'SOFTWARE_SPRINT',progressStrategy:'TASK_WEIGHT'}})
 const items=[];for(let i=0;i<3;i++)items.push(await prisma.workItem.create({data:{code:key(),title:'Drawing '+i,subtype:'TASK',workstreamId:ws.id}}))
 a={portfolio,tenant,business,workspace,project,person,ws,items}
})
describe('adopted shared delta lane',()=>{
 it('previews read-only, commits provenance+receipt atomically and replays before stale-preview checks',async()=>{
  const plan=envelope(edge());const before=await prisma.auditEvent.count();const dry=await dryRunPlan(plan,opts());expect(dry.valid).toBe(true);expect(await prisma.auditEvent.count()).toBe(before)
  const commit={...plan,expectedPreviewHash:dry.previewHash};const one=await commitPlan(commit,opts());expect(one.committed).toBe(true)
  const row=await prisma.dependency.findUnique({where:{id:one.deltaReceipt.changes[0].id}});expect(JSON.parse(row.contractJson).acceptance).toMatchObject({actorPersonId:a.person.id,decisionAuditEventId:one.auditEventId})
  const two=await commitPlan(commit,opts());expect(two.replay).toBe(true);expect(two.auditEventId).toBe(one.auditEventId)
  const changed=await commitPlan({...commit,commands:[{...edge(),contract:{...contract(),deliverable:'Changed'}}]},opts());expect(changed.errors[0].code).toBe('IDEMPOTENCY_CONFLICT')
 })
 it('refuses missing contracts, forward refs and client provenance',async()=>{
  for(const command of [({...edge(),contract:undefined}),({...edge(),source:{type:'WORK_ITEM',ref:'future'}}),({...edge(),contract:{...contract(),actorPersonId:key()}})]){
   const result=await dryRunPlan(envelope(command),opts());expect(result.valid).toBe(false)
  }
 })
 it('checks commit scope from current memberships instead of trusting a stale viewer',async()=>{
  const c={...edge(),target:{type:'WORK_ITEM',id:a.items[2].id}};const plan=envelope(c),dry=await dryRunPlan(plan,opts());expect(dry.valid).toBe(true)
  await prisma.membership.updateMany({where:{personId:a.person.id},data:{status:'REVOKED'}})
  try{const result=await commitPlan({...plan,expectedPreviewHash:dry.previewHash},opts());expect(result.committed).toBe(false);expect(result.errors[0].code).toBe('SCOPE_UNAVAILABLE')}
  finally{await prisma.membership.updateMany({where:{personId:a.person.id},data:{status:'ACTIVE'}})}
 })
})
