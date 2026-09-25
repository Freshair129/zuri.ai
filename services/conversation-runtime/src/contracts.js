// @req FR-149, FR-171 — versioned, bounded core/runtime operations.
// @spec ADR-106, SDD-108 — strict fields, correlation, deadlines and idempotency.
// @tested services/conversation-runtime/test/contracts.test.js
export const CONTRACT_VERSION = 'conversation-runtime.v1'
export const CORE_OPERATIONS = Object.freeze([
  'claim', 'renew', 'resolve', 'prepare', 'work-tool', 'credential', 'complete', 'fail', 'send', 'trace', 'status',
])
export const WORK_TOOL_OPERATIONS = Object.freeze(['read', 'propose', 'confirm-execute', 'status'])
export const MAX_REQUEST_BYTES = 64 * 1024
export const MAX_RESPONSE_BYTES = 64 * 1024

const fail = code => Object.assign(new Error(code), { code })
const boundedText = (value, max, code) => {
  if (typeof value !== 'string' || !value.trim() || value.length > max) throw fail(code)
  return value
}
const boundedToken = (value, max, code) => {
  boundedText(value, max, code)
  if (!/^[A-Za-z0-9._:-]+$/.test(value)) throw fail(code)
  return value
}

function boundedJsonWithin(value, maxBytes, code) {
  const pending = [{ value, depth: 0 }]
  const seen = new WeakSet()
  while (pending.length) {
    const current = pending.pop()
    if (current.depth > 64) throw fail(code)
    if (current.value === null || typeof current.value === 'string' || typeof current.value === 'boolean') continue
    if (typeof current.value === 'number') {
      if (!Number.isFinite(current.value)) throw fail(code)
      continue
    }
    if (!current.value || typeof current.value !== 'object') throw fail(code)
    if (seen.has(current.value)) throw fail(code)
    seen.add(current.value)
    for (const child of Object.values(current.value)) pending.push({ value: child, depth: current.depth + 1 })
  }
  try {
    const serialized = JSON.stringify(value)
    if (typeof serialized !== 'string' || Buffer.byteLength(serialized, 'utf8') > maxBytes) throw fail(code)
  } catch (error) {
    if (error?.code === code) throw error
    throw fail(code)
  }
}

function isUuid(value) {
  return typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)
}

export function validateCoreEnvelope(value, expectedOperation = null) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw fail('CONTRACT_OBJECT_REQUIRED')
  const allowed = new Set(['contractVersion', 'operation', 'correlationId', 'idempotencyKey', 'deadlineAt', 'payload'])
  if (Object.keys(value).some(key => !allowed.has(key))) throw fail('CONTRACT_UNKNOWN_FIELD')
  if (value.contractVersion !== CONTRACT_VERSION) throw fail('CONTRACT_VERSION_UNSUPPORTED')
  if (!CORE_OPERATIONS.includes(value.operation) || (expectedOperation && value.operation !== expectedOperation)) {
    throw fail('CONTRACT_OPERATION_INVALID')
  }
  boundedToken(value.correlationId, 128, 'CONTRACT_CORRELATION_ID_INVALID')
  boundedToken(value.idempotencyKey, 200, 'CONTRACT_IDEMPOTENCY_KEY_INVALID')
  const deadline = Date.parse(value.deadlineAt)
  if (typeof value.deadlineAt !== 'string'
    || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value.deadlineAt)
    || !Number.isFinite(deadline)) throw fail('CONTRACT_DEADLINE_INVALID')
  if (!value.payload || typeof value.payload !== 'object' || Array.isArray(value.payload)
    || Object.keys(value.payload).length > 32) throw fail('CONTRACT_PAYLOAD_INVALID')
  validateOperationPayload(value.operation, value.payload)
  return value
}

