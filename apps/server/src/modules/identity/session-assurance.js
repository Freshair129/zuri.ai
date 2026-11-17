// @req FR-094, FR-095, FR-096 — session assurance levels and step-up elevation
// @spec ADR-045 D2, D4, SDD-052, SEC-018
// @tested tests/unit/identity/session-assurance.test.js, tests/integration/mfa-totp-lifecycle.test.js,
//   tests/integration/passkey-lifecycle.test.js

import prisma from '@/lib/db'
import { httpError } from '@/app/api/_helpers'
import { recordAudit } from '@/modules/project-manager/application/audit'

export const ASSURANCE_LEVELS = Object.freeze({
  AAL1: 1,
  AAL2: 2,
})

export const STEP_UP_WINDOW_SECONDS = 900

/**
 * Determine the current effective assurance level of a Session.
 * A session with an active elevatedUntil timestamp or a WebAuthn login is AAL2.
 * The stored assuranceLevel column is descriptive and never grants authority.
 *
 * @param {object} session
 * @returns {'AAL1' | 'AAL2'}
 */
export function resolveSessionAssurance(session) {
  if (!session) return 'AAL1'

  const until = session.elevatedUntil == null ? Number.NaN : new Date(session.elevatedUntil).getTime()
  if (until > Date.now()) return 'AAL2'

  if (session.assurance === 'WEBAUTHN') return 'AAL2'

  return 'AAL1'
}

/**
 * Enforce that the viewer/session holds at least the minimum required assurance level.
 * Fails closed with 403 ASSURANCE_LEVEL_INSUFFICIENT if requirement is not met.
 *
 * @param {object} sessionOrViewer
 * @param {'AAL1' | 'AAL2'} [requiredLevel='AAL1']
 */
export function assertSessionAssurance(sessionOrViewer, requiredLevel = 'AAL1') {
  const session = sessionOrViewer?.session ?? sessionOrViewer
  const currentLevel = resolveSessionAssurance(session)

  const currentRank = ASSURANCE_LEVELS[currentLevel] || 1
  const requiredRank = ASSURANCE_LEVELS[requiredLevel] || 1

  if (currentRank < requiredRank) {
    const err = httpError(403, `ASSURANCE_LEVEL_INSUFFICIENT: requires ${requiredLevel} but session is ${currentLevel}`)
    err.code = 'ASSURANCE_LEVEL_INSUFFICIENT'
    err.requiredLevel = requiredLevel
    err.currentLevel = currentLevel
    throw err
  }

  return true
}

/**
 * Elevate a live Session belonging to this Person for the server-owned step-up window.
 *
 * @param {object} params
 * @param {string} params.tokenHash Session token hash
 * @param {string} params.personId Person who owns the session
 * @param {string} [params.reason='STEP_UP_VERIFIED']
 * @param {object} [params.db=prisma]
 * @param {() => Date} [params.now]
 * @returns {Promise<{ elevatedUntil: Date, assuranceLevel: 'AAL2' }>}
 */
export async function elevateSession({ tokenHash, personId, reason = 'STEP_UP_VERIFIED', db = prisma, now = () => new Date() }) {
  if (!tokenHash || !personId) {
    throw httpError(401, 'ACTIVE_SESSION_REQUIRED')
  }

  const currentTime = now()
  const elevatedUntil = new Date(currentTime.getTime() + STEP_UP_WINDOW_SECONDS * 1000)
  const where = {
    tokenHash,
    personId,
    status: 'ACTIVE',
    expiresAt: { gt: currentTime },
    revokedAt: null,
  }
  const session = await db.session.findFirst({ where, select: { id: true } })
  if (!session) throw httpError(401, 'ACTIVE_SESSION_REQUIRED')

  const updated = await db.session.updateMany({
    where: { ...where, id: session.id },
    data: {
      elevatedUntil,
      version: { increment: 1 },
    },
  })
  if (updated.count !== 1) throw httpError(401, 'ACTIVE_SESSION_REQUIRED')

  await recordAudit(db, {
    entityType: 'SESSION',
    entityId: session.id,
    action: 'ELEVATED',
    payload: {
      personId,
      assuranceLevel: 'AAL2',
      reason,
      elevatedUntil: elevatedUntil.toISOString(),
    },
  }).catch(() => {})

  return {
    id: session.id,
    assuranceLevel: 'AAL2',
    elevatedUntil,
  }
}
