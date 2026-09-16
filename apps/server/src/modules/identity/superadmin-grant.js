// @req FR-200 — explicit, revocable installation-wide administration.
// @spec ADR-082, SEC-008, SEC-027
// @tested tests/integration/superadmin-access.test.js
import prisma from '../../lib/db.js'
import { hasOperatorGrant, OPERATOR_GRANT_MAX_DAYS } from './operator-bootstrap.js'
import { recordAudit } from '../project-manager/application/audit.js'

export const SUPERADMIN_CAPABILITY = 'SUPERADMIN'

function failure(status, message) {
  return Object.assign(new Error(message), { status })
}

export async function hasSuperadminGrant(personId, db = prisma, now = Date.now()) {
  if (!personId || typeof db.platformGrant?.findFirst !== 'function') return false
  const grant = await db.platformGrant.findFirst({
    where: { personId, capability: SUPERADMIN_CAPABILITY, status: 'ACTIVE', expiresAt: { gt: new Date(now) }, person: { accessDisabledAt: null } },
    select: { capability: true, status: true, expiresAt: true },
  })
  return grant?.capability === SUPERADMIN_CAPABILITY && grant.status === 'ACTIVE'
    && Boolean(grant.expiresAt) && new Date(grant.expiresAt).getTime() > now
}

async function assertActor(actorId, db, now) {
  if (!actorId) throw failure(403, 'SUPERADMIN_ACTOR_REQUIRED')
  const actor = await db.person.findUnique({ where: { id: actorId }, select: { accessDisabledAt: true } })
  if (!actor || actor.accessDisabledAt || !(
    await hasOperatorGrant(actorId, db, now) || await hasSuperadminGrant(actorId, db, now)
  )) throw failure(403, 'SUPERADMIN_REQUIRES_INSTALLATION_ACTOR')
}

function requiredReason(reason) {
  if (typeof reason !== 'string' || !reason.trim() || reason.trim().length > 500) {
    throw failure(400, 'SUPERADMIN_REASON_REQUIRED')
  }
  return reason.trim()
}

// Local administrative entry point: the CLI requires database credentials;
// actor authority is nevertheless checked against the live grant store.
export async function grantSuperadmin({ personId, actorId, reason, expiresAt, db = prisma, now = Date.now() } = {}) {
  reason = requiredReason(reason)
  const expiry = expiresAt instanceof Date ? expiresAt : (typeof expiresAt === 'string' ? new Date(expiresAt) : null)
  if (!expiry || !Number.isFinite(expiry.getTime()) || expiry.getTime() <= now
    || expiry.getTime() - now > OPERATOR_GRANT_MAX_DAYS * 86400000) {
    throw failure(400, 'SUPERADMIN_EXPIRY_REQUIRED_WITHIN_90_DAYS')
  }
  if (typeof personId !== 'string' || !personId) throw failure(400, 'SUPERADMIN_PERSON_REQUIRED')
  return db.$transaction(async (tx) => {
    await assertActor(actorId, tx, now)
    const person = await tx.person.findUnique({ where: { id: personId }, select: { id: true, accessDisabledAt: true } })
    if (!person || person.accessDisabledAt) throw failure(404, 'SUPERADMIN_PERSON_UNAVAILABLE')
    const existing = await tx.platformGrant.findFirst({
      where: { personId, capability: SUPERADMIN_CAPABILITY, status: 'ACTIVE' }, select: { id: true },
    })
    if (existing) throw failure(409, 'SUPERADMIN_ACTIVE_GRANT_EXISTS_REVOKE_FIRST')
    const grant = await tx.platformGrant.create({
      data: { personId, capability: SUPERADMIN_CAPABILITY, status: 'ACTIVE', standing: false,
        expiresAt: expiry, grantedByPersonId: actorId, grantReason: reason },
      select: { id: true, personId: true, capability: true, status: true, expiresAt: true },
    })
    await recordAudit(tx, { entityType: 'PERSON', entityId: personId, action: 'SUPERADMIN_GRANTED', actorId, reason,
      payload: { grantId: grant.id, expiresAt: expiry.toISOString() }, afterJson: grant })
    return grant
  })
}

export async function revokeSuperadmin({ personId, actorId, reason, db = prisma, now = Date.now() } = {}) {
  reason = requiredReason(reason)
  if (typeof personId !== 'string' || !personId) throw failure(400, 'SUPERADMIN_PERSON_REQUIRED')
  return db.$transaction(async (tx) => {
    await assertActor(actorId, tx, now)
    const grant = await tx.platformGrant.findFirst({
      where: { personId, capability: SUPERADMIN_CAPABILITY, status: 'ACTIVE' },
      select: { id: true, status: true, expiresAt: true },
    })
    if (!grant) throw failure(404, 'SUPERADMIN_ACTIVE_GRANT_NOT_FOUND')
    const updated = await tx.platformGrant.updateMany({
      where: { id: grant.id, status: 'ACTIVE' },
      data: { status: 'REVOKED', revokedAt: new Date(now), revokeReason: reason },
    })
    if (updated.count !== 1) throw failure(409, 'SUPERADMIN_GRANT_CHANGED')
    await recordAudit(tx, { entityType: 'PERSON', entityId: personId, action: 'SUPERADMIN_REVOKED', actorId, reason,
      payload: { grantId: grant.id }, beforeJson: grant, afterJson: { status: 'REVOKED' } })
    return { id: grant.id, personId, status: 'REVOKED' }
  })
}
