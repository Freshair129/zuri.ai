import { appendTraceEvent, sha256 } from './execution-trace'
import { assertMainDevLocalOllamaJob, assertMainDevLocalOllamaScope, isMainDevLocalOllamaRequested } from './main-dev-local-ollama'
import { customerProductProfileHash, readLineCustomerProductSnapshot } from './line-customer-product-knowledge'
import { NO_EVIDENCE_REPLY } from './line-answer-policy'

// @req FR-079, FR-235 — persist an execution-bound product-disclosure decision, then recheck owner policy at send.
// @spec SEC-001, SEC-032 — only hashes, fixed decision metadata and the exact current binding enter the journal.
// @tested tests/unit/line-customer-product-decision.test.js, tests/integration/line-customer-product-delivery.test.js
const HEX = /^[a-f0-9]{64}$/
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const TOOL = 'LINE_CUSTOMER_PRODUCT_DISCLOSURE'
const SOURCE_MODE = 'GENESISRAG17_CUSTOMER_PRODUCTS'
const fail = () => Object.assign(new Error('LINE_CUSTOMER_PRODUCT_DECISION_INVALID'), {
  code: 'LINE_CUSTOMER_PRODUCT_DECISION_INVALID',
})
const insist = condition => { if (!condition) throw fail() }
const idempotencyKey = job => `${job.id}:line-customer-products:${job.executionId}`

function validateBinding(binding) {
  insist(binding && typeof binding === 'object' && !Array.isArray(binding)
    && Object.keys(binding).sort().join(',') === 'denied,policyId,policySha256,policyVersion,profileSha256,projectionSha256,schema,sourceSha256'
    && binding.schema === 'zuri.line-customer-products.binding.v1'
    && typeof binding.denied === 'boolean' && HEX.test(binding.profileSha256 ?? ''))
  if (binding.denied) {
    insist(binding.policyId === null && binding.policyVersion === null && binding.policySha256 === null
      && binding.sourceSha256 === null && binding.projectionSha256 === null)
  } else {
    insist(UUID.test(binding.policyId ?? '') && Number.isSafeInteger(binding.policyVersion) && binding.policyVersion > 0
      && HEX.test(binding.policySha256 ?? '') && HEX.test(binding.sourceSha256 ?? '')
      && HEX.test(binding.projectionSha256 ?? ''))
  }
}

function replyText(value) {
  insist(typeof value === 'string' && value.length > 0 && value.length <= 5000
    && value.trim() === value && !/[\p{Cc}\p{Cf}]/u.test(value.replaceAll('\n', '')))
  return value
}

function validateJob(job, { allowMissingExecution = false } = {}) {
  insist(job && typeof job === 'object' && UUID.test(job.id ?? '')
    && (UUID.test(job.executionId ?? '') || (allowMissingExecution && job.executionId == null))
    && UUID.test(job.tenantId ?? '') && UUID.test(job.businessId ?? '')
    && job.executionMode === 'SERVER' && job.runtimeOwner === 'SERVER'
    && typeof job.inbound?.body === 'string')
}

/** Store no request or reply text: the existing trace journal binds their hashes to this execution. */
export async function recordLineCustomerProductDecision(db, job, { binding, replyText: reply, now = () => new Date() } = {}) {
  validateJob(job)
  validateBinding(binding)
  const text = replyText(reply)
  if (binding.denied) insist(text === NO_EVIDENCE_REPLY)
  return appendTraceEvent(db, {
    scope: { tenantId: job.tenantId, businessId: job.businessId },
    turnId: job.id,
    executionId: job.executionId,
    kind: 'TOOL_RESULT',
    idempotencyKey: idempotencyKey(job),
    occurredAt: typeof now === 'function' ? now() : now,
    payload: {
      tool: TOOL,
      decision: 'READ',
      binding,
      requestSha256: sha256(job.inbound.body),
      replySha256: sha256(text),
    },
  })
}

/** The newest job answer can be delivered only under the exact current policy and source binding. */
export async function checkLineCustomerProductSend(db, job, {
  env = process.env,
  snapshotReader = readLineCustomerProductSnapshot,
  requireWhenConfigured = true,
} = {}) {
  let row
  try {
    // Legacy delayed Push jobs can predate execution IDs. Keep their row lookup,
    // but require a complete execution identity whenever disclosure proof applies.
    validateJob(job, { allowMissingExecution: true })
    row = await db.agentTraceEvent.findUnique({ where: { tenantId_businessId_idempotencyKey: {
      tenantId: job.tenantId,
      businessId: job.businessId,
      idempotencyKey: idempotencyKey(job),
    } } })
  } catch {
    return { required: true, allowed: false }
  }

  const configured = env.ZURI_MAIN_DEV_LOCAL_OLLAMA_KNOWLEDGE_SOURCE === SOURCE_MODE
    && isMainDevLocalOllamaRequested(env) && job.runtimeOwner === 'SERVER'
  if (!row && (!configured || requireWhenConfigured === false)) return { required: false, allowed: true }

  try {
    validateJob(job)
    insist(row && row.tenantId === job.tenantId && row.businessId === job.businessId
      && row.turnId === job.id && row.executionId === job.executionId
      && row.kind === 'TOOL_RESULT' && row.idempotencyKey === idempotencyKey(job))
    const payload = JSON.parse(row.payloadJson)
    insist(payload && typeof payload === 'object' && !Array.isArray(payload)
      && Object.keys(payload).sort().join(',') === 'binding,decision,replySha256,requestSha256,tool'
      && payload.tool === TOOL && payload.decision === 'READ'
      && payload.requestSha256 === sha256(job.inbound.body)
      && payload.replySha256 === sha256(replyText(job.answerText)))
    validateBinding(payload.binding)
    if (payload.binding.denied) insist(replyText(job.answerText) === NO_EVIDENCE_REPLY)

    const profile = assertMainDevLocalOllamaJob({ env, job })
    insist(profile?.knowledgeSource === SOURCE_MODE && !profile.memoryEnabled
      && customerProductProfileHash(profile) === payload.binding.profileSha256)
    await assertMainDevLocalOllamaScope({ profile, db, tenantId: job.tenantId,
      businessId: job.businessId, accountId: job.accountId })

    insist(typeof snapshotReader === 'function')
    const fresh = await snapshotReader({ job, db, env, policyId: payload.binding.policyId })
    insist(fresh && typeof fresh === 'object' && !Array.isArray(fresh)
      && ['binding', 'binding,profile', 'binding,policy,profile,source'].includes(Object.keys(fresh).sort().join(',')))
    validateBinding(fresh.binding)
    insist(sha256(fresh.binding) === sha256(payload.binding))
    return { required: true, allowed: true }
  } catch {
    return { required: true, allowed: false }
  }
}
