// @req FR-294 — unsupported legacy recovery must never silently lose design custody.
import {describe,it,expect,vi} from 'vitest'
import {extractSnapshot,previewImport,SNAPSHOT_EXCLUDED_MODELS} from '@/modules/project-manager/application/backup-service'
import {makeOperatorViewer} from '../factories/viewer'
describe('Office design legacy snapshot safety',()=>{
 it('classifies every new model with an explicit refusal boundary',()=>{
  for(const model of ['officeDesignRegistry','officeDesignIdentity','officeDesignRevision','officeDesignBlob','officeDesignImportReceipt'])expect(SNAPSHOT_EXCLUDED_MODELS[model]).toMatch(/refus|refus/i)
 })
 it('refuses export before collecting an incomplete snapshot',async()=>{
  const db={officeDesignRegistry:{count:vi.fn().mockResolvedValue(1)}}
  await expect(extractSnapshot({db})).rejects.toMatchObject({code:'OFFICE_DESIGN_RECOVERY_UNAVAILABLE',status:409})
 })
 it('refuses preview/replacement before any graph deletion',async()=>{
  const db={officeDesignRegistry:{count:vi.fn().mockResolvedValue(1)}}
  await expect(previewImport({schemaVersion:'1.0',tables:{}},{db,viewer:makeOperatorViewer()})).rejects.toMatchObject({code:'OFFICE_DESIGN_RECOVERY_UNAVAILABLE',status:409})
 })
 it('refuses alternate-case incoming Office table names even on an empty target',async()=>{
  const db={officeDesignRegistry:{count:vi.fn().mockResolvedValue(0)}}
  await expect(previewImport({schemaVersion:'1.0',tables:{OfficeDesignRegistry:[{id:'source'}]}},{db,viewer:makeOperatorViewer()})).rejects.toMatchObject({code:'OFFICE_DESIGN_RECOVERY_UNAVAILABLE'})
 })
})
