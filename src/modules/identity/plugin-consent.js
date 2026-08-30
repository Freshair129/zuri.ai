import { createHash, createHmac, timingSafeEqual } from 'node:crypto'
import { AUTH_SESSION_COOKIE, requireSessionSecret } from './auth-service'
import { readRequestCookie } from './session-port'
import { PluginAuthError, assertPluginAuthorizeParameters } from './plugin-auth-service'

// @req FR-123 — the consent gate's two tokens. `GET /api/plugin/auth/authorize`
// no longer mints; it hands the browser a consent screen, and only a POST from
// that screen mints. This module is what makes that POST safe to act on.
// @spec ADR-052 D4, SDD-074, SEC-022
// @tested tests/unit/fr123-plugin-consent.test.js
//
// WHY TWO TOKENS AND NOT ONE
// --------------------------
// The anti-CSRF token answers "did this POST come from a form this server
// rendered for this session". The signed request token answers "are these the
// same parameters the person actually read on that screen". They are different
// questions and a single value cannot answer both: a CSRF token that also
// carried the parameters would have to be minted per parameter set, and a
// parameter token alone would be replayable from any origin that could get a
// copy of it.
//
// WHY THE CSRF TOKEN EXISTS AT ALL, GIVEN SameSite=Lax
// ----------------------------------------------------
// `zuri_session` is set `sameSite: 'lax'` (src/app/api/auth/login/route.js), and
// Lax already withholds the cookie from a cross-site POST, so today the CSRF
// token is the second of two locks on the same door. It is here on purpose: the
// cookie attribute is a browser default that one unrelated edit — someone
// needing `SameSite=None` for an embed, a framework upgrade changing a default —
// would silently remove, and the consent gate would go back to being bypassable
// with nothing failing. A defence that lives entirely in another file's cookie
// options is a defence nobody will notice losing. This one fails loudly.
//
// Neither token is stored. Both are HMACs over `ZURI_SESSION_SECRET`, so the
// gate needs no new table and no production DDL — deliberately, because the
// boundary is inert in production and this had to close without a migration.

const CSRF_PREFIX = 'zuri_pcsrf'
const REQUEST_PREFIX = 'zuri_pcreq'
const CONSENT_VERSION = 1

export const PLUGIN_CONSENT_REQUEST_TTL_SECONDS = 5 * 60

const invalidRequest = () => new PluginAuthError('INVALID_REQUEST', 400)

function sign(value, secret) {
  return createHmac('sha256', secret).update(value, 'utf8').digest('base64url')
}

function constantTimeEqual(left, right) {
  if (typeof left !== 'string' || typeof right !== 'string') return false
  const leftBuffer = Buffer.from(left, 'utf8')
  const rightBuffer = Buffer.from(right, 'utf8')
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer)
}

/**
 * The value both tokens are bound to: a digest of the exact session cookie.
 *
 * The cookie rather than the session id, because the id is not on the request —
 * reading it would mean a second verify-and-database-read, and the digest is
 * strictly narrower anyway: it changes when the person logs out and back in,
 * so a token minted for a previous session is refused even where the session id
 * were reused. Never the cookie itself, so no token ever carries session
 * material a page or a log could recover.
 */
export function pluginConsentSessionBinding(sessionCookieValue) {
  if (typeof sessionCookieValue !== 'string' || !sessionCookieValue) throw new PluginAuthError('AUTH_REQUIRED', 401)
  return createHash('sha256').update(sessionCookieValue, 'utf8').digest('hex')
}

export function pluginConsentSessionBindingFromRequest(request) {
  return pluginConsentSessionBinding(readRequestCookie(request, AUTH_SESSION_COOKIE))
}

export function issuePluginConsentCsrfToken({ sessionBinding, env = process.env, secret } = {}) {
  if (typeof sessionBinding !== 'string' || !sessionBinding) throw new PluginAuthError('AUTH_REQUIRED', 401)
  return `${CSRF_PREFIX}.${sign(`${CSRF_PREFIX}:${sessionBinding}`, secret ?? requireSessionSecret(env))}`
}

export function assertPluginConsentCsrfToken({ token, sessionBinding, env = process.env, secret } = {}) {
  const expected = issuePluginConsentCsrfToken({ sessionBinding, env, secret })
  if (!constantTimeEqual(String(token ?? ''), expected)) throw invalidRequest()
  return true
}

