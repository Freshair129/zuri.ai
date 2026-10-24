// @req FR-084 — bounded activation census: legacy bypasses refuse and shared writers keep their barrier.
// @spec ADR-035
import { it,expect } from 'vitest'
import { readFileSync } from 'node:fs'
const read=path=>readFileSync(path,'utf8')
it('keeps raw historical real-data seeding disabled before client/target initialization',()=>{
 const source=read('scripts/seed_real_work_items.mjs')
 expect(source.indexOf("throw new Error('UPGRADE_REQUIRED")).toBeLessThan(source.indexOf('const url ='))
 expect(read('prisma/seed.js')).toContain('withPipelineSeed(prisma, main)')
})
it('keeps graph/status/metadata-reference writers on the shared barrier',()=>{
 for(const file of ['application/work-service.js','application/project-service.js','application/milestone-gate-service.js','application/progress-service.js','application/backup-service.js','application/project-file-service.js','application/file-asset-service.js','import/plan-import-service.js','import/bundle/bundle-commit-service.js']) expect(read('src/modules/project-manager/'+file),file).toContain('withPipelineTransaction')
 expect(read('src/modules/project-manager/application/project-feature-repository.js')).toContain('lockPipelineGraph(tx, postgres)')
 expect(read('src/modules/asset-management/application/asset-lifecycle-service.js')).toContain('withPipelineTransaction(db, async (tx)')
})
