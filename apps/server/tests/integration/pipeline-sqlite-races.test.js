// @req FR-084 — two actual SQLite connections serialize opposing writes and key replay.
// @spec ADR-035, BR-009
import { it,expect } from 'vitest'
import { PrismaClient } from '@prisma/client'
import path from 'node:path'
import prisma from '@/lib/db'
import { pipelineFixture,pipelinePlan,edgeCommand } from '../helpers/pipeline-handoff-fixture'
import { dryRunPlan,commitPlan } from '@/modules/project-manager/import/plan-import-service'
it('leaves no opposing cycle or losing receipt after actual single-writer contention',async()=>{
 const databases=await prisma.$queryRawUnsafe('PRAGMA database_list'),file=databases.find(row=>row.name==='main').file
 expect(path.basename(path.dirname(file))).toBe('.test-dbs')
 const other=new PrismaClient({datasources:{db:{url:'file:'+file.replaceAll('\\','/')}}})
 try {
  const f=await pipelineFixture(prisma),a=pipelinePlan(f,edgeCommand(f.items[0],f.items[1],'RELATES_TO')),b=pipelinePlan(f,edgeCommand(f.items[1],f.items[0],'DERIVES_FROM'))
  const da=await dryRunPlan(a,{viewer:f.viewer}),db=await dryRunPlan(b,{viewer:f.viewer});expect(da.valid&&db.valid).toBe(true)
  const results=await Promise.all([commitPlan({...a,expectedPreviewHash:da.previewHash},{viewer:f.viewer}),commitPlan({...b,expectedPreviewHash:db.previewHash},{viewer:f.viewer,db:other})])
  expect(results.filter(result=>result.committed)).toHaveLength(1);expect(['CYCLE','GRAPH_BUSY','STALE_PREVIEW']).toContain(results.find(result=>!result.committed).errors[0].code)
  expect(await prisma.planImportReceipt.count({where:{idempotencyKey:{in:[a.trace.idempotencyKey,b.trace.idempotencyKey]}}})).toBe(1)
  expect(await prisma.auditEvent.count({where:{entityId:f.project.id,action:'PLAN_DELTA_COMMITTED'}})).toBe(1)
  const accepted=results[0].committed?{...a,expectedPreviewHash:da.previewHash}:{...b,expectedPreviewHash:db.previewHash}
  const retry=await commitPlan(accepted,{viewer:f.viewer,db:other});expect(retry.replay).toBe(true);expect(retry.auditEventId).toBe(results.find(result=>result.committed).auditEventId)
 } finally { await other.$disconnect() }
},30000)
