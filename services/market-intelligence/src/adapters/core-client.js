// HTTP adapter for the core-owned ports the Market service consumes (ADR-108 D4):
// ScopeAuthorityPort, RawEvidenceReadPort, AuditPort, and the execution-ownership
// gate. Core stays the single identity authority. The service authenticates itself
// with its own bearer token and forwards the end user's credential opaquely in a
// separate header, so the two can never be confused. The subject is never logged,
// stored or sent anywhere but core.
//
// Failure is closed: an unreachable, timed-out or malformed core is CORE_UNAVAILABLE
// (503), never an allow and never a cached decision. Only the idempotent reads
// (authorize, raw candidates, ownership, health) retry, with a small jittered
// backoff; the audit append is not retried here.
//
// Every response is read under a byte cap (RESPONSE_LIMITS) and every raw record is
// validated field by field before the core sees it: a core that returns more bytes,
// unknown fields or wrong types is RESPONSE_INVALID / RESPONSE_TOO_LARGE, never a
// partially trusted list (S1 review of 85d8fd06, finding 1).
// @req FR-092, NFR-018
// @spec BR-001, SEC-001, SEC-017, SDD-049, ADR-108
// @tested services/market-intelligence/test/core-client.test.js,
//   services/market-intelligence/test/http-api.test.js

import { z } from 'zod'

export const CORE_CONTRACT_VERSION = 'market-core.v1'
export const SUBJECT_HEADER = 'x-zuri-subject'
const BASE_PATH = '/api/internal/market-intelligence/v1'
// Core caps a raw-candidates body at 8 MiB and a single payload at 256 KiB; the
// consumer allows envelope overhead on top and nothing more.
export const RAW_PAYLOAD_MAX_BYTES = 256 * 1024
export const RESPONSE_LIMITS = Object.freeze({ rawCandidates: 9 * 1024 * 1024, default: 64 * 1024 })

const id = z.string().min(1).max(200)
const text = z.string().max(2048)
const zRawRecord = z.object({
  id,
  tenantId: id,
  businessId: id.nullable(),
  connectionId: id.nullable().optional(),
  provider: text.nullable().optional(),
  lane: text.nullable().optional(),
  entityType: text.nullable().optional(),
  externalId: text.nullable().optional(),
  sourceType: text.nullable().optional(),
  sourceUri: text.nullable().optional(),
  schemaVersion: text.nullable().optional(),
  payloadJson: z.string().max(RAW_PAYLOAD_MAX_BYTES).nullable(),
  payloadHash: text,
  receivedAt: z.string().max(64).nullable().optional(),
  omitted: z.literal('PAYLOAD_TOO_LARGE').optional(),
}).strict()
const zRawCandidates = z.object({ records: z.array(zRawRecord).max(500), truncated: z.boolean().optional() }).strict()

async function readJsonBounded(response, maxBytes) {
  const declared = Number(response.headers?.get?.('content-length'))
  if (Number.isFinite(declared) && declared > maxBytes) throw new CoreUnavailable('RESPONSE_TOO_LARGE')
  const chunks = []
  let total = 0
  if (response.body) {
    const reader = response.body.getReader()
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      total += value.byteLength
      if (total > maxBytes) {
        await reader.cancel().catch(() => {})
        throw new CoreUnavailable('RESPONSE_TOO_LARGE')
      }
      chunks.push(Buffer.from(value))
    }
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'))
  } catch {
    throw new CoreUnavailable('RESPONSE_INVALID')
  }
}

export class CoreUnavailable extends Error {
  constructor(reason) {
    super('Core authority is unavailable')
    this.name = 'CoreUnavailable'
    this.status = 503
    this.code = 'CORE_UNAVAILABLE'
    this.reason = reason
  }
}

function requireSubject(actor) {
  const subject = actor?.subject
  if (typeof subject !== 'string' || !subject || subject.length > 8192) {
    throw Object.assign(new Error('AUTH_REQUIRED'), { status: 401 })
  }
  return subject
}

