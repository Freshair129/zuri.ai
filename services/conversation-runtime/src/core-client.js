import { randomUUID } from 'node:crypto'
import { CONTRACT_VERSION, CORE_OPERATIONS, MAX_MEMORY_PACKET_BYTES, MAX_REQUEST_BYTES, MAX_RESPONSE_BYTES, WORK_REJECTION_CODES, validateCoreEnvelope, validateClaim, validateTurnContext } from './contracts.js'

// @req FR-149 — private core adapter for the independently running runtime.
// @spec ADR-106 D2-D4, SDD-110 — bearer-authenticated bounded operations.
// @tested services/conversation-runtime/test/contracts.test.js
const text = (value, max, code) => {
  if (typeof value !== 'string' || !value.trim() || value.length > max) throw Object.assign(new Error(code), { code })
  return value
}

async function boundedJson(response, maxBytes, code = 'CORE_RESPONSE_INVALID') {
  const declared = Number(response.headers?.get?.('content-length'))
  if (Number.isFinite(declared) && declared > maxBytes) throw Object.assign(new Error('CORE_RESPONSE_TOO_LARGE'), { code: 'CORE_RESPONSE_TOO_LARGE' })
  if (!response.headers?.get?.('content-type')?.toLowerCase().includes('application/json')) throw Object.assign(new Error(code), { code })
  const reader = response.body?.getReader?.()
  if (!reader) {
    const body = await response.text()
    if (Buffer.byteLength(body, 'utf8') > maxBytes) throw Object.assign(new Error('CORE_RESPONSE_TOO_LARGE'), { code: 'CORE_RESPONSE_TOO_LARGE' })
    try { return JSON.parse(body) } catch { throw Object.assign(new Error(code), { code }) }
  }
  const chunks = []
  let bytes = 0
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      bytes += value.byteLength
      if (bytes > maxBytes) {
        await reader.cancel()
        throw Object.assign(new Error('CORE_RESPONSE_TOO_LARGE'), { code: 'CORE_RESPONSE_TOO_LARGE' })
      }
      chunks.push(Buffer.from(value))
    }
  } finally { reader.releaseLock() }
  try { return JSON.parse(Buffer.concat(chunks, bytes).toString('utf8')) }
  catch { throw Object.assign(new Error(code), { code }) }
}

function boundedJsonWithin(value, maxBytes) {
  const pending = [{ value, depth: 0 }]
  const seen = new WeakSet()
  while (pending.length) {
    const current = pending.pop()
    if (current.depth > 64) return false
    if (current.value === null || typeof current.value === 'string' || typeof current.value === 'boolean') continue
    if (typeof current.value === 'number') {
      if (!Number.isFinite(current.value)) return false
      continue
    }
    if (!current.value || typeof current.value !== 'object') return false
    if (seen.has(current.value)) return false
    seen.add(current.value)
    for (const child of Object.values(current.value)) pending.push({ value: child, depth: current.depth + 1 })
  }
  try {
    const serialized = JSON.stringify(value)
    return typeof serialized === 'string' && Buffer.byteLength(serialized, 'utf8') <= maxBytes
  } catch { return false }
}

