// @req FR-094, FR-095, FR-096 — session assurance levels and step-up elevation
// @spec ADR-045 D2, D4, SDD-052, SEC-018
// @tested tests/unit/identity/session-assurance.test.js

import prisma from '@/lib/db'
import { httpError } from '@/app/api/_helpers'
import { recordAudit } from '@/modules/project-manager/application/audit'

export const ASSURANCE_LEVELS = Object.freeze({
  AAL1: 1,
  AAL2: 2,
})

/**
 * Determine the current effective assurance level of a Session.
 * A session with an active elevatedUntil timestamp is granted AAL2 until expiry.
 *
 * @param {object} session
 * @returns {'AAL1' | 'AAL2'}
 */
export function resolveSessionAssurance(session) {
  if (!session) return 'AAL1'

  // Elevated step-up window takes effect if unexpired
  if (session.elevatedUntil) {
    const until = session.elevatedUntil instanceof Date ? session.elevatedUntil.getTime() : new Date(session.elevatedUntil).getTime()
    if (until > Date.now()) {
      return 'AAL2'
    }
  }

  if (session.assuranceLevel === 'AAL2') {
    return 'AAL2'
  }

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
 * Elevate a session's assurance level to AAL2 for a bounded time window (step-up).
 *
 * @param {object} params
 * @param {string} params.tokenHash Session token hash
 * @param {number} [params.ttlSeconds=900] Elevation TTL in seconds (default 15 mins)
 * @param {string} [params.reason='STEP_UP_VERIFIED']
 * @param {object} [params.db=prisma]
 * @returns {Promise<{ elevatedUntil: Date, assuranceLevel: 'AAL2' }>}
 */
export async function elevateSession({ tokenHash, ttlSeconds = 900, reason = 'STEP_UP_VERIFIED', db = prisma }) {
  if (!tokenHash) {
    throw httpError(400, 'tokenHash is required for session elevation')
  }

  const session = await db.session.findUnique({ where: { tokenHash } })
  if (!session || session.status !== 'ACTIVE') {
    throw httpError(401, 'ACTIVE_SESSION_REQUIRED')
  }

  const now = new Date()
  const elevatedUntil = new Date(now.getTime() + ttlSeconds * 1000)

  const updated = await db.session.update({
    where: { tokenHash },
    data: {
      assuranceLevel: 'AAL2',
      elevatedUntil,
      version: { increment: 1 },
    },
  })

  await recordAudit(db, {
    entityType: 'SESSION',
    entityId: updated.id,
    action: 'ELEVATED',
    payload: {
      personId: updated.personId,
      assuranceLevel: 'AAL2',
      reason,
      elevatedUntil: elevatedUntil.toISOString(),
    },
  }).catch(() => {})

  return {
    id: updated.id,
    assuranceLevel: 'AAL2',
    elevatedUntil,
  }
}
