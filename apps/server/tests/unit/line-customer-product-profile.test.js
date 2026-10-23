import { describe, it, expect, vi } from 'vitest'
import { readMainDevLocalOllamaProfile, assertMainDevLocalOllamaJob } from '@/modules/agent/main-dev-local-ollama'
import { createModelProviderPort } from '@/modules/agent/model-provider'
import { createPhase1BusinessAgentPortsFromEnv } from '@/modules/agent/phase1-runtime'
import { createCorePrepareTurn } from '@/modules/line-oa-studio/application/conversation-runtime-core'

// @req FR-079, FR-049 — real public product selection remains source-bound and cannot generate prose.
// @tested tests/unit/line-customer-product-profile.test.js
const id = n => `00000000-0000-4000-8000-${String(n).padStart(12,'0')}`
function setup() {
  const env = { ZURI_MAIN_DEV_LOCAL_OLLAMA_ENABLED:'true', ZURI_PHASE1_RUNTIME_SOURCE:'MAIN_DEV_LOCAL_OLLAMA',
    ZURI_MAIN_DEV_LOCAL_OLLAMA_EXPECTED_DATABASE:'dev', ZURI_MAIN_DEV_LOCAL_OLLAMA_BASE_URL:'http://host.docker.internal:11434',
    ZURI_MAIN_DEV_LOCAL_OLLAMA_ALLOWED_TENANT_IDS:JSON.stringify([id(1)]),
    ZURI_MAIN_DEV_LOCAL_OLLAMA_ALLOWED_BUSINESS_IDS:JSON.stringify([id(2)]),
    ZURI_MAIN_DEV_LOCAL_OLLAMA_ALLOWED_LINE_OA_ACCOUNT_IDS:JSON.stringify([id(3)]),
    ZURI_MAIN_DEV_LOCAL_OLLAMA_KNOWLEDGE_SOURCE:'GENESISRAG17_CUSTOMER_PRODUCTS' }
  const job = { tenantId:id(1),businessId:id(2),accountId:id(3),executionMode:'SERVER',runtimeOwner:'SERVER',
    account:{id:id(3),tenantId:id(1),businessId:id(2),executionMode:'SERVER',runtimeOwner:'SERVER',serverEnabled:true,
      knowledgeGrounding:'GKS_CORPUS',memoryPolicy:'OFF',memoryProjectId:null} }
  return {env,job}
}
describe('customer product profile', () => {
  it('selects a distinct default-off source without fixture or server product pins', () => {
    const f=setup()
    expect(readMainDevLocalOllamaProfile(f.env)).toMatchObject({knowledgeSource:'GENESISRAG17_CUSTOMER_PRODUCTS',rag:null,testFixturePath:null})
    expect(assertMainDevLocalOllamaJob(f)).toMatchObject({memoryEnabled:false})
    expect(readMainDevLocalOllamaProfile({})).toBeNull()
  })
  it('requires current GKS mode and refuses memory bypass or Runtime placement', () => {
    const f=setup()
    expect(()=>assertMainDevLocalOllamaJob({...f,job:{...f.job,account:{...f.job.account,knowledgeGrounding:'BUSINESS_KNOWLEDGE'}}})).toThrow()
    expect(()=>readMainDevLocalOllamaProfile({...f.env,ZURI_MAIN_DEV_LOCAL_OLLAMA_MEMORY_ENABLED:'true'})).toThrow()
    expect(()=>assertMainDevLocalOllamaJob({...f,job:{...f.job,runtimeOwner:'CONVERSATION_RUNTIME'}})).toThrow()
  })
  it('requests strict fact IDs from actual main-dev provider and records the selection prompt', async () => {
    const fetchFn=vi.fn(async()=>new Response(JSON.stringify({response:'{"factIds":["f1"]}'}),{status:200}))
    const beforeModelCall=vi.fn(async()=>({})), afterModelCall=vi.fn(async()=>{})
    const model=createModelProviderPort({runtimeSource:'MAIN_DEV_LOCAL_OLLAMA',provider:'ollama',model:'test-model',
      baseUrl:'http://host.docker.internal:11434',fetchFn})
    await model.generate({question:'ชื่อสินค้า CUP-A',evidence:{facts:[{id:'f1',field:'nameTh',label:'ชื่อสินค้า',value:'แก้ว'}]},
      factSelection:true,trace:{beforeModelCall,afterModelCall}})
    const body=JSON.parse(fetchFn.mock.calls[0][1].body)
    expect(body.format).toMatchObject({type:'object',additionalProperties:false,required:['factIds']})
    expect(body.prompt).toContain('factIds')
    expect(beforeModelCall.mock.calls[0][0].promptVersion).toBe('line-product-fact-selection-v1')
    expect(beforeModelCall.mock.calls[0][0].systemPrompt.content).toContain('factIds')
  })
  it('does not expose strict-selection mode to ordinary public provider calls', async () => {
    const fetchFn=vi.fn()
    const model=createModelProviderPort({provider:'openai',model:'test',credential:'test-key',fetchFn})
    await expect(model.generate({question:'x',evidence:{facts:[]},factSelection:true})).rejects.toThrow('MODEL_FACT_SELECTION_SOURCE_DENIED')
    expect(fetchFn).not.toHaveBeenCalled()
  })
  it('resolves the existing exact Ollama primary without opening a fixture or generic knowledge port',async()=>{
    const {env,job}=setup()
    const fetchFn=vi.fn(async()=>new Response(JSON.stringify({response:'{"factIds":["f1"]}'}),{status:200}))
    const integrationDb={$queryRaw:vi.fn(async()=>[{databaseName:'dev'}]),integrationConnection:{findMany:vi.fn(async()=>[])}}
    const connectionResolver=vi.fn(async()=>({tenantId:job.tenantId,businessId:job.businessId,purpose:'PHASE1_LINE_LLM',status:'ACTIVE',
      role:'PRIMARY',credential:null,provider:{status:'ACTIVE',code:'ollama'},metadataJson:JSON.stringify({model:'test-model'})}))
    const ports=createPhase1BusinessAgentPortsFromEnv(env,{integrationDb,connectionResolver,fetchFn,bindingRequired:false})
    const model=await ports.resolveModel({tenantId:job.tenantId,businessId:job.businessId,accountId:job.accountId})
    await expect(ports.businessKnowledge.query({tenantId:job.tenantId,businessId:job.businessId})).rejects.toThrow('LINE_CUSTOMER_PRODUCT_READER_REQUIRED')
    expect(await model.generate({question:'name',evidence:{facts:[{id:'f1',field:'nameTh',label:'ชื่อสินค้า',value:'แก้ว'}]},factSelection:true})).toMatchObject({provider:'ollama',status:'ok'})
  })
  it('Core refuses the unsupported customer product mode before any Runtime port read',async()=>{
    const {env,job}=setup(),businessPorts=vi.fn()
    const prepare=createCorePrepareTurn({env,db:{},businessPorts})
    await expect(prepare({...job,inbound:{body:'ขอชื่อสินค้า CUP-A'}})).rejects.toMatchObject({code:'RUNTIME_CUSTOMER_PRODUCT_MODE_UNSUPPORTED'})
    expect(businessPorts).not.toHaveBeenCalled()
  })
})
