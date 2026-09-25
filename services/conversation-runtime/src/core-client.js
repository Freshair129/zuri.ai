import { randomUUID } from 'node:crypto'
import { CONTRACT_VERSION, CORE_OPERATIONS, MAX_REQUEST_BYTES, validateCoreEnvelope, validateClaim, validateTurnContext } from './contracts.js'

// @req FR-149 — private core adapter for the independently running runtime.
// @spec ADR-106 D2-D4, SDD-108 — bearer-authenticated bounded operations.
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
    const body = JSON.stringify(envelope)
    if (Buffer.byteLength(body, 'utf8') > MAX_REQUEST_BYTES) throw new Error('CORE_REQUEST_TOO_LARGE')
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), timeoutMs)
    const abort = () => controller.abort(signal.reason)
    signal?.addEventListener('abort', abort, { once: true })
    try {
      const url = new URL(`/api/internal/conversation-runtime/v1/${operation}`, root)
      const response = await fetchFn(url, { method: 'POST', redirect: 'error', signal: controller.signal,
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', accept: 'application/json' }, body })
      if (!response.ok) throw Object.assign(new Error(`CORE_HTTP_${response.status}`), { code: `CORE_HTTP_${response.status}`, retryable: response.status >= 500 })
      const result = await boundedJson(response, MAX_REQUEST_BYTES)
      if (!result || result.contractVersion !== CONTRACT_VERSION || typeof result.ok !== 'boolean') throw new Error('CORE_RESPONSE_INVALID')
      if (!result.ok) throw Object.assign(new Error(result.error?.code || 'CORE_OPERATION_FAILED'), {
        code: result.error?.code || 'CORE_OPERATION_FAILED', retryable: result.error?.retryable === true,
      })
      if (Object.keys(result).some(key => !['contractVersion', 'ok', 'data'].includes(key)) || !Object.hasOwn(result, 'data')) {
        throw new Error('CORE_RESPONSE_INVALID')
      }
      validateOperationResult(operation, result.data)
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

function validateOperationResult(operation, data) {
  const invalid = () => { throw new Error('CORE_RESPONSE_INVALID') }
  const exact = (value, allowed) => value && typeof value === 'object' && !Array.isArray(value)
    && !Object.keys(value).some(key => !allowed.includes(key))
  if (operation === 'claim') {
    if (data !== null) {
      if (!exact(data, ['jobId', 'executionId', 'claimantId', 'version', 'tenantId', 'businessId', 'accountId',
        'leaseExpiresAt', 'deadlineAt', 'correlationId', 'phase'])) invalid()
      validateClaim(data)
    }
  } else if (operation === 'resolve') {
    if (!exact(data, ['authorized', 'scope', 'version']) || typeof data.authorized !== 'boolean'
      || !exact(data.scope, ['tenantId', 'businessId', 'accountId', 'identityId', 'identityVersion'])
      || ['tenantId', 'businessId', 'accountId', 'identityId'].some(key => typeof data.scope[key] !== 'string' || !data.scope[key])
      || !Number.isInteger(data.scope.identityVersion) || !Number.isInteger(data.version)) invalid()
  } else if (operation === 'prepare') {
    if (!exact(data, ['question', 'evidence', 'slices', 'authorized', 'audienceKind', 'threadId', 'maxBudgetChars', 'workCommand'])) invalid()
    try { validateTurnContext(data) } catch { invalid() }
  } else if (operation === 'credential') {
    if (!data || typeof data.provider !== 'string' || typeof data.model !== 'string' || typeof data.apiKey !== 'string'
      || data.apiKey.length > 4096 || !exact(data, ['provider', 'model', 'apiKey', 'baseUrl'])) invalid()
  } else if (operation === 'send') {
    if (!exact(data, ['id', 'status', 'acceptance'])
      || typeof data.id !== 'string' || !data.id
      || !['RECORDED', 'ACCEPTED', 'UNKNOWN', 'FAILED', 'CANCELLED', 'CONTENDED', 'FENCED', 'STOPPED', 'READY', 'SENDING'].includes(data.status)) invalid()
  } else if (operation === 'renew') {
    if (!exact(data, ['version', 'leaseExpiresAt']) || !Number.isInteger(data.version) || !Number.isFinite(Date.parse(data.leaseExpiresAt))) invalid()
  } else if (operation === 'status') {
    if (!exact(data, ['status', 'operationId', 'version', 'errorCode', 'executionId', 'text'])
      || typeof data.status !== 'string' || typeof data.operationId !== 'string'
      || Buffer.byteLength(JSON.stringify(data), 'utf8') > MAX_REQUEST_BYTES) invalid()
  } else {
    if (!data || typeof data !== 'object' || Array.isArray(data)
      || Buffer.byteLength(JSON.stringify(data), 'utf8') > MAX_REQUEST_BYTES) invalid()
    if (operation === 'trace' && !exact(data, ['recorded'])) invalid()
    if (operation === 'trace' && data.recorded !== true) invalid()
    if (operation === 'complete' || operation === 'fail') {
      const allowed = operation === 'complete' ? ['id', 'status', 'version', 'operationId'] : ['id', 'status', 'version']
      if (!exact(data, allowed) || typeof data.status !== 'string' || !Number.isInteger(data.version)
        || (data.id !== undefined && typeof data.id !== 'string')
        || (data.operationId !== undefined && typeof data.operationId !== 'string')) invalid()
    }
    if (operation === 'work-tool') {
      if (!['COMPLETED', 'NOT_FOUND'].includes(data.status)) invalid()
      if (data.status === 'COMPLETED') {
        if (!exact(data, ['status', 'result']) || !exact(data.result, ['text', 'receipt'])
          || typeof data.result.text !== 'string' || data.result.text.length > 5000
          || !data.result.receipt || typeof data.result.receipt !== 'object' || Array.isArray(data.result.receipt)
          || Object.keys(data.result.receipt).length > 12
          || Buffer.byteLength(JSON.stringify(data.result), 'utf8') > MAX_REQUEST_BYTES) invalid()
      } else if (!exact(data, ['status', 'operationId', 'proposalId', 'receipt'])
        || (data.operationId !== undefined && typeof data.operationId !== 'string')
        || (data.proposalId !== undefined && typeof data.proposalId !== 'string')
        || (data.receipt !== undefined && (!data.receipt || typeof data.receipt !== 'object' || Array.isArray(data.receipt)))) invalid()
    }
  }
}