const PAYLOAD_FIELDS = Object.freeze({
  claim: ['claimantId'], renew: ['claim'], resolve: ['claim'], prepare: ['claim', 'authorityVersion'],
  'work-tool': ['claim', 'operation', 'operationId', 'input'], credential: ['claim'],
  complete: ['claim', 'text', 'operationId'], fail: ['claim', 'code', 'outcome'], send: ['claim', 'operationId'],
  trace: ['claim', 'kind', 'payload'], status: ['claim', 'operationId'],
})
const CLAIM_REF_FIELDS = ['jobId', 'executionId', 'claimantId', 'version', 'tenantId', 'businessId', 'accountId']

export function validateOperationPayload(operation, payload) {
  const allowed = PAYLOAD_FIELDS[operation]
  if (!allowed || Object.keys(payload).some(key => !allowed.includes(key))) throw fail('CONTRACT_PAYLOAD_FIELD_INVALID')
  for (const field of allowed) if (!Object.hasOwn(payload, field)) throw fail('CONTRACT_PAYLOAD_FIELD_REQUIRED')
  if (operation === 'claim') boundedText(payload.claimantId, 128, 'CLAIMANT_ID_INVALID')
  if (['renew', 'resolve', 'prepare', 'work-tool', 'credential', 'complete', 'fail', 'send', 'trace', 'status'].includes(operation)) {
    const ref = payload.claim
    if (!ref || typeof ref !== 'object' || Array.isArray(ref) || Object.keys(ref).some(key => !CLAIM_REF_FIELDS.includes(key))
      || CLAIM_REF_FIELDS.some(key => !Object.hasOwn(ref, key)) || !Number.isInteger(ref.version) || ref.version < 1) {
      throw fail('CLAIM_REFERENCE_INVALID')
    }
    for (const key of CLAIM_REF_FIELDS.filter(key => key !== 'version')) boundedText(ref[key], 128, 'CLAIM_REFERENCE_INVALID')
  }
  if (operation === 'prepare' && (!Number.isInteger(payload.authorityVersion) || payload.authorityVersion < 1)) throw fail('AUTHORITY_VERSION_INVALID')
  if (operation === 'work-tool') validateWorkToolRequest({ operation: payload.operation, operationId: payload.operationId, input: payload.input })
  if (operation === 'complete') {
    boundedText(payload.text, 5000, 'COMPLETION_TEXT_INVALID')
    boundedText(payload.operationId, 200, 'COMPLETION_IDEMPOTENCY_REQUIRED')
  }
  if (operation === 'send' || operation === 'status') boundedText(payload.operationId, 200, 'OPERATION_ID_INVALID')
  if (operation === 'fail') {
    boundedText(payload.code, 80, 'FAILURE_CODE_INVALID')
    if (!['FAILED', 'UNKNOWN'].includes(payload.outcome)) throw fail('FAILURE_OUTCOME_INVALID')
  }
  if (operation === 'trace') {
    boundedText(payload.kind, 80, 'TRACE_KIND_INVALID')
    if (!payload.payload || typeof payload.payload !== 'object' || Array.isArray(payload.payload)) throw fail('TRACE_PAYLOAD_INVALID')
    boundedJsonWithin(payload.payload, 8 * 1024, 'TRACE_PAYLOAD_INVALID')
  }
  return payload
}

export function validateClaim(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw fail('CLAIM_INVALID')
  for (const key of ['jobId', 'executionId', 'claimantId', 'tenantId', 'businessId', 'accountId']) {
    boundedText(value[key], 128, 'CLAIM_SCOPE_INVALID')
  }
  if (!Number.isInteger(value.version) || value.version < 1) throw fail('CLAIM_VERSION_INVALID')
  if (!Number.isFinite(Date.parse(value.leaseExpiresAt)) || !Number.isFinite(Date.parse(value.deadlineAt))) {
    throw fail('CLAIM_DEADLINE_INVALID')
  }
  if (value.phase != null && !['EXECUTION', 'DELIVERY'].includes(value.phase)) throw fail('CLAIM_PHASE_INVALID')
  if (value.correlationId != null) boundedText(value.correlationId, 128, 'CLAIM_CORRELATION_INVALID')
  return value
}