export function createCoreClient({ baseUrl, token, fetchFn = fetch, timeoutMs = 10_000, now = () => new Date() } = {}) {
  if (typeof baseUrl !== 'string' || typeof token !== 'string' || token.length < 32) throw new Error('CORE_CLIENT_CONFIG_REQUIRED')
  const root = new URL(baseUrl)
  if (!['http:', 'https:'].includes(root.protocol) || root.username || root.password || root.search || root.hash) {
    throw new Error('CORE_CLIENT_URL_INVALID')
  }
  async function call(operation, payload, { correlationId = randomUUID(), idempotencyKey = `${operation}:${randomUUID()}`, deadlineAt = new Date(now().getTime() + timeoutMs).toISOString(), signal } = {}) {
    if (!CORE_OPERATIONS.includes(operation)) throw new Error('CORE_OPERATION_INVALID')
    const envelope = validateCoreEnvelope({ contractVersion: CONTRACT_VERSION, operation,
      correlationId: text(correlationId, 128, 'CORE_CORRELATION_ID_INVALID'),
      idempotencyKey: text(idempotencyKey, 200, 'CORE_IDEMPOTENCY_KEY_INVALID'), deadlineAt, payload })
    let body
    try { body = JSON.stringify(envelope) } catch { throw Object.assign(new Error('CORE_REQUEST_INVALID'), { code: 'CORE_REQUEST_INVALID' }) }
    if (Buffer.byteLength(body, 'utf8') > MAX_REQUEST_BYTES) throw Object.assign(new Error('CORE_REQUEST_TOO_LARGE'), { code: 'CORE_REQUEST_TOO_LARGE' })
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), timeoutMs)
    const abort = () => controller.abort(signal.reason)
    signal?.addEventListener('abort', abort, { once: true })
    try {
      const url = new URL(`/api/internal/conversation-runtime/v1/${operation}`, root)
      const response = await fetchFn(url, { method: 'POST', redirect: 'error', signal: controller.signal,
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', accept: 'application/json' }, body })
      const result = await boundedJson(response, MAX_RESPONSE_BYTES)
      if (!result || Object.keys(result).some(key => !['contractVersion', 'ok', 'data', 'error'].includes(key))
        || result.contractVersion !== CONTRACT_VERSION || typeof result.ok !== 'boolean') throw new Error('CORE_RESPONSE_INVALID')
      if (!response.ok || !result.ok) {
        if (result.ok !== false || !result.error || Object.keys(result.error).some(key => !['code', 'retryable'].includes(key))
          || typeof result.error.code !== 'string' || !/^[A-Z0-9_:-]{1,80}$/.test(result.error.code)
          || typeof result.error.retryable !== 'boolean' || Object.hasOwn(result, 'data')) throw new Error('CORE_RESPONSE_INVALID')
        throw Object.assign(new Error(result.error.code), { code: result.error.code, retryable: result.error.retryable })
      }
      if (Object.hasOwn(result, 'error')) throw new Error('CORE_RESPONSE_INVALID')
      if (!Object.hasOwn(result, 'data')) throw new Error('CORE_RESPONSE_INVALID')
      validateOperationResult(operation, result.data, envelope.payload)
      return result.data
    } catch (error) {
      if (error?.name === 'AbortError') throw Object.assign(new Error('CORE_OPERATION_TIMEOUT'), { code: 'CORE_OPERATION_TIMEOUT', retryable: true })
      throw error
    } finally {
      clearTimeout(timeout)
      signal?.removeEventListener('abort', abort)
    }
  }
  async function health({ signal } = {}) {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), timeoutMs)
    const abort = () => controller.abort(signal.reason)
    signal?.addEventListener('abort', abort, { once: true })
    try {
      const response = await fetchFn(new URL('/api/internal/conversation-runtime/v1/health', root), {
        method: 'GET', redirect: 'error', signal: controller.signal,
        headers: { authorization: `Bearer ${token}`, accept: 'application/json' },
      })
      if (!response.ok) throw Object.assign(new Error(`CORE_HTTP_${response.status}`), { code: `CORE_HTTP_${response.status}` })
      const value = await boundedJson(response, 4 * 1024)
      if (Object.keys(value ?? {}).some(key => !['contractVersion', 'status', 'runtimeOwner'].includes(key))
        || value?.contractVersion !== CONTRACT_VERSION || value?.status !== 'READY'
        || value?.runtimeOwner !== 'CONVERSATION_RUNTIME') {
        throw Object.assign(new Error('CORE_RUNTIME_OWNER_MISMATCH'), { code: 'CORE_RUNTIME_OWNER_MISMATCH' })
      }
      return value
    } catch (error) {
      if (controller.signal.aborted) throw Object.assign(new Error('CORE_HEALTH_TIMEOUT'), { code: 'CORE_HEALTH_TIMEOUT' })
      throw error
    } finally {
      clearTimeout(timeout)
      signal?.removeEventListener('abort', abort)
    }
  }
  return Object.freeze({ call, health })
}

