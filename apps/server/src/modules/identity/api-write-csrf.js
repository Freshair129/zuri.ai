import { createHash, createHmac, timingSafeEqual } from 'node:crypto'
import { z } from 'zod'
import { AUTH_SESSION_COOKIE, requireSessionSecret } from './auth-service'
import { readRequestCookie } from './session-port'

// @req FR-252 — P2 API-write CSRF is a distinct, live-session-bound Identity
// token; plugin-consent tokens cannot authorize Project Manager mutations.
// @spec ADR-097
// @tested tests/unit/identity/api-write-csrf.test.js

export const API_WRITE_CSRF_AUDIENCE = 'zuri_api_write.v1'
export const API_WRITE_CSRF_TTL_SECONDS = 15 * 60
export const zApiWriteCsrfToken = z.object({
  token: z.string().min(1),
  expiresAt: z.string().datetime({ offset: true }),
}).strict()
export const zApiWriteCsrfError = z.object({
  code: z.string().min(1),
  message: z.string().min(1),
  requestId: z.string().uuid(),
  retryable: z.boolean(),
}).strict()

const TOKEN_PREFIX = 'zuri_api_csrf'
const TOKEN_VERSION = 1
const MAX_TOKEN_LENGTH = 4096

export class ApiWriteCsrfError extends Error {
  constructor(code, status, retryable = false) {
    super(code)
    this.name = 'ApiWriteCsrfError'
    this.code = code
    this.status = status
    this.retryable = retryable
  }
}

function authRequired() {
  return new ApiWriteCsrfError('AUTH_REQUIRED', 401, false)
}

function csrfInvalid() {
  return new ApiWriteCsrfError('CSRF_INVALID', 403, false)
}

function sessionUnavailable() {
  return new ApiWriteCsrfError('SESSION_UNAVAILABLE', 503, true)
}

function encode(payload) {
  return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url')
}

function decode(value) {
  try {
    const decoded = JSON.parse(Buffer.from(value, 'base64url').toString('utf8'))
    return decoded && typeof decoded === 'object' && !Array.isArray(decoded) ? decoded : null
  } catch {
    return null
  }
}

function sign(value, secret) {
  return createHmac('sha256', secret).update(value, 'utf8').digest('base64url')
}

function constantTimeEqual(left, right) {
  if (typeof left !== 'string' || typeof right !== 'string') return false
  const leftBuffer = Buffer.from(left, 'utf8')
  const rightBuffer = Buffer.from(right, 'utf8')
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer)
}

function header(request, name) {
  if (typeof request?.headers?.get === 'function') return request.headers.get(name)
  if (!request?.headers || typeof request.headers !== 'object') return null
  return request.headers[name] ?? request.headers[name.toLowerCase()] ?? null
}

function configuredOrigin(env) {
  const raw = typeof env?.PUBLIC_BASE_URL === 'string' ? env.PUBLIC_BASE_URL.trim() : ''
  if (!raw) throw sessionUnavailable()

  try {
    const url = new URL(raw)
    if (
      (url.protocol !== 'http:' && url.protocol !== 'https:') ||
      url.username ||
      url.password ||
      url.pathname !== '/' ||
      url.search ||
      url.hash
    ) throw new Error('invalid origin')
    return url.origin
  } catch {
    throw sessionUnavailable()
  }
}

function sessionExpiryMilliseconds(value) {
  if (value instanceof Date) {
    const milliseconds = value.getTime()
    return Number.isFinite(milliseconds) ? milliseconds : null
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value < 1_000_000_000_000 ? value * 1000 : value
  }
  if (typeof value === 'string' && value.trim()) {
    const milliseconds = Date.parse(value)
    return Number.isFinite(milliseconds) ? milliseconds : null
  }
  return null
}

function authenticatedSession(session, request, now) {
  if (!session || session.state !== 'AUTHENTICATED') throw authRequired()

  if (typeof session.sessionId !== 'string' || !session.sessionId.trim() || session.sessionId.startsWith('legacy-')) {
    throw sessionUnavailable()
  }
  const expiry = sessionExpiryMilliseconds(session.expiresAt)
  if (expiry == null) throw sessionUnavailable()
  if (expiry <= now) throw authRequired()

  const cookie = readRequestCookie(request, AUTH_SESSION_COOKIE)
  if (!cookie) throw authRequired()

  return { expiry, cookie }
}

