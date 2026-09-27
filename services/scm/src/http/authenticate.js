import { createHash, timingSafeEqual } from 'node:crypto'
import { SUBJECT_HEADER, subjectRequired, validSubject } from '../infrastructure/core-client.js'

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
//               Order: service token (401 SCM_SERVICE_TOKEN_INVALID) → subject
//               present and ≤4096 chars (401 SCM_SUBJECT_REQUIRED) → core resolve
//               (401 SCM_SUBJECT_UNAUTHENTICATED | 502 SCM_CORE_REJECTED |
//               503 SCM_CORE_UNAVAILABLE). A bad service token never reaches core.
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
    return resolveScope(subject)
  }
}