function validateOperationResult(operation, data, payload) {
  const invalid = () => { throw Object.assign(new Error('CORE_RESPONSE_INVALID'), { code: 'CORE_RESPONSE_INVALID' }) }
  const exact = (value, allowed) => value && typeof value === 'object' && !Array.isArray(value)
    && !Object.keys(value).some(key => !allowed.includes(key))
  if (!boundedJsonWithin(data, MAX_RESPONSE_BYTES)) invalid()
  if (operation === 'claim') {
    if (data !== null) {
      if (!exact(data, ['jobId', 'executionId', 'claimantId', 'version', 'tenantId', 'businessId', 'accountId',
        'leaseExpiresAt', 'deadlineAt', 'correlationId', 'phase'])
        || typeof data.correlationId !== 'string' || !data.correlationId.trim() || data.correlationId.length > 128
        || !/^[A-Za-z0-9._:-]+$/.test(data.correlationId) || !['EXECUTION', 'DELIVERY'].includes(data.phase)) invalid()
      validateClaim(data)
    }
  } else if (operation === 'resolve') {
    if (!exact(data, ['authorized', 'scope', 'version']) || typeof data.authorized !== 'boolean'
      || !exact(data.scope, ['tenantId', 'businessId', 'accountId', 'identityId', 'identityVersion', 'identityState'])
      || ['tenantId', 'businessId', 'accountId'].some(key => typeof data.scope[key] !== 'string' || !data.scope[key])
      || !Number.isInteger(data.version) || data.version < 1) invalid()
    // @req FR-149 — a verified sender's scope names its identity; an unverified
    // sender's (Core's admission-time decision) names no person and says so.
    if (data.scope.identityState === undefined) {
      if (typeof data.scope.identityId !== 'string' || !data.scope.identityId
        || !Number.isInteger(data.scope.identityVersion) || data.scope.identityVersion < 1) invalid()
    } else if (data.scope.identityState !== 'UNVERIFIED' || data.scope.identityId !== null || data.scope.identityVersion !== null) invalid()
  } else if (operation === 'prepare') {
    if (!exact(data, ['question', 'evidence', 'slices', 'authorized', 'audienceKind', 'threadId', 'maxBudgetChars', 'workCommand', 'workReply',
      'turnKind', 'replyText', 'memorySync'])) invalid()
    try { validateTurnContext(data) } catch { invalid() }
  } else if (operation === 'credential') {
    if (!data || typeof data.provider !== 'string' || !data.provider.trim() || data.provider.length > 32
      || typeof data.model !== 'string' || !data.model.trim() || data.model.length > 200
      || typeof data.apiKey !== 'string' || !data.apiKey.trim() || data.apiKey.length > 4096
      || !exact(data, ['provider', 'model', 'apiKey', 'baseUrl'])
      || (data.baseUrl !== undefined && (typeof data.baseUrl !== 'string' || data.baseUrl.length > 2048))) invalid()
  } else if (operation === 'send') {
    if (!exact(data, ['id', 'status', 'acceptance'])
      || typeof data.id !== 'string' || !data.id.trim() || data.id.length > 128
      || !['RECORDED', 'ACCEPTED', 'UNKNOWN', 'FAILED', 'CANCELLED', 'CONTENDED', 'FENCED', 'STOPPED', 'READY', 'SENDING', 'MISSING'].includes(data.status)) invalid()
    if (data.acceptance !== undefined && (!data.acceptance || typeof data.acceptance !== 'object' || Array.isArray(data.acceptance)
      || !boundedJsonWithin(data.acceptance, 8 * 1024))) invalid()
  } else if (operation === 'memory') {
    if (!['COMPLETED', 'NOT_FOUND'].includes(data?.status) || typeof data.operationId !== 'string'
      || !data.operationId.trim() || data.operationId.length > 200 || !boundedJsonWithin(data, 60 * 1024)) invalid()
    if (data.status === 'NOT_FOUND' && !exact(data, ['status', 'operationId'])) invalid()
    if (data.status === 'COMPLETED') {
      const packet = data.result?.contextPacket
      const evidence = data.result?.evidence
      if (!exact(data, ['status', 'operationId', 'result']) || !exact(data.result, ['contextPacket', 'receipt', 'evidence'])
        || (evidence !== undefined && (!exact(evidence, ['records']) || !Array.isArray(evidence.records)
          || evidence.records.length > 64 || !boundedJsonWithin(evidence, 32 * 1024)))
        || !data.result.receipt || typeof data.result.receipt !== 'object' || Array.isArray(data.result.receipt)
        || Object.keys(data.result.receipt).length > 12
        || (packet !== undefined && packet !== null && (typeof packet !== 'object' || Array.isArray(packet)
          || packet.policyDecision !== 'ALLOW' || !boundedJsonWithin(packet, MAX_MEMORY_PACKET_BYTES)))) invalid()
    }
  } else if (operation === 'renew') {
    if (!exact(data, ['version', 'leaseExpiresAt']) || !Number.isInteger(data.version) || data.version < 1
      || typeof data.leaseExpiresAt !== 'string' || !Number.isFinite(Date.parse(data.leaseExpiresAt))) invalid()
  } else if (operation === 'status') {
    if (!exact(data, ['status', 'operationId', 'version', 'errorCode', 'executionId', 'text'])
      || typeof data.status !== 'string' || !data.status.trim() || data.status.length > 32
      || typeof data.operationId !== 'string' || !data.operationId.trim() || data.operationId.length > 200
      || (data.version !== undefined && (!Number.isInteger(data.version) || data.version < 1))
      || (data.errorCode !== undefined && data.errorCode !== null && (typeof data.errorCode !== 'string' || !data.errorCode.trim() || data.errorCode.length > 80))
      || (data.executionId !== undefined && (typeof data.executionId !== 'string' || !data.executionId.trim() || data.executionId.length > 128))
      || (data.text !== undefined && (typeof data.text !== 'string' || !data.text.trim() || data.text.length > 5000))) invalid()
  } else {
    if (!data || typeof data !== 'object' || Array.isArray(data)) invalid()
    if (operation === 'trace' && !exact(data, ['recorded'])) invalid()
    if (operation === 'trace' && data.recorded !== true) invalid()
    if (operation === 'complete' || operation === 'fail') {
      const allowed = operation === 'complete' ? ['id', 'status', 'version', 'operationId'] : ['id', 'status', 'version']
      if (!exact(data, allowed) || typeof data.status !== 'string' || !data.status.trim() || data.status.length > 32
        || !Number.isInteger(data.version) || data.version < 1
        || (data.id !== undefined && (typeof data.id !== 'string' || !data.id.trim() || data.id.length > 128))
        || (data.operationId !== undefined && (typeof data.operationId !== 'string' || !data.operationId.trim() || data.operationId.length > 200))) invalid()
    }
    if (operation === 'work-tool') validateWorkToolResult(payload, data, invalid)
  }
}