function requireSecret(env) {
  try {
    return requireSessionSecret(env)
  } catch {
    throw sessionUnavailable()
  }
}

export function assertApiWriteCsrfConfiguration({ env = process.env } = {}) {
  configuredOrigin(env)
  requireSecret(env)
  return true
}

function assertIssuerOrigin(request, env) {
  const expected = configuredOrigin(env)
  const supplied = header(request, 'origin')
  if (supplied != null && supplied !== '') {
    if (supplied !== expected) throw csrfInvalid()
    return
  }

  const fetchSite = header(request, 'sec-fetch-site')
  if (typeof fetchSite === 'string' && fetchSite.toLowerCase() === 'same-origin') return

  const referer = header(request, 'referer')
  if (typeof referer === 'string' && referer) {
    try {
      if (new URL(referer).origin === expected) return
    } catch {
      // Fall through to the redacted CSRF refusal.
    }
  }

  throw csrfInvalid()
}

function assertMutationOrigin(request, env) {
  const expected = configuredOrigin(env)
  const supplied = header(request, 'origin')
  if (typeof supplied !== 'string' || supplied !== expected) throw csrfInvalid()
}

function sessionProof(session, request, now) {
  const proof = authenticatedSession(session, request, now)
  const expirySeconds = Math.floor(proof.expiry / 1000)
  const nowSeconds = Math.floor(now / 1000)
  if (expirySeconds <= nowSeconds) throw authRequired()
  return { ...proof, expirySeconds, nowSeconds }
}

/**
 * Issue a readable, short-lived token for the current browser session. The
 * caller supplies the result of a fresh session-port read; the module still
 * reads the same cookie through the shared reader to bind the token exactly.
 */
export function issueApiWriteCsrfToken({ request, session, env = process.env, now = Date.now() } = {}) {
  const proof = sessionProof(session, request, now)
  assertIssuerOrigin(request, env)
  const secret = requireSecret(env)
  const issuedAt = Math.floor(now / 1000)
  const expiresAt = Math.min(issuedAt + API_WRITE_CSRF_TTL_SECONDS, proof.expirySeconds)
  if (expiresAt <= issuedAt) throw authRequired()

  const payload = encode({
    v: TOKEN_VERSION,
    aud: API_WRITE_CSRF_AUDIENCE,
    session_binding: createHash('sha256').update(proof.cookie, 'utf8').digest('hex'),
    iat: issuedAt,
    exp: expiresAt,
  })

  return zApiWriteCsrfToken.parse({
    token: `${TOKEN_PREFIX}.${payload}.${sign(payload, secret)}`,
    expiresAt: new Date(expiresAt * 1000).toISOString(),
  })
}

/**
 * Verify an API-write token against a fresh live session proof and request.
 * PM mutation routes must call this before parsing or validating a request body.
 */
export function assertApiWriteCsrfToken({ request, token, session, env = process.env, now = Date.now() } = {}) {
  const proof = sessionProof(session, request, now)
  assertMutationOrigin(request, env)
  const secret = requireSecret(env)

  if (typeof token !== 'string' || token.length > MAX_TOKEN_LENGTH) throw csrfInvalid()
  const parts = token.split('.')
  if (parts.length !== 3) throw csrfInvalid()
  const [prefix, encodedPayload, signature] = parts
  if (prefix !== TOKEN_PREFIX || !encodedPayload || !signature) throw csrfInvalid()
  if (!constantTimeEqual(signature, sign(encodedPayload, secret))) throw csrfInvalid()

  const claims = decode(encodedPayload)
  if (
    !claims ||
    claims.v !== TOKEN_VERSION ||
    claims.aud !== API_WRITE_CSRF_AUDIENCE ||
    !Number.isInteger(claims.iat) ||
    !Number.isInteger(claims.exp) ||
    claims.iat > proof.nowSeconds ||
    claims.exp <= proof.nowSeconds ||
    claims.exp <= claims.iat ||
    claims.exp - claims.iat > API_WRITE_CSRF_TTL_SECONDS ||
    claims.exp > proof.expirySeconds
  ) throw csrfInvalid()

  const binding = createHash('sha256').update(proof.cookie, 'utf8').digest('hex')
  if (!constantTimeEqual(String(claims.session_binding ?? ''), binding)) throw csrfInvalid()
  return true
}
