import { appendTraceEvent, sha256 } from '@/modules/agent/execution-trace'

// @req FR-291 — keep the product decision private and content-free while binding
//   the exact deterministic reply to one claimed job execution.
// @spec ADR-106, SDD-110 — Core owns the durable decision; Runtime receives text only.
// @tested tests/integration/conversation-runtime-product-facts.test.js
const BINDING_SCHEMA = 'zuri.line-product-facts.binding.v1'
const DECISION_TOOL = 'LINE_PRODUCT_FACTS'
const BINDING_FIELDS = Object.freeze(['schema', 'jobId', 'executionId', 'requestDigest', 'authorityDigest', 'productRefDigest',
  'stockPolicyVersion', 'stockObservationDigest', 'publicationDigest', 'resultDigest'])
const DIGEST = /^[0-9a-f]{64}$/
const failure = code => Object.assign(new Error(code), { code, status: 409 })

export function lineProductFactsDecisionKey(job) {
  return `${job.id}:line-product-facts:${job.executionId}`
}

export function normalizeLineProductFactsReply(text) {
  if (typeof text !== 'string') throw failure('LINE_PRODUCT_FACTS_REPLY_INVALID')
  const bounded = text.trim().replace(/[\uD800-\uDBFF]$/, '')
  if (!bounded || bounded.length > 5000) throw failure('LINE_PRODUCT_FACTS_REPLY_INVALID')
  return bounded
}

function validBinding(binding, job) {
  if (!binding || typeof binding !== 'object' || Array.isArray(binding)
    || Object.keys(binding).sort().join(',') !== [...BINDING_FIELDS].sort().join(',')
    || binding.schema !== BINDING_SCHEMA || binding.jobId !== job.id
    || typeof job.executionId !== 'string' || !job.executionId || binding.executionId !== job.executionId
    || !['requestDigest', 'authorityDigest', 'resultDigest'].every(key => typeof binding[key] === 'string' && DIGEST.test(binding[key]))
    || !['productRefDigest', 'stockObservationDigest', 'publicationDigest'].every(key => binding[key] === null
      || (typeof binding[key] === 'string' && DIGEST.test(binding[key])))
    || !(binding.stockPolicyVersion === null || (Number.isSafeInteger(binding.stockPolicyVersion) && binding.stockPolicyVersion > 0))) return false
  return true
}

function decisionPayload(job, binding, replyText) {
  if (!validBinding(binding, job)) throw failure('LINE_PRODUCT_FACTS_BINDING_INVALID')
  const normalizedReply = normalizeLineProductFactsReply(replyText)
  return {
    tool: DECISION_TOOL,
    decision: 'COMMAND',
    binding,
    // Trace payload serialization is canonical (sorted object keys). Hash the
    // same canonical representation so the stored digest is stable across that
    // round trip even if a producer constructs the object in a different order.
    bindingSha256: sha256(binding),
    replySha256: sha256(normalizedReply),
  }
}

function readDecisionPayload(row, job) {
  if (!row || row.turnId !== job.id || row.executionId !== job.executionId || row.kind !== 'TOOL_RESULT'
    || row.idempotencyKey !== lineProductFactsDecisionKey(job)) throw failure('LINE_PRODUCT_FACTS_DECISION_INVALID')
  let payload
  try { payload = JSON.parse(row.payloadJson) } catch { throw failure('LINE_PRODUCT_FACTS_DECISION_INVALID') }
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)
    || Object.keys(payload).sort().join(',') !== ['tool', 'decision', 'binding', 'bindingSha256', 'replySha256'].sort().join(',')
    || payload.tool !== DECISION_TOOL || payload.decision !== 'COMMAND' || !validBinding(payload.binding, job)
    || payload.bindingSha256 !== sha256(payload.binding) || !DIGEST.test(payload.replySha256 ?? '')) {
    throw failure('LINE_PRODUCT_FACTS_DECISION_INVALID')
  }
  return payload
}