// @req FR-150 — a WorkTool response is accepted only in the exact v1 shape Core
// emits for the request that was sent: each operation has one receipt shape, and
// the receipt must name the proposal or job the request named. A drifted Core
// then fails here, in the runtime, rather than a malformed receipt reaching the
// turn (and its durable replay) unnoticed.
//   read            COMPLETED  { source: 'PROJECT_MANAGER', observedAt }
//   propose         COMPLETED  { proposalId: <claim job>, status: 'AWAITING_CONFIRMATION' }
//   confirm-execute COMPLETED  { proposalId, action, itemId, code, status, version, duplicate?: true }
//   status          COMPLETED  the propose receipt (for `<job>:work-proposal`) or the
//                              confirm-execute receipt without `duplicate`
//                   NOT_FOUND  { operationId } | { proposalId, receipt: { status: 'AWAITING_CONFIRMATION' } }
const bounded = (value, max) => typeof value === 'string' && value.trim().length > 0 && value.length <= max
const exactKeys = (value, keys) => value && typeof value === 'object' && !Array.isArray(value)
  && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key))

function validateWorkToolResult(request, data, invalid) {
  const claimJobId = request?.claim?.jobId
  const proposalReceipt = receipt => exactKeys(receipt, ['proposalId', 'status'])
    && receipt.status === 'AWAITING_CONFIRMATION' && bounded(receipt.proposalId, 128) && receipt.proposalId === claimJobId
  const executionReceipt = (receipt, proposalId, { duplicateAllowed }) => {
    const keys = ['proposalId', 'action', 'itemId', 'code', 'status', 'version']
    if (duplicateAllowed && receipt && Object.hasOwn(receipt, 'duplicate')) {
      if (receipt.duplicate !== true) return false
      keys.push('duplicate')
    }
    return exactKeys(receipt, keys) && receipt.proposalId === proposalId && bounded(receipt.proposalId, 128)
      && ['create_work', 'update_work'].includes(receipt.action) && bounded(receipt.itemId, 128) && bounded(receipt.code, 64)
      && typeof receipt.status === 'string' && /^[A-Z][A-Z_]{0,31}$/.test(receipt.status)
      && Number.isInteger(receipt.version) && receipt.version >= 1
  }
  const readReceipt = receipt => exactKeys(receipt, ['source', 'observedAt']) && receipt.source === 'PROJECT_MANAGER'
    && typeof receipt.observedAt === 'string' && receipt.observedAt.length <= 40 && Number.isFinite(Date.parse(receipt.observedAt))
  if (!data || typeof data !== 'object' || Array.isArray(data) || !boundedJsonWithin(data, 32 * 1024)) invalid()
  const operation = request?.operation
  // A Work domain refusal (W1): a final, non-retryable outcome that carries Core's legacy reply text.
  if (data.status === 'REJECTED') {
    if (!exactKeys(data, ['status', 'code', 'result']) || !WORK_REJECTION_CODES.includes(data.code)
      || !exactKeys(data.result, ['text']) || !bounded(data.result.text, 5000) || !data.result.text.trim()) invalid()
    return
  }
  if (data.status === 'COMPLETED') {
    if (!exactKeys(data, ['status', 'result']) || !exactKeys(data.result, ['text', 'receipt']) || !bounded(data.result.text, 5000)) invalid()
    const receipt = data.result.receipt
    const valid = operation === 'read' ? readReceipt(receipt)
      : operation === 'propose' ? proposalReceipt(receipt)
        : operation === 'confirm-execute' ? executionReceipt(receipt, request.input?.proposalId, { duplicateAllowed: true })
          : operation === 'status'
            ? (request.operationId === `${claimJobId}:work-proposal` ? proposalReceipt(receipt)
              : executionReceipt(receipt, request.input?.proposalId ?? request.operationId, { duplicateAllowed: false }))
            : false
    if (!valid) invalid()
    return
  }
  // Only a status probe can find nothing; every other operation either completes or fails.
  if (data.status !== 'NOT_FOUND' || operation !== 'status') invalid()
  const probed = request.input?.proposalId ?? request.operationId
  if (!(exactKeys(data, ['status', 'operationId']) && data.operationId === request.operationId)
    && !(exactKeys(data, ['status', 'proposalId', 'receipt']) && data.proposalId === probed && bounded(data.proposalId, 128)
      && exactKeys(data.receipt, ['status']) && data.receipt.status === 'AWAITING_CONFIRMATION')) invalid()
}
