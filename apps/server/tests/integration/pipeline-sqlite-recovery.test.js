// @req FR-084 — actual SQLite export/restore retains legacy bytes and immutable decision lineage.
// @spec ADR-035, BR-008
import { it, expect } from 'vitest'
import { PrismaClient } from '@prisma/client'
import { mkdtemp, rm } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import os from 'node:os'
import path from 'node:path'
import prisma from '@/lib/db'
import { makeOperatorViewer } from '../factories/viewer'
import { pipelineFixture, pipelinePlan, edgeCommand } from '../helpers/pipeline-handoff-fixture'
import { dryRunPlan,commitPlan } from '@/modules/project-manager/import/plan-import-service'
import { extractSnapshot,importSnapshot } from '@/modules/project-manager/application/backup-service'
const require=createRequire(import.meta.url)
const {DatabaseSync}=require('node:sqlite')
it('round-trips into a fresh owned database, refuses corrupt or incomplete snapshots before replacement',async()=>{
 const f=await pipelineFixture(prisma),plan=pipelinePlan(f,edgeCommand(f.items[0],f.items[1],'RELATES_TO')),dry=await dryRunPlan(plan,{viewer:f.viewer})
 const saved=await commitPlan({...plan,expectedPreviewHash:dry.previewHash},{viewer:f.viewer});expect(saved.committed).toBe(true)
 await prisma.dependency.create({data:{sourceType:'WORK_ITEM',sourceId:f.items[1].id,targetType:'WORK_ITEM',targetId:f.items[2].id,dependencyType:'DERIVES_FROM'}})
 const snapshot=await extractSnapshot({db:prisma}),directory=await mkdtemp(path.join(os.tmpdir(),'zuri-c1-sqlite-')),file=path.join(directory,'target.db')
 let target
 try {
  const ddl=execFileSync(process.execPath,[require.resolve('prisma/build/index.js'),'migrate','diff','--from-empty','--to-schema-datamodel','prisma/schema.prisma','--script'],{cwd:process.cwd(),encoding:'utf8',maxBuffer:8*1024*1024})
  const sqlite=new DatabaseSync(file);try{sqlite.exec(ddl)}finally{sqlite.close()}
  target=new PrismaClient({datasources:{db:{url:'file:'+file.replaceAll('\\','/')}}})
  const result=await importSnapshot(snapshot,{db:target,viewer:makeOperatorViewer(),confirm:true});expect(result.restored,JSON.stringify(result.errors)).toBe(true)
  for(const model of ['dependency','planImportReceipt','projectExecutionRun','projectExecutionStep']) expect(await target[model].findMany({orderBy:model==='planImportReceipt'?{idempotencyKey:'asc'}:{id:'asc'}})).toEqual(await prisma[model].findMany({orderBy:model==='planImportReceipt'?{idempotencyKey:'asc'}:{id:'asc'}}))
  expect(await target.auditEvent.findUnique({where:{id:saved.auditEventId}})).toEqual(await prisma.auditEvent.findUnique({where:{id:saved.auditEventId}}))
  const before=await target.dependency.findMany({orderBy:{id:'asc'}})
  for(const mutate of [s=>{delete s.tables.dependency},s=>{s.tables.dependency.find(row=>row.contractJson!==null).contractJson='null'},s=>{s.tables.dependency.find(row=>row.contractJson!==null).contractJson='{"version":2}'}]) {
   const bad=structuredClone(snapshot);mutate(bad);const refused=await importSnapshot(bad,{db:target,viewer:makeOperatorViewer(),confirm:true});expect(refused.restored).toBe(false);expect(await target.dependency.findMany({orderBy:{id:'asc'}})).toEqual(before)
  }
  await target.$executeRawUnsafe('ALTER TABLE Dependency DROP COLUMN contractJson')
  const wrongSchema=await importSnapshot(snapshot,{db:target,viewer:makeOperatorViewer(),confirm:true});expect(wrongSchema).toMatchObject({restored:false,errorCode:'DEPENDENCY_HANDOFF_SCHEMA_UNAVAILABLE'});expect(await target.dependency.count()).toBe(before.length)
 } finally {
  await target?.$disconnect()
  if(path.dirname(path.resolve(directory))!==path.resolve(os.tmpdir())||!path.basename(directory).startsWith('zuri-c1-sqlite-'))throw new Error('OWNED_TEMP_BOUNDARY_REQUIRED')
  await rm(directory,{recursive:true,force:true})
 }
},120000)
