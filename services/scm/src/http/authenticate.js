import { createHash, timingSafeEqual } from 'node:crypto'
import { BUSINESS_SELECTOR_HEADER, SUBJECT_HEADER, businessSelectorRequired, subjectRequired, validBusinessSelector, validSubject } from '../infrastructure/core-client.js'

// Inbound authenticators: `authenticate(req) → scope`, chosen once in main.js by
// SCM_AUTH_MODE. Neither ever reads role, owner, tenant or viewer from the request
// beyond what its credential proves; the scope object is the same in both modes.
//
//   delegation  `Authorization: Delegation <scm.delegation.v1 token>` — HMAC-signed
//               grants (tests / non-production only; refused in production).
//   core        `Authorization: Bearer <SCM_API_TOKEN>` proves the CALLER is the BFF
//               (a service identity, never a business authority), and
//               `x-zuri-subject: <end user's session credential>` is passed to core
//               unchanged; core alone resolves it into scope (contract scm-core.v1).
//               `x-zuri-business-id: <the user's active Business>` is a SELECTOR,
//               never an authority: it only tells core which Tenant's scope to answer.
//               Order: service token (401 SCM_SERVICE_TOKEN_INVALID) → subject
//               present and ≤4096 chars (401 SCM_SUBJECT_REQUIRED) → selector
//               1..200 chars, no control character, not blank (400
//               SCM_BUSINESS_SELECTOR_REQUIRED) → core resolve (401
//               SCM_SUBJECT_UNAUTHENTICATED | 404 SCM_SCOPE_NOT_FOUND |
//               502 SCM_CORE_REJECTED | 503 SCM_CORE_UNAVAILABLE). Nothing refused
//               before the resolve reaches core. Delegation mode ignores the selector.
// Neither token nor subject is ever logged or echoed in an error body.

const unauthorized = (code, message) => Object.assign(new Error(message), { status: 401, code, retryable: false })

export function delegationAuthenticator(verify) {
  return async function authenticate(req) {
    const auth = req.headers.authorization ?? ''
    if (!auth.startsWith('Delegation ')) throw unauthorized('SCM_DELEGATION_REQUIRED', 'delegation required')
    return verify(auth.slice('Delegation '.length))
  }
}

// Both sides hashed first: equal-length inputs for timingSafeEqual whatever the
// caller sent, so neither the comparison nor its length check leaks the token.
const digest = (value) => createHash('sha256').update(value, 'utf8').digest()

export function coreAuthenticator({ apiToken, resolveScope }) {
  if (typeof apiToken !== 'string' || apiToken.length < 32) throw Object.assign(new Error('SCM_API_TOKEN must be at least 32 characters'), { code: 'SCM_CONFIG_INVALID' })
  if (typeof resolveScope !== 'function') throw Object.assign(new Error('core scope resolver required'), { code: 'SCM_CONFIG_INVALID' })
  const wanted = digest(apiToken)
  return async function authenticate(req) {
    const auth = req.headers.authorization
    const given = typeof auth === 'string' && auth.startsWith('Bearer ') ? auth.slice('Bearer '.length) : null
    if (given === null || !timingSafeEqual(digest(given), wanted)) throw unauthorized('SCM_SERVICE_TOKEN_INVALID', 'service token rejected')
    const subject = req.headers[SUBJECT_HEADER]
    if (!validSubject(subject)) throw subjectRequired()
    const businessId = req.headers[BUSINESS_SELECTOR_HEADER]
    if (!validBusinessSelector(businessId)) throw businessSelectorRequired()
    return resolveScope(subject, businessId)
  }
}