export async function recordLineProductFactsDecision(db, job, { binding, replyText, now = () => new Date() } = {}) {
  const payload = decisionPayload(job, binding, replyText)
  const occurredAt = typeof now === 'function' ? now() : now
  const trace = { scope: { tenantId: job.tenantId, businessId: job.businessId }, turnId: job.id,
    executionId: job.executionId, kind: 'TOOL_RESULT', idempotencyKey: lineProductFactsDecisionKey(job), payload, occurredAt }
  const audit = auditData(job, binding, occurredAt)

  if (typeof db?.$transaction !== 'function') {
    await appendTraceEvent(db, trace)
    await ensureAuditEvent(db, audit)
    return payload
  }

  try {
    await db.$transaction(async tx => {
      await appendTraceEvent(tx, trace)
      await ensureAuditEvent(tx, audit)
    })
  } catch (error) {
    if (!isUniqueConflict(error)) throw error
    // The composite trace key and deterministic audit id are the concurrency
    // boundary. PostgreSQL aborts the losing transaction, so verify the winner
    // only after rollback and accept it only when both immutable records match.
    const [traceRow, auditRow] = await Promise.all([
      db.agentTraceEvent.findUnique({ where: { tenantId_businessId_idempotencyKey: {
        tenantId: job.tenantId, businessId: job.businessId, idempotencyKey: lineProductFactsDecisionKey(job),
      } } }),
      db.auditEvent.findUnique({ where: { id: audit.id } }),
    ])
    if (!traceRow || !auditRow) throw error
    const winnerPayload = readDecisionPayload(traceRow, job)
    if (sha256(winnerPayload) !== sha256(payload)) throw failure('LINE_PRODUCT_FACTS_DECISION_CONFLICT')
    assertAuditMatches(auditRow, audit.data)
  }
  return payload
}

function auditData(job, binding, occurredAt) {
  const auditPayload = {
    schema: 'zuri.line-product-facts.audit.v1',
    executionId: binding.executionId,
    requestDigest: binding.requestDigest,
    authorityDigest: binding.authorityDigest,
    productRefDigest: binding.productRefDigest,
    stockPolicyVersion: binding.stockPolicyVersion,
    stockObservationDigest: binding.stockObservationDigest,
    publicationDigest: binding.publicationDigest,
    resultDigest: binding.resultDigest,
  }
  return { id: lineProductFactsDecisionKey(job), data: {
    id: lineProductFactsDecisionKey(job), entityType: 'LINE_PRODUCT_FACTS_READ', entityId: job.id,
    action: 'RESOLVED', actorType: 'AGENT', actorId: null, tenantId: job.tenantId,
    businessId: job.businessId, requestId: job.id, occurredAt, payloadJson: JSON.stringify(auditPayload),
  } }
}

function assertAuditMatches(row, expected) {
  const fields = ['id', 'entityType', 'entityId', 'action', 'actorType', 'actorId', 'tenantId', 'businessId', 'requestId']
  if (!row || fields.some(field => row[field] !== expected[field])) throw failure('LINE_PRODUCT_FACTS_AUDIT_CONFLICT')
  let actualPayload
  try { actualPayload = JSON.parse(row.payloadJson) } catch { throw failure('LINE_PRODUCT_FACTS_AUDIT_CONFLICT') }
  let expectedPayload
  try { expectedPayload = JSON.parse(expected.payloadJson) } catch { throw failure('LINE_PRODUCT_FACTS_AUDIT_CONFLICT') }
  if (sha256(actualPayload) !== sha256(expectedPayload)) throw failure('LINE_PRODUCT_FACTS_AUDIT_CONFLICT')
  return row
}

async function ensureAuditEvent(db, audit) {
  const existing = await db.auditEvent.findUnique({ where: { id: audit.id } })
  if (existing) return assertAuditMatches(existing, audit.data)
  try {
    return await db.auditEvent.create({ data: audit.data })
  } catch (error) {
    if (!isUniqueConflict(error)) throw error
    // On a transaction client the caller must retry the whole transaction after
    // a unique race; querying a PostgreSQL transaction after P2002 is invalid.
    if (typeof db?.$transaction !== 'function') throw error
    const winner = await db.auditEvent.findUnique({ where: { id: audit.id } })
    if (!winner) throw error
    return assertAuditMatches(winner, audit.data)
  }
}

function isUniqueConflict(error) {
  return error?.code === 'P2002' || /unique constraint/i.test(String(error?.message ?? ''))
}

export async function readLineProductFactsDecision(db, job) {
  if (typeof job?.executionId !== 'string' || !job.executionId) return null
  const row = await db.agentTraceEvent.findUnique({ where: { tenantId_businessId_idempotencyKey: {
    tenantId: job.tenantId, businessId: job.businessId, idempotencyKey: lineProductFactsDecisionKey(job),
  } } })
  return row ? readDecisionPayload(row, job) : null
}

export async function assertLineProductFactsReplyMatches(db, job, text) {
  const decision = await readLineProductFactsDecision(db, job)
  if (!decision) throw failure('LINE_PRODUCT_FACTS_NOT_PREPARED')
  if (sha256(normalizeLineProductFactsReply(text)) !== decision.replySha256) {
    throw failure('LINE_PRODUCT_FACTS_REPLY_MISMATCH')
  }
  return decision
}
