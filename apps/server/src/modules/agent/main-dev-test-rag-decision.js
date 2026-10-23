import { appendTraceEvent, sha256 } from './execution-trace'
import { assertMainDevLocalOllamaJob, assertMainDevLocalOllamaScope, isMainDevLocalOllamaRequested } from './main-dev-local-ollama'
import { mainDevTestRagProfileDigest, readMainDevTestRagSnapshot } from './main-dev-test-rag-knowledge'
import { NO_EVIDENCE_REPLY } from './line-answer-policy'

// @req FR-079 — persist an execution-bound model-input source proof, then recheck it inside the send fence.
// @spec SEC-001, SEC-032 — no source contents or new authority in the durable decision.
// @tested tests/unit/main-dev-test-rag-decision.test.js, tests/integration/main-dev-test-rag-delivery.test.js
const HEX = /^[a-f0-9]{64}$/
const key = job => `${job.id}:line-test-rag:${job.executionId}`
const fail = () => Object.assign(new Error('MAIN_DEV_TEST_RAG_DECISION_INVALID'), { code: 'MAIN_DEV_TEST_RAG_DECISION_INVALID' })
const insist = condition => { if (!condition) throw fail() }
function validate(binding) {
  insist(binding && Object.keys(binding).sort().join(',') === 'denied,profileSha256,schema,sourceSha256'
    && binding.schema === 'zuri.line-test-rag.binding.v1' && typeof binding.denied === 'boolean'
    && HEX.test(binding.profileSha256 ?? '')
    && (binding.denied ? binding.sourceSha256 === null : HEX.test(binding.sourceSha256 ?? '')))
}
function reply(text) {
  insist(typeof text === 'string' && text.trim().length > 0 && text.trim().length <= 5000)
  return text.trim().replace(/[\uD800-\uDBFF]$/, '')
}
export async function recordMainDevTestRagDecision(db, job, { binding, replyText, now = () => new Date() } = {}) {
  validate(binding)
  const text = reply(replyText)
  insist(job.id && job.executionId && typeof job.inbound?.body === 'string')
  if (binding.denied) insist(text === NO_EVIDENCE_REPLY)
  return appendTraceEvent(db, { scope: { tenantId: job.tenantId, businessId: job.businessId },
    turnId: job.id, executionId: job.executionId, kind: 'TOOL_RESULT', idempotencyKey: key(job),
    occurredAt: typeof now === 'function' ? now() : now,
    payload: { tool: 'LINE_TEST_ONLY_RAG', decision: 'READ', binding,
      requestSha256: sha256(job.inbound.body), replySha256: sha256(text) } })
}

export async function checkMainDevTestRagSend(db, job, { env = process.env,
  snapshotReader = readMainDevTestRagSnapshot } = {}) {
  const configured = env.ZURI_MAIN_DEV_LOCAL_OLLAMA_KNOWLEDGE_SOURCE === 'GENESISRAG17_TEST_ONLY'
    && isMainDevLocalOllamaRequested(env)
    && job.runtimeOwner === 'SERVER'
  let row
  try {
    row = await db.agentTraceEvent.findUnique({ where: { tenantId_businessId_idempotencyKey: {
      tenantId: job.tenantId, businessId: job.businessId, idempotencyKey: key(job),
    } } })
  } catch { return { required: true, allowed: false } }
  if (!row && !configured) return { required: false, allowed: true }
  try {
    insist(row && row.tenantId === job.tenantId && row.businessId === job.businessId
      && row.turnId === job.id && row.executionId === job.executionId && row.kind === 'TOOL_RESULT'
      && row.idempotencyKey === key(job))
    const payload = JSON.parse(row.payloadJson)
    insist(Object.keys(payload).sort().join(',') === 'binding,decision,replySha256,requestSha256,tool'
      && payload.tool === 'LINE_TEST_ONLY_RAG' && payload.decision === 'READ'
      && payload.requestSha256 === sha256(job.inbound?.body) && payload.replySha256 === sha256(reply(job.answerText)))
    validate(payload.binding)
    const profile = assertMainDevLocalOllamaJob({ env, job })
    insist(profile?.knowledgeSource === 'GENESISRAG17_TEST_ONLY'
      && mainDevTestRagProfileDigest(profile) === payload.binding.profileSha256)
    await assertMainDevLocalOllamaScope({ profile, db, tenantId: job.tenantId,
      businessId: job.businessId, accountId: job.accountId })
    if (payload.binding.denied) {
      insist(reply(job.answerText) === NO_EVIDENCE_REPLY)
    } else {
      const fresh = await snapshotReader({ profile, db, env, tenantId: job.tenantId,
        businessId: job.businessId, accountId: job.accountId })
      insist(sha256(fresh.binding) === sha256(payload.binding))
    }
    return { required: true, allowed: true }
  } catch { return { required: true, allowed: false } }
}