function encode(payload) {
  return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url')
}

function decode(value) {
  try {
    const payload = JSON.parse(Buffer.from(value, 'base64url').toString('utf8'))
    return payload && typeof payload === 'object' && !Array.isArray(payload) ? payload : null
  } catch {
    return null
  }
}

/**
 * Sign the exact authorization parameters the consent screen is about to show.
 *
 * `parameters` must already have been through `assertPluginAuthorizeParameters`.
 * Every field the mint will use is inside the signature — including
 * `installation_id`, which the brief's field list omitted but the minting
 * service requires and binds the code to; leaving it out would have left one
 * parameter the POST could still be handed differently from the one displayed.
 */
export function signPluginConsentRequest({
  parameters,
  principalId,
  sessionBinding,
  env = process.env,
  secret,
  now = Date.now(),
  ttlSeconds = PLUGIN_CONSENT_REQUEST_TTL_SECONDS,
} = {}) {
  if (typeof principalId !== 'string' || !principalId.trim()) throw new PluginAuthError('AUTH_REQUIRED', 401)
  if (typeof sessionBinding !== 'string' || !sessionBinding) throw new PluginAuthError('AUTH_REQUIRED', 401)
  if (!parameters || typeof parameters !== 'object') throw invalidRequest()

  const payload = encode({
    v: CONSENT_VERSION,
    client_id: parameters.client_id,
    redirect_uri: parameters.redirect_uri,
    code_challenge: parameters.code_challenge,
    code_challenge_method: parameters.code_challenge_method,
    state: parameters.state,
    installation_id: parameters.installation_id,
    principal_id: principalId,
    session_binding: sessionBinding,
    exp: Math.floor(now / 1000) + ttlSeconds,
  })
  return `${REQUEST_PREFIX}.${payload}.${sign(payload, secret ?? requireSessionSecret(env))}`
}

/**
 * Verify an approval/denial POST and return the parameters to act on.
 *
 * The caller gets its parameters **only** from the return value. Nothing else in
 * the submitted form is read, so "the POST cannot be handed different parameters
 * than the ones the person saw" is a property of the shape rather than of a
 * comparison someone has to remember to write.
 *
 * Every field is checked, and in this order: signature (so nothing below is
 * attacker-authored), version, expiry, the principal, the session binding, and
 * finally the parameters themselves re-validated against live configuration
 * through the same `assertPluginAuthorizeParameters` the screen used. That last
 * step is not redundant with the signature: a token this server signed five
 * minutes ago is still refused if the client id was rotated or the redirect URI
 * de-registered since, which a signature check alone would happily wave through.
 */
export function verifyPluginConsentRequest({
  token,
  principalId,
  sessionBinding,
  env = process.env,
  secret,
  now = Date.now(),
} = {}) {
  if (typeof token !== 'string') throw invalidRequest()
  const [prefix, payload, signature] = token.split('.')
  if (prefix !== REQUEST_PREFIX || !payload || !signature) throw invalidRequest()
  if (!constantTimeEqual(signature, sign(payload, secret ?? requireSessionSecret(env)))) throw invalidRequest()

  const claims = decode(payload)
  if (!claims || claims.v !== CONSENT_VERSION) throw invalidRequest()
  if (!Number.isInteger(claims.exp) || claims.exp <= Math.floor(now / 1000)) throw invalidRequest()
  if (typeof principalId !== 'string' || !principalId.trim() || claims.principal_id !== principalId) {
    throw new PluginAuthError('AUTH_REQUIRED', 401)
  }
  if (!constantTimeEqual(String(claims.session_binding ?? ''), String(sessionBinding ?? ''))) {
    throw new PluginAuthError('AUTH_REQUIRED', 401)
  }

  const { parameters, config } = assertPluginAuthorizeParameters({
    response_type: 'code',
    client_id: claims.client_id,
    redirect_uri: claims.redirect_uri,
    code_challenge: claims.code_challenge,
    code_challenge_method: claims.code_challenge_method,
    state: claims.state,
    installation_id: claims.installation_id,
  }, { env })
  return { parameters, config }
}