function reviveRawRecord(record) {
  if (!record || typeof record !== 'object') return record
  return { ...record, receivedAt: record.receivedAt ? new Date(record.receivedAt) : record.receivedAt ?? null }
}

export function createCoreClient({
  baseUrl,
  token,
  fetchFn = fetch,
  timeoutMs = 5000,
  retries = 2,
  backoffMs = 100,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  random = Math.random,
} = {}) {
  if (typeof token !== 'string' || token.length < 32) throw new Error('MARKET_CORE_TOKEN must be at least 32 characters')
  const root = new URL(baseUrl)
  if (!['http:', 'https:'].includes(root.protocol) || root.username || root.password || root.search || root.hash) {
    throw new Error('MARKET_CORE_URL is invalid')
  }

  async function once(method, path, { subject, body, maxBytes = RESPONSE_LIMITS.default } = {}) {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    try {
      const headers = { authorization: `Bearer ${token}`, accept: 'application/json' }
      if (subject) headers[SUBJECT_HEADER] = subject
      if (body !== undefined) headers['content-type'] = 'application/json'
      const response = await fetchFn(new URL(`${BASE_PATH}${path}`, root), {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        redirect: 'error',
        signal: controller.signal,
      })
      if (response.status >= 500) throw new CoreUnavailable(`HTTP_${response.status}`)
      if (!response.ok) {
        // 401/403 from core means the SERVICE is not authorized (bad token or
        // unrecognized subject). That is a fault to surface, not a user refusal.
        throw Object.assign(new Error(`Core rejected the Market service request (${response.status})`), { status: 502, code: 'CORE_REJECTED' })
      }
      const envelope = await readJsonBounded(response, maxBytes)
      if (envelope?.contractVersion !== CORE_CONTRACT_VERSION || envelope.ok !== true || !Object.hasOwn(envelope, 'data')) {
        throw new CoreUnavailable('RESPONSE_INVALID')
      }
      return envelope.data
    } catch (error) {
      if (error instanceof CoreUnavailable || error?.code === 'CORE_REJECTED') throw error
      throw new CoreUnavailable(error?.name === 'AbortError' ? 'TIMEOUT' : 'NETWORK')
    } finally {
      clearTimeout(timer)
    }
  }

  async function withRetry(call) {
    let lastError
    for (let attempt = 0; attempt <= retries; attempt += 1) {
      try {
        return await call()
      } catch (error) {
        lastError = error
        // An oversized answer is deterministic: fetching it again only costs another 9 MiB.
        if (!(error instanceof CoreUnavailable) || error.reason === 'RESPONSE_TOO_LARGE' || attempt === retries) break
        await sleep(Math.round(backoffMs * (attempt + 1) * (0.5 + random())))
      }
    }
    throw lastError
  }

  const scopeAuthority = {
    async authorize({ actor, businessId, action }) {
      const subject = requireSubject(actor)
      return withRetry(() => once('POST', '/authorize', { subject, body: { businessId, action } }))
    },
  }

  const rawEvidence = {
    // Called only after authorize() returned this exact scope. Core re-checks the
    // subject against it; the service still re-checks every returned row.
    async listMarketCandidates({ tenantId, businessId, scanLimit, subject }) {
      const data = await withRetry(() => once('POST', '/raw-candidates', {
        subject,
        body: { tenantId, businessId, scanLimit },
        maxBytes: RESPONSE_LIMITS.rawCandidates,
      }))
      const parsed = zRawCandidates.safeParse(data)
      if (!parsed.success) throw new CoreUnavailable('RESPONSE_INVALID')
      return parsed.data.records.map(reviveRawRecord)
    },
  }

  const audit = {
    async record(event) {
      await once('POST', '/audit', { body: event })
    },
  }

  return {
    scopeAuthority,
    rawEvidence,
    audit,
    async executionOwnership() {
      const data = await withRetry(() => once('GET', '/execution-ownership'))
      return { ownsTranslation: data?.ownsTranslation === true }
    },
    async health() {
      const data = await withRetry(() => once('GET', '/health'))
      return { ok: data?.ok === true, mode: typeof data?.mode === 'string' ? data.mode : 'unknown' }
    },
  }
}
