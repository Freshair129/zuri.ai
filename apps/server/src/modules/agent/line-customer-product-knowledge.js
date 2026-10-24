import prisma from '@/lib/db'
import { resolveViewer } from '@/modules/identity/resolve-viewer'
import { ownsBusiness } from '@/modules/identity/viewer-authority'
import { assertMayView } from '@/modules/line-oa-studio/application/line-oa-account-authority'
import { resolveLineProductDisclosureSource } from '@/modules/knowledge/line-product-disclosure-source'
import { disclosureLookupHash, DISCLOSURE_FIELDS, projectDisclosureFacts, renderDisclosureFacts } from '@/modules/knowledge/line-product-disclosure-contract'
import { hashGenesisRag17Json as hash } from '@/modules/knowledge/genesisrag17-contract'
import { queryKnowledgeCorpus } from '@/modules/knowledge/knowledge-corpus-service'
import { assertMainDevLocalOllamaJob, assertMainDevLocalOllamaScope } from './main-dev-local-ollama'
import { lineKnowledgeGroundingBudgetFromEnv } from './line-knowledge-grounding'
import { parseCustomerProductQuestion } from './line-customer-product-query'
import { NO_EVIDENCE_REPLY } from './line-answer-policy'

// @req FR-235, FR-049, FR-079 — exact owner-approved product facts, never raw corpus/model prose.
// @spec SEC-001, SEC-032 — disclosure, current owner and immutable source revalidation surround model/send.
// @tested tests/unit/line-customer-product-knowledge.test.js
const fail = () => Object.assign(new Error('LINE_CUSTOMER_PRODUCT_UNAVAILABLE'), { code:'LINE_CUSTOMER_PRODUCT_UNAVAILABLE' })
const insist = value => { if (!value) throw fail() }
const policyIdentity = policy => Object.fromEntries(['id','tenantId','businessId','lineOaAccountId','productId','sourceId',
  'enabled','version','fieldsJson','sourceBindingJson','projectionSha256','approvedByPersonId',
  'skuLookupSha256','nameThLookupSha256','nameEnLookupSha256'].map(key=>[key,policy[key]??null]))
export const customerProductProfileHash = profile => hash(profile)
const deniedBinding = profile => ({ schema:'zuri.line-customer-products.binding.v1',denied:true,
  profileSha256:customerProductProfileHash(profile),policyId:null,policyVersion:null,policySha256:null,sourceSha256:null,projectionSha256:null })

/** Current owner authority and exact immutable approved record, never client-selected scope. */
export async function readLineCustomerProductSnapshot({job,env=process.env,db=prisma,policyId=null,query=null,
  sourceReader=resolveLineProductDisclosureSource,viewerResolver=resolveViewer}={}) {
  const profile=assertMainDevLocalOllamaJob({env,job})
  insist(profile?.knowledgeSource==='GENESISRAG17_CUSTOMER_PRODUCTS' && !profile.memoryEnabled)
  const {tenantId,businessId,accountId}=job
  await assertMainDevLocalOllamaScope({profile,db,tenantId,businessId,accountId})
  const account=await db.lineOaAccount.findFirst({where:{id:accountId,tenantId,businessId,archivedAt:null},select:{
    id:true,tenantId:true,businessId:true,executionMode:true,runtimeOwner:true,serverEnabled:true,status:true,archivedAt:true,
    transportMode:true,knowledgeGrounding:true,knowledgeGroundingShadow:true,memoryPolicy:true,memoryProjectId:true}})
  insist(account && account.status==='CONNECTED' && account.archivedAt===null && account.transportMode==='CLOUD')
  assertMainDevLocalOllamaJob({env,job:{...job,account}})
  // A persisted refusal carries no policy/source authority; only the current
  // scoped profile/account may revalidate that fixed no-evidence response.
  if (!policyId && !query) return {profile,binding:deniedBinding(profile)}
  let policy
  if (policyId) {
    policy=await db.lineProductDisclosurePolicy.findFirst({where:{id:policyId,tenantId,businessId,lineOaAccountId:accountId,enabled:true}})
  } else {
    insist(query?.alias)
    const aliasHash=disclosureLookupHash(query.alias)
    const policies=await db.lineProductDisclosurePolicy.findMany({where:{tenantId,businessId,lineOaAccountId:accountId,enabled:true,
      OR:['skuLookupSha256','nameThLookupSha256','nameEnLookupSha256'].map(key=>({[key]:aliasHash}))},take:2})
    insist(policies.length===1)
    policy=policies[0]
  }
  insist(policy && policy.tenantId===tenantId && policy.businessId===businessId && policy.lineOaAccountId===accountId
    && policy.enabled===true && Number.isSafeInteger(policy.version) && policy.version>0)
  const initialPolicyHash=hash(policyIdentity(policy))
  const viewer=await viewerResolver({principalId:policy.approvedByPersonId,db})
  insist(viewer?.principal?.id===policy.approvedByPersonId && ownsBusiness(viewer,businessId))
  assertMayView(viewer,businessId)
  const fields=JSON.parse(policy.fieldsJson)
  insist(Array.isArray(fields) && fields.length>0 && fields.length<=DISCLOSURE_FIELDS.length
    && new Set(fields).size===fields.length && fields.every(field=>DISCLOSURE_FIELDS.includes(field)))
  const source=await sourceReader({tenantId,businessId,accountId,productId:policy.productId,sourceId:policy.sourceId,fields},{db,env})
  insist(source.projectionSha256===policy.projectionSha256 && hash(source.binding)===hash(JSON.parse(policy.sourceBindingJson)))
  // A corrupt or stale lookup hash must not make an unselected alias public.
  if (query) insist(source.values.some(row=>['sku','nameTh','nameEn'].includes(row.field)
    && fields.includes(row.field) && typeof row.value==='string' && disclosureLookupHash(row.value)===disclosureLookupHash(query.alias)))
  // A managed-file read is an asynchronous boundary: a withdrawal or owner/
  // account change during it must also be rejected by the final send snapshot.
  const [currentPolicy,currentAccount,currentViewer]=await Promise.all([
    db.lineProductDisclosurePolicy.findFirst({where:{id:policy.id,tenantId,businessId,lineOaAccountId:accountId,enabled:true}}),
    db.lineOaAccount.findFirst({where:{id:accountId,tenantId,businessId,archivedAt:null}}),
    viewerResolver({principalId:policy.approvedByPersonId,db}),
  ])
  insist(currentPolicy && hash(policyIdentity(currentPolicy))===initialPolicyHash
    && currentAccount?.status==='CONNECTED' && currentAccount.archivedAt===null && currentAccount.transportMode==='CLOUD'
    && currentViewer?.principal?.id===policy.approvedByPersonId && ownsBusiness(currentViewer,businessId))
  assertMayView(currentViewer,businessId)
  assertMainDevLocalOllamaJob({env,job:{...job,account:currentAccount}})
  return {profile,policy,source,binding:{schema:'zuri.line-customer-products.binding.v1',denied:false,
    profileSha256:customerProductProfileHash(profile),policyId:policy.id,policyVersion:policy.version,
    policySha256:initialPolicyHash,sourceSha256:hash(source.binding),projectionSha256:source.projectionSha256}}
}

