import { z } from 'zod'
import { zGrant } from './delegation.js'

// HTTP adapter for the core-owned façade SCM consumes (contracts/v1/scm-core.v1.json,
// PROPOSED; mirrors the Market service's market-core.v1, ADR-108). Core stays the
// ONLY identity authority: SCM authenticates itself with its own static bearer
// (SCM_CORE_TOKEN) and forwards the end user's credential opaquely in
// `x-zuri-subject`, so the two can never be confused. The subject is never logged,
// stored, echoed in an error or sent anywhere but core.
//
// Operations (all POST + JSON body + subject header, all idempotent reads):
//   resolve-scope  {}                              → {actorId, tenantId, grants{businessId:{owner,domains,permissions}}}
//   branch         {businessId, branchId}          → {fact: Branch | null}
//   branches       {businessId}                    → {branches: Branch+[]}
//   customer       {businessId, customerId}        → {fact: Customer | null}
//   conversation   {businessId, conversationId}    → {fact: Conversation | null}
// Fact shapes are exactly the ReferenceAuthority port's (reference-authority.js);
// core re-resolves the subject on EVERY call and answers null for a Business the
// subject cannot see (non-enumeration), and SCM still applies its own predicate.
//
// Failure is closed: an unreachable, timed-out, 5xx, malformed, unknown-field or
// oversized answer is 503 SCM_CORE_UNAVAILABLE (retryable, no effect), never an
// allow and never a cached decision. Every operation is a read, so each is retried
// once by default with a jittered backoff — except an oversized answer, which is
// deterministic. Core's refusals are NOT retried:
//   401 {error:{code:'SUBJECT_UNAUTHENTICATED'}} → 401 SCM_SUBJECT_UNAUTHENTICATED (the user's
//        session is missing/expired/revoked: a user-facing refusal, the BFF re-authenticates)
//   any other 401 (e.g. SERVICE_TOKEN_INVALID), 403 or 4xx → 502 SCM_CORE_REJECTED (the
//        SERVICE is misconfigured or out of contract: an operator fault, not a user refusal)

export const CORE_CONTRACT_VERSION = 'scm-core.v1'
export const SUBJECT_HEADER = 'x-zuri-subject'
export const SUBJECT_MAX_LENGTH = 4096
const BASE_PATH = '/api/internal/scm/v1'
export const RESPONSE_LIMITS = Object.freeze({ 'resolve-scope': 1024 * 1024, branches: 1024 * 1024, default: 16 * 1024, refusal: 4 * 1024 })
export const MAX_GRANTS = 500
export const MAX_BRANCHES = 1000

const id = z.string().min(1).max(200)
const code = z.string().min(1).max(200)
const name = z.string().max(500)
const status = z.string().min(1).max(64)
const instant = z.string().min(1).max(64)

const zScope = z.object({
  actorId: id,
  tenantId: id,
  grants: z.record(id, zGrant).refine((g) => Object.keys(g).length <= MAX_GRANTS, `at most ${MAX_GRANTS} Businesses per scope`),
}).strict()
const zBranch = z.object({ id, code, name, tenantId: id, businessId: id, status }).strict()
const zBranchRow = z.object({ id, code, name, address: z.string().max(2000).nullable(), kind: z.string().min(1).max(64), status, tenantId: id, businessId: id }).strict()
const zCustomer = z.object({ id, code, tenantId: id, businessId: id.nullable(), deletedAt: instant.nullable() }).strict()
const zConversation = z.object({ id, tenantId: id, businessId: id.nullable(), customerId: id.nullable() }).strict()
const fact = (shape) => z.object({ fact: shape.nullable() }).strict()

const OPERATIONS = Object.freeze({
  'resolve-scope': zScope,
  branch: fact(zBranch),
  branches: z.object({ branches: z.array(zBranchRow).max(MAX_BRANCHES) }).strict(),
  customer: fact(zCustomer),
  conversation: fact(zConversation),
})

export class CoreUnavailable extends Error {
  constructor(reason) {
    super('core authority is unavailable')
    this.name = 'CoreUnavailable'
    this.status = 503
    this.code = 'SCM_CORE_UNAVAILABLE'
    this.retryable = true
    this.reason = reason
  }
}

const rejected = (httpStatus) => Object.assign(new Error('core rejected the SCM service request'), { status: 502, code: 'SCM_CORE_REJECTED', retryable: false, reason: `HTTP_${httpStatus}` })
const unauthenticated = () => Object.assign(new Error('subject is not authenticated'), { status: 401, code: 'SCM_SUBJECT_UNAUTHENTICATED', retryable: false })
export const subjectRequired = () => Object.assign(new Error('subject required'), { status: 401, code: 'SCM_SUBJECT_REQUIRED', retryable: false })

