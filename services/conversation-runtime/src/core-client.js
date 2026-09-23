import { randomUUID } from 'node:crypto'
import { CONTRACT_VERSION, CORE_OPERATIONS, MAX_REQUEST_BYTES, validateCoreEnvelope } from './contracts.js'

// @req FR-149 — private core adapter for the independently running runtime.
// @spec ADR-106 D2-D4, SDD-108 — bearer-authenticated bounded operations.
// @tested services/conversation-runtime/test/contracts.test.js
const text = (value, max, code) => {
  if (typeof value !== 'string' || !value.trim() || value.length > max) throw Object.assign(new Error(code), { code })
  return value
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
      const result = await response.json()
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
      const value = await response.json()
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
  if (operation === 'claim') {
    if (data !== null && (!data || typeof data !== 'object' || !Number.isInteger(data.version)
      || typeof data.jobId !== 'string' || typeof data.executionId !== 'string')) invalid()
  } else if (operation === 'resolve') {
    if (typeof data?.authorized !== 'boolean' || !data.scope || typeof data.version !== 'number') invalid()
  } else if (operation === 'prepare') {
    if (!data || typeof data.question !== 'string' || !Array.isArray(data.evidence) || !Array.isArray(data.slices)) invalid()
  } else if (operation === 'credential') {
    if (!data || typeof data.provider !== 'string' || typeof data.model !== 'string' || typeof data.apiKey !== 'string') invalid()
  } else if (operation === 'send') {
    if (!data || !['RECORDED', 'ACCEPTED', 'UNKNOWN', 'FAILED', 'CANCELLED', 'CONTENDED'].includes(data.status)) invalid()
  } else if (operation === 'renew') {
    if (!data || !Number.isInteger(data.version) || typeof data.leaseExpiresAt !== 'string') invalid()
  } else if (data === null || typeof data !== 'object') invalid()
}
