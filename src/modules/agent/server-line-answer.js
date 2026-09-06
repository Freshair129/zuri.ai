import { createPostgresBusinessKnowledgeReader } from '@/modules/knowledge'
import { answerBusinessQuestion, createDeterministicBusinessModel } from './grounded-business-answer'
import { createLineReadQueryFromEnv, createPhase1BusinessAgentPortsFromEnv } from './phase1-runtime'

// @req FR-149, FR-150 — answer an already-admitted durable conversation job;
// execution placement and external model permission are distinct decisions.
// @spec ADR-061, SEC-001, SEC-010 — public scoped knowledge only, no memory,
// tools, second CRM ingest, write actions or implicit external model fallback.
// @tested tests/unit/server-line-answer.test.js

function failure(code) {
  const error = new Error(code)
  error.code = code
  return error
}

/** Input is the worker's claimed job, including the CRM `inbound` relation. */
export function createServerLineAnswer({
  env = process.env,
  knowledge,
  queryFn,
  runtimeFactory = createPhase1BusinessAgentPortsFromEnv,
  ...runtimeDependencies
} = {}) {
  let localKnowledge = knowledge
  return async function answer(job) {
    const tenantId = job?.tenantId
    const businessId = job?.businessId
    const question = job?.inbound?.body
    if (![tenantId, businessId, question].every((value) => typeof value === 'string' && value.trim())) {
      throw failure('LINE_ANSWER_INPUT_INVALID')
    }
    if (job.account && (job.account.tenantId !== tenantId || job.account.businessId !== businessId)) {
      throw failure('LINE_ANSWER_SCOPE_MISMATCH')
    }
    const modelAccess = job.modelAccess ?? 'LOCAL_ONLY'
    if (!['LOCAL_ONLY', 'EXTERNAL_MODEL_ALLOWED'].includes(modelAccess)) throw failure('LINE_MODEL_ACCESS_INVALID')
    let businessKnowledge
    let model
    try {
      if (modelAccess === 'LOCAL_ONLY') {
        if (!localKnowledge) {
          const execute = queryFn ?? createLineReadQueryFromEnv(env, { serverOwned: true })
          if (!execute) throw failure('LINE_BUSINESS_KNOWLEDGE_NOT_CONFIGURED')
          localKnowledge = createPostgresBusinessKnowledgeReader({ queryFn: execute })
        }
        businessKnowledge = localKnowledge
        model = createDeterministicBusinessModel()
      } else {
        // Direct native ingress has already authenticated account scope. Opting
        // out of Edge binding does not weaken the production provider/Vault gates.
        const ports = await runtimeFactory(env, { ...runtimeDependencies, queryFn, bindingRequired: false })
        if (!ports?.businessKnowledge || typeof ports.resolveModel !== 'function') {
          throw failure('LINE_BUSINESS_AGENT_NOT_CONFIGURED')
        }
        businessKnowledge = ports.businessKnowledge
        model = await ports.resolveModel({ tenantId, businessId })
      }
      const result = await answerBusinessQuestion({ tenantId, businessId, question }, { knowledge: businessKnowledge, model })
      if (typeof result?.text !== 'string' || !result.text.trim()) throw failure('LINE_ANSWER_EMPTY')
      // LINE's text message limit is 5000 UTF-16 code units. Never leave a split
      // surrogate at the boundary when an evidence value contains emoji.
      return result.text.slice(0, 5000).replace(/[\uD800-\uDBFF]$/, '')
    } catch {
      // Reader/provider failures may contain SQL, payload or credentials; the job
      // stores only this stable code, never the original message or cause.
      throw failure('LINE_ANSWER_UNAVAILABLE')
    }
  }
}