export function validSubject(subject) {
  return typeof subject === 'string' && subject.length > 0 && subject.length <= SUBJECT_MAX_LENGTH
}

async function readJsonBounded(response, maxBytes) {
  const declared = Number(response.headers?.get?.('content-length'))
  if (Number.isFinite(declared) && declared > maxBytes) {
    await response.body?.cancel?.().catch(() => {})
    throw new CoreUnavailable('RESPONSE_TOO_LARGE')
  }
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

/** A core 401 is the subject's refusal only when core says so in its error body. */
async function refusalOf(response) {
  if (response.status !== 401) return rejected(response.status)
  try {
    const body = await readJsonBounded(response, RESPONSE_LIMITS.refusal)
    return body?.error?.code === 'SUBJECT_UNAUTHENTICATED' ? unauthenticated() : rejected(401)
  } catch {
    return rejected(401)
  }
}

export function createScmCoreClient({
  baseUrl,
  token,
  fetchFn = fetch,
  timeoutMs = 3000,
  retries = 1,
  backoffMs = 100,
  random = Math.random,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
} = {}) {
  // Names only in these messages — never the value.
  if (typeof token !== 'string' || token.length < 32) throw Object.assign(new Error('SCM_CORE_TOKEN must be at least 32 characters'), { code: 'SCM_CONFIG_INVALID' })
  let root
  try { root = new URL(baseUrl) } catch { throw Object.assign(new Error('SCM_CORE_URL is invalid'), { code: 'SCM_CONFIG_INVALID' }) }
  if (!['http:', 'https:'].includes(root.protocol) || root.username || root.password || root.search || root.hash) {
    throw Object.assign(new Error('SCM_CORE_URL is invalid'), { code: 'SCM_CONFIG_INVALID' })
  }
  const prefix = root.pathname.replace(/\/+$/, '')

  async function once(operation, subject, body) {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    try {
      const response = await fetchFn(new URL(`${prefix}${BASE_PATH}/${operation}`, root), {
        method: 'POST',
        headers: { authorization: `Bearer ${token}`, accept: 'application/json', 'content-type': 'application/json', [SUBJECT_HEADER]: subject },
        body: JSON.stringify(body),
        redirect: 'error',
        signal: controller.signal,
      })
      if (response.status >= 500) {
        await response.body?.cancel?.().catch(() => {})
        throw new CoreUnavailable(`HTTP_${response.status}`)
      }
      if (!response.ok) throw await refusalOf(response)
      const envelope = await readJsonBounded(response, RESPONSE_LIMITS[operation] ?? RESPONSE_LIMITS.default)
      if (!envelope || typeof envelope !== 'object' || envelope.contractVersion !== CORE_CONTRACT_VERSION || envelope.ok !== true || !Object.hasOwn(envelope, 'data')) {
        throw new CoreUnavailable('RESPONSE_INVALID')
      }
      const parsed = OPERATIONS[operation].safeParse(envelope.data)
      if (!parsed.success) throw new CoreUnavailable('RESPONSE_INVALID')
      return parsed.data
    } catch (error) {
      if (error instanceof CoreUnavailable || error?.code === 'SCM_CORE_REJECTED' || error?.code === 'SCM_SUBJECT_UNAUTHENTICATED') throw error
      // Anything else — a refused redirect, DNS, reset, abort — is an unreachable core.
      throw new CoreUnavailable(error?.name === 'AbortError' ? 'TIMEOUT' : 'NETWORK')
    } finally {
      clearTimeout(timer)
    }
  }

  async function call(operation, subject, body) {
    if (!validSubject(subject)) throw subjectRequired()
    let lastError
    for (let attempt = 0; attempt <= retries; attempt += 1) {
      try {
        return await once(operation, subject, body)
      } catch (error) {
        lastError = error
        if (!(error instanceof CoreUnavailable) || error.reason === 'RESPONSE_TOO_LARGE' || attempt === retries) break
        await sleep(Math.round(backoffMs * (attempt + 1) * (0.5 + random())))
      }
    }
    throw lastError
  }

  return {
    contractVersion: CORE_CONTRACT_VERSION,
    resolveScope: (subject) => call('resolve-scope', subject, {}),
    branch: (subject, { businessId, branchId }) => call('branch', subject, { businessId, branchId }).then((d) => d.fact),
    branches: (subject, { businessId }) => call('branches', subject, { businessId }).then((d) => d.branches),
    customer: (subject, { businessId, customerId }) => call('customer', subject, { businessId, customerId }).then((d) => d.fact),
    conversation: (subject, { businessId, conversationId }) => call('conversation', subject, { businessId, conversationId }).then((d) => d.fact),
  }
}
