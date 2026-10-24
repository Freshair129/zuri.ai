import { describe,it,expect,vi } from 'vitest'
import { createServerLineAnswer } from '@/modules/agent/server-line-answer'
import { NO_EVIDENCE_REPLY } from '@/modules/agent/line-answer-policy'
// @req FR-079, FR-049, FR-235 — new public mode bypasses generic corpus/memory answer composition.
// @tested tests/unit/line-customer-product-answer.test.js
const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`
function fixture(facts=[{id:'f1',field:'nameTh',label:'ชื่อสินค้า',value:'แก้วจริง'}]) {
  const env={ZURI_MAIN_DEV_LOCAL_OLLAMA_ENABLED:'true',ZURI_PHASE1_RUNTIME_SOURCE:'MAIN_DEV_LOCAL_OLLAMA',
    ZURI_MAIN_DEV_LOCAL_OLLAMA_EXPECTED_DATABASE:'dev',ZURI_MAIN_DEV_LOCAL_OLLAMA_BASE_URL:'http://host.docker.internal:11434',
    ZURI_MAIN_DEV_LOCAL_OLLAMA_ALLOWED_TENANT_IDS:JSON.stringify([id(1)]),ZURI_MAIN_DEV_LOCAL_OLLAMA_ALLOWED_BUSINESS_IDS:JSON.stringify([id(2)]),
    ZURI_MAIN_DEV_LOCAL_OLLAMA_ALLOWED_LINE_OA_ACCOUNT_IDS:JSON.stringify([id(3)]),ZURI_MAIN_DEV_LOCAL_OLLAMA_KNOWLEDGE_SOURCE:'GENESISRAG17_CUSTOMER_PRODUCTS'}
  const job={id:id(7),executionId:id(8),tenantId:id(1),businessId:id(2),accountId:id(3),executionMode:'SERVER',runtimeOwner:'SERVER',
    inbound:{body:'ขอชื่อสินค้า CUP-A'},account:{id:id(3),tenantId:id(1),businessId:id(2),executionMode:'SERVER',runtimeOwner:'SERVER',
      serverEnabled:true,knowledgeGrounding:'GKS_CORPUS',memoryPolicy:'OFF',memoryProjectId:null}}
  const model={generate:vi.fn(async()=>({provider:'ollama',status:'ok',text:'{"factIds":["f1"]}'}))}
  const genericQuery=vi.fn(async()=>{throw new Error('must not read unrestricted knowledge')})
  const runtimeFactory=vi.fn(async()=>({businessKnowledge:{query:genericQuery},resolveModel:async()=>model}))
  const binding={schema:'zuri.line-customer-products.binding.v1',denied:!facts.length}
  const reader={query:vi.fn(async()=>({facts,binding,retrievalRefs:[],meta:{reason:facts.length?null:'NO_EVIDENCE'}})),
    revalidate:vi.fn(async()=>binding),getBinding:()=>binding}
  const customerProductReaderFactory=vi.fn(()=>reader),customerProductDecisionWriter=vi.fn(async()=>{})
  const trace={recordEvidence:vi.fn(async()=>{}),assertHealthy:vi.fn()}
  const answer=createServerLineAnswer({env,runtimeFactory,customerProductReaderFactory,customerProductDecisionWriter,integrationDb:{}})
  return {answer,job,model,reader,trace,genericQuery,customerProductDecisionWriter}
}
describe('server customer product path',()=>{
  it('renders exact facts and persists a decision without unrestricted knowledge or private context',async()=>{
    const f=fixture()
    expect(await f.answer(f.job,{trace:f.trace})).toBe('ชื่อสินค้า: แก้วจริง')
    expect(f.genericQuery).not.toHaveBeenCalled()
    expect(f.model.generate.mock.calls[0][0]).toMatchObject({factSelection:true,evidence:{facts:[{id:'f1',value:'แก้วจริง'}]}})
    expect(f.model.generate.mock.calls[0][0]).not.toHaveProperty('contextPacket')
    expect(f.trace.recordEvidence.mock.calls[0][2]).toMatchObject({contentFree:true})
    expect(f.customerProductDecisionWriter).toHaveBeenCalledOnce()
  })
  it('records denied evidence and sends no model request on empty public facts',async()=>{
    const f=fixture([])
    expect(await f.answer(f.job,{trace:f.trace})).toBe(NO_EVIDENCE_REPLY)
    expect(f.model.generate).not.toHaveBeenCalled()
    expect(f.customerProductDecisionWriter.mock.calls[0][2]).toMatchObject({replyText:NO_EVIDENCE_REPLY})
  })
  it('fails closed if a post-generation policy check or journal write fails',async()=>{
    const f=fixture();f.reader.revalidate.mockRejectedValueOnce(new Error('revoked'))
    await expect(f.answer(f.job,{trace:f.trace})).rejects.toMatchObject({code:'LINE_ANSWER_UNAVAILABLE'})
    expect(f.customerProductDecisionWriter).not.toHaveBeenCalled()
    const second=fixture();second.customerProductDecisionWriter.mockRejectedValueOnce(new Error('journal unavailable'))
    await expect(second.answer(second.job,{trace:second.trace})).rejects.toMatchObject({code:'LINE_ANSWER_UNAVAILABLE'})
  })
})
