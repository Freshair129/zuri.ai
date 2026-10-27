// @req FR-084 — actual SQLite export/restore retains legacy bytes and immutable decision lineage.
// @spec ADR-035, BR-008
import { it, expect, inject } from 'vitest'
import { PrismaClient } from '@prisma/client'
import { existsSync, writeSync } from 'node:fs'
import prisma from '@/lib/db'
import { makeOperatorViewer } from '../factories/viewer'
import { cloneFileTestDatabase, removeFileTestDatabase } from '../helpers/file-test-database'
import { pipelineFixture, pipelinePlan, edgeCommand } from '../helpers/pipeline-handoff-fixture'
import { dryRunPlan,commitPlan } from '@/modules/project-manager/import/plan-import-service'
import { extractSnapshot,importSnapshot } from '@/modules/project-manager/application/backup-service'
it('round-trips into a fresh owned database, refuses corrupt or incomplete snapshots before replacement',async()=>{
 const started=performance.now()
 const trace=stage=>{
  if(!process.env.CI&&process.env.PIPELINE_RECOVERY_TRACE!=='1')return
  // Direct stderr stays observable even if a synchronous fixture operation blocks.
  writeSync(2,'PIPELINE_SQLITE_RECOVERY '+JSON.stringify({stage,elapsedMs:Math.round(performance.now()-started),rss:process.memoryUsage().rss})+'\n')
 }
 const step=async(name,action)=>{trace('begin:'+name);try{const result=await action();trace('end:'+name);return result}catch(error){trace('failed:'+name);throw error}}
 const f=await step('source-fixture',()=>pipelineFixture(prisma)),plan=pipelinePlan(f,edgeCommand(f.items[0],f.items[1],'RELATES_TO')),dry=await step('plan-preview',()=>dryRunPlan(plan,{viewer:f.viewer}))
 const saved=await step('plan-commit',()=>commitPlan({...plan,expectedPreviewHash:dry.previewHash},{viewer:f.viewer}));expect(saved.committed).toBe(true)
 await step('legacy-dependency',()=>prisma.dependency.create({data:{sourceType:'WORK_ITEM',sourceId:f.items[1].id,targetType:'WORK_ITEM',targetId:f.items[2].id,dependencyType:'DERIVES_FROM'}}))
 const snapshot=await step('snapshot-extract',()=>extractSnapshot({db:prisma}))
 trace('snapshot-models:'+Object.keys(snapshot.tables).length)
 // globalSetup already built and closed this run's EMPTY current-schema template.
 // Use its exclusive, ownership-checked clone rather than rerunning the Prisma
 // CLI and auto-committing hundreds of synchronous DDL statements on Windows.
 const targetDatabase=await step('target-template-clone',()=>cloneFileTestDatabase({
  templateUrl:inject('testDatabaseUrl'),runPrefix:inject('testDatabaseRunPrefix'),
  testPath:expect.getState().testPath+'.restore-target',
 }))
 let target
 try {
  target=new PrismaClient({datasources:{db:{url:'file:'+targetDatabase.file.replaceAll('\\','/')}}})
  await step('target-connect',()=>target.$connect())
  await step('empty-target-check',async()=>{
   for(const model of Object.keys(snapshot.tables))expect(await target[model].count(),model).toBe(0)
  })
  const result=await step('snapshot-import',()=>importSnapshot(snapshot,{db:target,viewer:makeOperatorViewer(),confirm:true}));expect(result.restored,JSON.stringify(result.errors)).toBe(true)
  const {before,sourceBefore}=await step('roundtrip-readback',async()=>{
   for(const model of ['dependency','planImportReceipt','projectExecutionRun','projectExecutionStep']) expect(await target[model].findMany({orderBy:model==='planImportReceipt'?{idempotencyKey:'asc'}:{id:'asc'}})).toEqual(await prisma[model].findMany({orderBy:model==='planImportReceipt'?{idempotencyKey:'asc'}:{id:'asc'}}))
   expect(await target.auditEvent.findUnique({where:{id:saved.auditEventId}})).toEqual(await prisma.auditEvent.findUnique({where:{id:saved.auditEventId}}))
   return {before:await target.dependency.findMany({orderBy:{id:'asc'}}),sourceBefore:await prisma.dependency.findMany({orderBy:{id:'asc'}})}
  })
  const corruptions=[s=>{delete s.tables.dependency},s=>{s.tables.dependency.find(row=>row.contractJson!==null).contractJson='null'},s=>{s.tables.dependency.find(row=>row.contractJson!==null).contractJson='{"version":2}'}]
  for(const [index,mutate] of corruptions.entries()) {
   const bad=structuredClone(snapshot);mutate(bad);const refused=await step('invalid-snapshot-refusal-'+index,()=>importSnapshot(bad,{db:target,viewer:makeOperatorViewer(),confirm:true}));expect(refused.restored).toBe(false)
   await step('invalid-snapshot-readback-'+index,async()=>{expect(await target.dependency.findMany({orderBy:{id:'asc'}})).toEqual(before)})
  }
  await step('schema-corruption',()=>target.$executeRawUnsafe('ALTER TABLE Dependency DROP COLUMN contractJson'))
  const wrongSchema=await step('wrong-schema-refusal',()=>importSnapshot(snapshot,{db:target,viewer:makeOperatorViewer(),confirm:true}));expect(wrongSchema).toMatchObject({restored:false,errorCode:'DEPENDENCY_HANDOFF_SCHEMA_UNAVAILABLE'})
  await step('wrong-schema-readback',async()=>{
   expect(await target.dependency.count()).toBe(before.length)
   expect(await prisma.dependency.findMany({orderBy:{id:'asc'}})).toEqual(sourceBefore)
  })
 } finally {
  try{await step('target-disconnect',()=>target?.$disconnect())}
  finally{await step('owned-cleanup',()=>{
   removeFileTestDatabase(targetDatabase.file,targetDatabase.runPrefix)
   for(const suffix of ['','-journal','-wal','-shm'])expect(existsSync(targetDatabase.file+suffix),'owned target cleanup'+suffix).toBe(false)
  })}
 }
},120000)