export function validateWorkToolRequest(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw fail('WORK_TOOL_REQUEST_INVALID')
  if (Object.keys(value).some(key => !['operation', 'operationId', 'input'].includes(key))) throw fail('WORK_TOOL_UNKNOWN_FIELD')
  if (!WORK_TOOL_OPERATIONS.includes(value.operation)) throw fail('WORK_TOOL_OPERATION_INVALID')
  boundedText(value.operationId, 200, 'WORK_TOOL_IDEMPOTENCY_REQUIRED')
  if (!value.input || typeof value.input !== 'object' || Array.isArray(value.input)) throw fail('WORK_TOOL_INPUT_INVALID')
  boundedJsonWithin(value.input, 16 * 1024, 'WORK_TOOL_INPUT_INVALID')
  const fields = Object.keys(value.input)
  const exact = allowed => fields.every(field => allowed.includes(field))
  if (value.operation === 'read') {
    if (!exact(['kind', 'query']) || (value.input.kind !== undefined && !['projects', 'work'].includes(value.input.kind))
      || (value.input.query !== undefined && (typeof value.input.query !== 'string' || value.input.query.length > 120))) {
      throw fail('WORK_TOOL_INPUT_INVALID')
    }
  } else if (value.operation === 'propose') {
    if (!exact(['action', 'targetId', 'args']) || !['create_work', 'update_work'].includes(value.input.action)
      || !isUuid(value.input.targetId) || !value.input.args || typeof value.input.args !== 'object'
      || Array.isArray(value.input.args)) throw fail('WORK_TOOL_INPUT_INVALID')
  } else if (value.operation === 'confirm-execute') {
    if (!exact(['proposalId']) || !isUuid(value.input.proposalId)) throw fail('WORK_TOOL_INPUT_INVALID')
  } else if (!exact(['proposalId']) || (value.input.proposalId !== undefined && !isUuid(value.input.proposalId))) {
    throw fail('WORK_TOOL_INPUT_INVALID')
  }
  return value
}

export function validateTurnContext(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw fail('TURN_CONTEXT_INVALID')
  const allowed = new Set(['question', 'evidence', 'slices', 'authorized', 'audienceKind', 'threadId', 'maxBudgetChars', 'workCommand'])
  if (Object.keys(value).some(key => !allowed.has(key))) throw fail('TURN_CONTEXT_UNKNOWN_FIELD')
  boundedText(value.question, 8000, 'TURN_QUESTION_INVALID')
  const records = Array.isArray(value.evidence) ? value.evidence : value.evidence?.records
  if (!Array.isArray(records) || records.length > 64) throw fail('TURN_EVIDENCE_INVALID')
  boundedJsonWithin(value.evidence, 32 * 1024, 'TURN_EVIDENCE_INVALID')
  if (!Array.isArray(value.slices) || value.slices.length > 64) throw fail('TURN_SLICES_INVALID')
  boundedJsonWithin(value.slices, 32 * 1024, 'TURN_SLICES_INVALID')
  if (typeof value.authorized !== 'boolean') throw fail('TURN_AUTHORITY_REQUIRED')
  if (!['DIRECT', 'GROUP', 'ROOM'].includes(value.audienceKind)) throw fail('TURN_AUDIENCE_INVALID')
  if (value.threadId !== null) boundedText(value.threadId, 128, 'TURN_THREAD_ID_INVALID')
  if (!Number.isInteger(value.maxBudgetChars) || value.maxBudgetChars < 0 || value.maxBudgetChars > 32_000) {
    throw fail('TURN_BUDGET_INVALID')
  }
  if (value.workCommand != null) validateWorkToolRequest({ ...value.workCommand, operationId: value.workCommand.operationId ?? 'pending' })
  return value
}
