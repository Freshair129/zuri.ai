// @req FR-084 — raw UTF-8 request body limits precede graph expansion on every new adapter.
// @spec ADR-035, SEC-002
import {it,expect,vi} from 'vitest'
import prisma from '@/lib/db'
import {pipelineFixture,pipelinePlan,edgeCommand} from '../helpers/pipeline-handoff-fixture'
vi.mock('@/modules/identity/request-viewer',()=>({resolveRequestViewer:async request=>request.__viewer}))
const route0=await import('@/app/api/import/dry-run/route')
const route1=await import('@/app/api/import/commit/route')
const route2=await import('@/app/api/dependencies/route')
const route3=await import('@/app/api/dependencies/[id]/route')
const route4=await import('@/app/api/import/bundle/dry-run/route')
const route5=await import('@/app/api/import/bundle/commit/route')
it('refuses oversized whitespace and duplicate-key bodies on all six new transport operations',async()=>{
 const f=await pipelineFixture(prisma),delta=pipelinePlan(f,edgeCommand(f.items[0],f.items[1])),{projectId,...root}=delta,register={...root,kind:'DEPENDENCY_REGISTER',projectIds:[projectId]}
 const bundle={schemaVersion:'1.1',kind:'EXECUTION_PLAN_BUNDLE',scope:{businessCode:f.business.code}}
 const cases=[[route0,'POST',{plan:delta}],[route1,'POST',{plan:{...delta,expectedPreviewHash:'a'.repeat(64)}}],[route2,'POST',{plan:register}],[route3,'DELETE',{plan:{...register,commands:[{op:'dependency.remove',id:f.items[0].id,expectedDependencyHash:'a'.repeat(64)}]}}],[route4,'POST',{bundle}],[route5,'POST',{bundle:{...bundle,expectedPreviewHash:'a'.repeat(64)}}]]
 const before=await Promise.all([prisma.dependency.count(),prisma.auditEvent.count(),prisma.planImportReceipt.count(),prisma.projectExecutionRun.count()])
 for(const [module,method,body] of cases)for(const duplicate of [false,true]) {
  const raw=duplicate?' {"padding":"'+'x'.repeat(1024*1024)+'","padding":"x",'+JSON.stringify(body).slice(1):' '.repeat(1024*1024)+JSON.stringify(body)
  const request=new Request('http://localhost/api/test',{method,headers:{'Content-Type':'application/json'},body:raw});request.__viewer=f.viewer
  const response=await module[method](request,{params:{id:f.items[0].id}})
  expect(response.status).toBe(413);expect((await response.json()).errors[0].code).toBe('PAYLOAD_LIMIT')
 }
 expect(await Promise.all([prisma.dependency.count(),prisma.auditEvent.count(),prisma.planImportReceipt.count(),prisma.projectExecutionRun.count()])).toEqual(before)
})
