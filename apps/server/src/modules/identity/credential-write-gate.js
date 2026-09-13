// @req FR-224 — the credential-write step-up gate and rate limit: every credential
//   write, rotation, revocation and live validation needs an ACTIVE TOTP factor and
//   a Session inside its AAL2 step-up window, then passes the per Person-and-
//   Business limit (and, when LINE is called, the installation-wide one) — all of it
//   before any LINE call or store write.
// @spec ADR-089 D4 and proof 4; SEC-018; ADR-045 D2, D4
// @tested tests/integration/line-channel-credential-routes.test.js
//
// Why the gate reads `elevatedUntil` and not `assuranceLevel`. elevateSession()
// writes assuranceLevel = 'AAL2' together with a 900-second elevatedUntil and never
// writes it back, so after the window the column still says AAL2 and
// resolveSessionAssurance() would keep answering AAL2. ADR-089 requires "an expired
// elevation" to be refused, so the gate hands assertSessionAssurance only the
// window: a Session is AAL2 here exactly while its step-up is live.

import prisma from '@/lib/db'
import { AUTH_SESSION_COOKIE, hashSessionToken } from './auth-service'
import { readRequestCookie } from './session-port'
import { assertSessionAssurance } from './session-assurance'
import { CREDENTIAL_RATE_LIMITS, LINE_VALIDATION_KEY, consumeRateLimit, credentialWriteKey } from './rate-limit'

export const MFA_ENROLMENT_PATH = '/api/auth/mfa/totp/enroll'

function refuse(status, code, details) {
  const error = new Error(code)
  error.status = status
  error.code = code
  if (details) error.details = details
  return error
}

async function requestSession(request, db) {
  const cookie = request ? readRequestCookie(request, AUTH_SESSION_COOKIE) : null
  if (!cookie) return null
  return db.session.findUnique({ where: { tokenHash: hashSessionToken(cookie) } })
}

/**
 * Refuse unless the viewer's Person has an ACTIVE TOTP factor and the request's
 * Session is inside a live step-up window. Order matters: a Person with no factor
 * is told to enrol, because stepping up is impossible for them.
 */
export async function assertCredentialWriteAssurance({ viewer, request = null, session = undefined, db = prisma, now = () => new Date() } = {}) {
  const personId = viewer?.principal?.id ?? viewer?.personId
  if (typeof personId !== 'string' || !personId) throw refuse(401, 'AUTH_REQUIRED')
  const factor = await db.mfaFactor.findFirst({ where: { personId, type: 'TOTP', status: 'ACTIVE' }, select: { id: true } })
  if (!factor) throw refuse(403, 'MFA_FACTOR_REQUIRED', [{ code: 'MFA_FACTOR_REQUIRED', enrolmentPath: MFA_ENROLMENT_PATH }])
  const row = session === undefined ? await requestSession(request, db) : session
  const live = row && row.personId === personId && row.status === 'ACTIVE' && new Date(row.expiresAt).getTime() > now().getTime()
  try {
    assertSessionAssurance({ assuranceLevel: 'AAL1', elevatedUntil: live ? row.elevatedUntil ?? null : null }, 'AAL2')
  } catch {
    throw refuse(403, 'ASSURANCE_LEVEL_INSUFFICIENT', [{ code: 'ASSURANCE_LEVEL_INSUFFICIENT', stepUpPath: '/api/auth/step-up' }])
  }
  return { personId, sessionId: row.id }
}

/**
 * The ports a credential service calls: `assertWriteAllowed` (gate, then limits)
 * and `onValidationRejected` (a rejected LINE validation counts twice). Actions that
 * call LINE also spend the installation-wide LINE validation budget.
 */
export function createCredentialWriteGuard({ request = null, session = undefined, db = prisma, now = () => new Date() } = {}) {
  const callsLine = action => action === 'CONNECT' || action === 'ROTATE' || action === 'VALIDATE'
  return {
    async assertWriteAllowed({ viewer, businessId, action }) {
      const { personId } = await assertCredentialWriteAssurance({ viewer, request, session, db, now })
      await consumeRateLimit({ key: credentialWriteKey(personId, businessId), ...CREDENTIAL_RATE_LIMITS.personBusiness, db, now })
      if (callsLine(action)) await consumeRateLimit({ key: LINE_VALIDATION_KEY, ...CREDENTIAL_RATE_LIMITS.lineValidation, db, now })
    },
    async onValidationRejected({ viewer, businessId }) {
      const personId = viewer?.principal?.id ?? viewer?.personId
      if (!personId) return
      await consumeRateLimit({ key: credentialWriteKey(personId, businessId), ...CREDENTIAL_RATE_LIMITS.personBusiness, force: true, db, now })
    },
  }
}