export function createLineCustomerProductReader(options={}) {
  const {job,env=process.env,db=prisma,queryCorpus=queryKnowledgeCorpus}=options
  const {budgetMs,topK,maxPacketBytes}=lineKnowledgeGroundingBudgetFromEnv(env)
  let binding=null
  const revalidate=async()=>{
    insist(binding && !binding.denied)
    const fresh=await readLineCustomerProductSnapshot({...options,db,env,policyId:binding.policyId})
    insist(hash(fresh.binding)===hash(binding))
    return fresh.binding
  }
  return Object.freeze({getBinding(){insist(binding);return structuredClone(binding)},revalidate,
    async query({question}={}) {
      let timer
      const started=Date.now()
      try {
        const profile=assertMainDevLocalOllamaJob({env,job})
        insist(profile?.knowledgeSource==='GENESISRAG17_CUSTOMER_PRODUCTS')
        const query=parseCustomerProductQuestion(question)
        insist(query)
        const work=async()=>{
          const before=await readLineCustomerProductSnapshot({...options,db,env,query})
          const values=before.source.values.filter(row=>!query.fields || query.fields.includes(row.field))
          const facts=projectDisclosureFacts(values)
          insist(facts.length && Buffer.byteLength(JSON.stringify({facts}))<=maxPacketBytes)
          const ref=before.source.retrievalRef
          const result=await queryCorpus({businessId:job.businessId,query:query.alias,topK},{db,env,
            viewer:Object.freeze({visibleBusinessIds:Object.freeze([job.businessId])}),sourceIds:[before.policy.sourceId]})
          insist(result.manifestHash===ref.manifestHash && result.corpusGeneration===ref.corpusGeneration
            && Array.isArray(result.results) && result.results.length>0 && result.results.length<=topK)
          for (const hit of result.results) insist(['sourceId','ingestionId','snapshotId','generation'].every(key=>hit[key]===ref[key]))
          const after=await readLineCustomerProductSnapshot({...options,db,env,policyId:before.policy.id})
          insist(hash(before.binding)===hash(after.binding))
          return {facts,binding:after.binding,retrievalRefs:[ref],meta:{reason:null,budgetMs:Date.now()-started}}
        }
        const result=await Promise.race([work(),new Promise((_,reject)=>{timer=setTimeout(()=>reject(fail()),budgetMs)})])
        binding=result.binding
        return result
      } catch {
        const profile=assertMainDevLocalOllamaJob({env,job})
        binding=deniedBinding(profile)
        return {facts:[],binding,retrievalRefs:[],meta:{reason:'NO_EVIDENCE',budgetMs:Date.now()-started}}
      } finally {clearTimeout(timer)}
    },
  })
}

/** The model can select exact typed fact IDs; no part of model prose reaches LINE. */
export async function selectCustomerProductReply({question,facts},{model,revalidate,trace}={}) {
  if (!Array.isArray(facts) || !facts.length) return NO_EVIDENCE_REPLY
  await revalidate()
  let generated
  try { generated=await model.generate({question,evidence:{facts},factSelection:true,trace}) }
  catch { await revalidate();trace?.assertHealthy?.();return NO_EVIDENCE_REPLY }
  await revalidate()
  trace?.assertHealthy?.()
  if (generated?.provider!=='ollama' || generated.status!=='ok' || typeof generated.text!=='string' || generated.text.length>2048) return NO_EVIDENCE_REPLY
  try {
    const selection=JSON.parse(generated.text)
    if (!selection || Array.isArray(selection) || Object.keys(selection).join(',')!=='factIds') return NO_EVIDENCE_REPLY
    return renderDisclosureFacts(facts,selection.factIds) || NO_EVIDENCE_REPLY
  } catch { return NO_EVIDENCE_REPLY }
}
