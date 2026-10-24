// @req FR-083 — both gestures share strict commands, preview and guarded commit.
// @spec ADR-035, SDD-046, NFR-008
import { describe, expect, it, vi } from 'vitest'
import { edgePlan, submitPipelinePlan, pointerMoved, pipelineMessage, pipelineRequest, createGraphReader } from '@/modules/project-manager/components/pipeline-edge-interactions'
import { zPlanDelta } from '@/modules/project-manager/import/plan-delta-schema'
const projectId='11111111-1111-4111-8111-111111111111'
const first='22222222-2222-4222-8222-222222222222',second='33333333-3333-4333-8333-333333333333'
const graph={projectId,nodes:[{id:'WORK_ITEM:'+first,type:'WORK_ITEM'},{id:'WORK_ITEM:'+second,type:'WORK_ITEM'}]}
const contract={version:1,deliverable:'  Accepted drawing  ',acceptance:{kind:'MANUAL',satisfied:false}}
const input={graph,source:graph.nodes[0].id,target:graph.nodes[1].id,dependencyType:'BLOCKS',contract}
describe('canvas edge intake',()=>{
 it('builds one strict Project delta for drag and Connect to, normalizing the shared contract',()=>{
  const plan=edgePlan(input)
  expect(zPlanDelta.parse(plan).commands).toEqual([{op:'dependency.create',clientRef:'edge',source:{type:'WORK_ITEM',id:first},target:{type:'WORK_ITEM',id:second},dependencyType:'BLOCKS',contract:{...contract,deliverable:'Accepted drawing'}}])
  expect(plan.kind).toBe('PROJECT_DELTA');expect(plan.expectedPreviewHash).toBeNull()
 })
 it('refuses missing/foreign targets and undeclared contracts before any request',()=>{
  expect(()=>edgePlan({...input,target:'WORK_ITEM:foreign'})).toThrow()
  expect(()=>edgePlan({...input,contract:null})).toThrow()
  expect(()=>edgePlan({...input,contract:{...contract,actorPersonId:first}})).toThrow()
 })
 it('leaves self/cycle semantics to the existing server rule',()=>{
  expect(edgePlan({...input,target:input.source}).commands[0].target.id).toBe(first)
 })
 it('distinguishes a drag from a click using an eight pixel threshold',()=>{
  expect(pointerMoved({x:10,y:10},{x:14,y:13})).toBe(false)
  expect(pointerMoved({x:10,y:10},{x:18,y:10})).toBe(true)
 })
 it('does not commit a stale preview after cancellation or a newer gesture',async()=>{
  let resolve,current=true;const request=vi.fn(()=>new Promise(r=>{resolve=r}))
  const pending=submitPipelinePlan(edgePlan(input),{request,isCurrent:()=>current})
  current=false;resolve({valid:true,previewHash:'a'.repeat(64)})
  await expect(pending).resolves.toBeNull();expect(request).toHaveBeenCalledTimes(1)
 })
 it('commits only a valid preview using the same trace and server hash',async()=>{
  const plan=edgePlan(input),receipt={committed:true,auditEventId:first,deltaReceipt:{undoable:true}}
  const request=vi.fn().mockResolvedValueOnce({valid:true,previewHash:'b'.repeat(64)}).mockResolvedValueOnce(receipt)
  const preview=vi.fn();expect(await submitPipelinePlan(plan,{request,isCurrent:()=>true,onPreview:preview})).toEqual(receipt)
  expect(request.mock.calls.map(call=>call[0])).toEqual(['/api/import/dry-run','/api/import/commit'])
  expect(request.mock.calls[1][1]).toEqual({...plan,expectedPreviewHash:'b'.repeat(64)})
  expect(preview).toHaveBeenCalledWith({...plan,expectedPreviewHash:'b'.repeat(64)})
 })
 it('never commits refused previews and retains a safe recoverable reason',async()=>{
  const request=vi.fn().mockResolvedValue({valid:false,errors:[{code:'CYCLE',message:'private path'}]})
  await expect(submitPipelinePlan(edgePlan(input),{request,isCurrent:()=>true})).rejects.toMatchObject({code:'CYCLE'})
  expect(request).toHaveBeenCalledTimes(1)
  expect(pipelineMessage({code:'CYCLE'})).toContain('cycle')
  expect(pipelineMessage({code:'SCOPE_UNAVAILABLE',message:'private'})).not.toContain('private')
 })
 it('retries a lost commit response using the identical idempotent plan, without another preview',async()=>{
  const plan={...edgePlan(input),expectedPreviewHash:'c'.repeat(64)}
  const request=vi.fn().mockResolvedValue({committed:true,replay:true})
  expect((await submitPipelinePlan(plan,{request,isCurrent:()=>true})).replay).toBe(true)
  expect(request).toHaveBeenCalledTimes(1);expect(request).toHaveBeenCalledWith('/api/import/commit',plan)
 })
})

it.each([[503,false],[409,true]])('classifies HTTP %i commit refusal certainty without discarding unknown outcomes',async(status,definitive)=>{
  const original=globalThis.fetch
  globalThis.fetch=async()=>new Response(JSON.stringify({committed:false,errors:[{code:'STALE_PREVIEW'}]}),{status,headers:{'Content-Type':'application/json'}})
  try {await expect(pipelineRequest('/api/import/commit',{})).rejects.toMatchObject({code:'STALE_PREVIEW',definitive})}
  finally {globalThis.fetch=original}
})

it('applies only the newest Project graph response, invalidating reads on scope change/unmount',async()=>{
 const pending=[],updates=[]
 const reader=createGraphReader(value=>updates.push(value),()=>new Promise(resolve=>pending.push(resolve)))
 const older=reader.refresh('one'),newer=reader.refresh('one')
 pending[1](new Response(JSON.stringify({projectId:'one',nodes:['new'],edges:[]})))
 await newer
 pending[0](new Response(JSON.stringify({projectId:'one',nodes:['old'],edges:[]})))
 await older
 expect(updates).toEqual([{projectId:'one',nodes:['new'],edges:[]}])
 const invalidated=reader.refresh('one');reader.invalidate()
 pending[2](new Response(JSON.stringify({projectId:'one',nodes:['obsolete'],edges:[]})))
 await invalidated;expect(updates).toHaveLength(1)
 const foreign=reader.refresh('two')
 pending[3](new Response(JSON.stringify({projectId:'one',nodes:['private'],edges:[]})))
 await expect(foreign).rejects.toThrow();expect(updates).toHaveLength(1)
})
