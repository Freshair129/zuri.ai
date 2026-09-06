// @req FR-107 — first-operator bootstrap: makes FR-075's `isOperator` capability
//   holdable where no operator exists yet. Creates Person + scrypt credential +
//   ACTIVE OPERATOR PlatformGrant in one transaction, audited, and REFUSES when
//   any ACTIVE OPERATOR grant already exists — bootstrap is for an empty
//   operator set only; every later grant must be issued by a standing operator.
//   grantOnly issues just the grant + audit to an EXISTING Person (credential
//   or not, never touched) — the first operator may already hold a credential
//   via the FR-104 reset flow while the operator set is still empty.
//   listOperatorGrants / revokeOperatorGrant are the read/write pair that
//   close the "revocable" half of FR-107's promise: this file is the one
//   owner of every PlatformGrant write (create here, revoke here), and
//   revocation takes effect on the very next session-port resolution because
//   hasOperatorGrant below only ever matches status ACTIVE.
// @spec FR-075, SEC-008, SEC-014
// @tested tests/unit/operator-bootstrap.test.js
//
// Relative imports on purpose, like sot-data-plane-auth.js: the CLI in
// scripts/bootstrap-operator.mjs must load this under plain node, where the
// '@/' alias does not resolve.
import { randomBytes, scryptSync } from 'node:crypto'
import prisma from '../../lib/db.js'
import { uniqueHumanCode } from '../../lib/ids.js'
import { recordAudit } from '../project-manager/application/audit.js'

export const OPERATOR_CAPABILITY = 'OPERATOR'
const INITIAL_PASSWORD_BYTES = 12

// Duplicates auth-service.js hashPassword's exact at-rest format
// (`scrypt$<16-byte salt hex>$<64-byte key hex>`) because auth-service imports
// through the '@/' alias and cannot be loaded by the CLI. The unit test locks
// the two together by verifying this hash with auth-service's verifyPassword —
// if either side drifts, that test fails, not a login in production.
export function hashInitialPassword(password, salt = randomBytes(16).toString('hex')) {
  const derivedKey = scryptSync(password, salt, 64).toString('hex')
  return `scrypt$${salt}$${derivedKey}`
}

function failure(status, message) {
  const error = new Error(message)
  error.status = status
  return error
}

/**
 * Create the installation's FIRST operator. Fails closed when one exists.
 * Returns the initial password exactly once — it is never persisted in any
 * form but its scrypt hash, and never audited. With `grantOnly`, issues only
 * the ACTIVE OPERATOR grant (+ audit) to an existing Person and returns no
 * password — no credential is read, written or required.
 */
export async function bootstrapOperator({ email, displayName, grantOnly = false, db = prisma, now = () => new Date() } = {}) {
  if (typeof email !== 'string' || !email.includes('@')) throw failure(400, 'BOOTSTRAP_EMAIL_REQUIRED')
  if (!grantOnly && (typeof displayName !== 'string' || !displayName.trim())) throw failure(400, 'BOOTSTRAP_DISPLAY_NAME_REQUIRED')

  const standing = await db.platformGrant.findFirst({
    where: { capability: OPERATOR_CAPABILITY, status: 'ACTIVE' },
    select: { id: true },
  })
  if (standing) throw failure(409, 'BOOTSTRAP_REFUSED_OPERATOR_EXISTS — an ACTIVE OPERATOR grant already stands; new grants are issued by an operator, not by bootstrap')

  const existing = await db.person.findFirst({
    where: { email },
    select: { id: true, code: true, displayName: true, credential: { select: { id: true } } },
  })

  if (grantOnly) {
    if (!existing) throw failure(404, 'BOOTSTRAP_GRANT_ONLY_PERSON_NOT_FOUND — grant-only issues a grant to an existing Person; it never creates one')
    const grantId = await db.$transaction(async (tx) => {
      const grant = await tx.platformGrant.create({
        data: { personId: existing.id, capability: OPERATOR_CAPABILITY, status: 'ACTIVE' },
        select: { id: true },
      })
      await recordAudit(tx, {
        entityType: 'PERSON',
        entityId: existing.id,
        action: 'OPERATOR_BOOTSTRAPPED',
        actorId: null,
        payload: { personCode: existing.code, grantId: grant.id, grantOnly: true, at: now().toISOString() },
      })
      return grant.id
    })
    return { personId: existing.id, personCode: existing.code, displayName: existing.displayName, grantId }
  }

  if (existing?.credential) {
    throw failure(409, 'BOOTSTRAP_REFUSED_CREDENTIAL_EXISTS — this Person already holds a credential; bootstrap never overwrites one')
  }

  const initialPassword = randomBytes(INITIAL_PASSWORD_BYTES).toString('base64url')
  const passwordHash = hashInitialPassword(initialPassword)
  const code = existing?.code
    ?? await uniqueHumanCode('PSN', displayName, async (candidate) =>
      Boolean(await db.person.findUnique({ where: { code: candidate }, select: { id: true } })))

  const result = await db.$transaction(async (tx) => {
    const person = existing
      ? await tx.person.findUnique({ where: { id: existing.id }, select: { id: true, code: true, displayName: true } })
      : await tx.person.create({ data: { code, displayName: displayName.trim(), email }, select: { id: true, code: true, displayName: true } })

    await tx.personCredential.create({ data: { personId: person.id, passwordHash } })
    const grant = await tx.platformGrant.create({
      data: { personId: person.id, capability: OPERATOR_CAPABILITY, status: 'ACTIVE' },
      select: { id: true },
    })

    // No password material in any form — the audit stream answers "who became
    // the first operator, when", never "what was the secret".
    await recordAudit(tx, {
      entityType: 'PERSON',
      entityId: person.id,
      action: 'OPERATOR_BOOTSTRAPPED',
      actorId: null,
      payload: { personCode: person.code, grantId: grant.id, at: now().toISOString() },
    })
    return { person, grantId: grant.id }
  })

  return {
    personId: result.person.id,
    personCode: result.person.code,
    displayName: result.person.displayName,
    grantId: result.grantId,
    initialPassword,
  }
}

/** Per-request operator resolution for the session port: sha-free, one indexed
 * read, false whenever the store is absent (test doubles, pre-migration dbs). */
export async function hasOperatorGrant(personId, db = prisma) {
  if (!personId || typeof db?.platformGrant?.findFirst !== 'function') return false
  const grant = await db.platformGrant.findFirst({
    where: { personId, capability: OPERATOR_CAPABILITY, status: 'ACTIVE' },
    select: { id: true },
  })
  return Boolean(grant)
}

/**
 * Read-only view over the OPERATOR PlatformGrant store — lists grants (ACTIVE
 * by default) so an operator can find a grant's id before revoking it. Never
 * reads or returns credential material; this is the grant row plus the
 * holder's Person identity only.
 */
export async function listOperatorGrants({ status = 'ACTIVE', db = prisma } = {}) {
  const where = { capability: OPERATOR_CAPABILITY }
  if (status && status !== 'ALL') where.status = status

  const grants = await db.platformGrant.findMany({
    where,
    orderBy: { createdAt: 'asc' },
    select: {
      id: true,
      personId: true,
      status: true,
      createdAt: true,
      revokedAt: true,
      revokeReason: true,
      grantedByPersonId: true,
      person: { select: { code: true, displayName: true } },
    },
  })

  return grants.map((grant) => ({
    id: grant.id,
    personId: grant.personId,
    personCode: grant.person?.code ?? null,
    displayName: grant.person?.displayName ?? null,
    status: grant.status,
    createdAt: grant.createdAt,
    revokedAt: grant.revokedAt,
    revokeReason: grant.revokeReason,
    grantedByPersonId: grant.grantedByPersonId,
  }))
}

/**
 * Revoke an ACTIVE OPERATOR PlatformGrant. This is the write side FR-107
 * promises: `hasOperatorGrant` only ever matches `status: 'ACTIVE'`, so once
 * this commits the very next session-port resolution for that Person reads
 * `platformGrant: false` — nothing is snapshotted (NFR-019 discipline).
 *
 * Refuses to revoke the LAST standing ACTIVE OPERATOR grant — doing so would
 * lock the installation out of every operator-only path, including this same
 * command, with no bootstrap left to run (bootstrap refuses whenever any
 * ACTIVE OPERATOR grant exists, active or not the one being revoked) — unless
 * `allowLast` is explicitly set by the caller.
 *
 * No credential material is read, written, or audited; only the grant's
 * lifecycle fields change.
 */
export async function revokeOperatorGrant(grantId, { reason = 'REVOKED', allowLast = false, actorId = null, db = prisma, now = () => new Date() } = {}) {
  if (typeof grantId !== 'string' || !grantId.trim()) throw failure(404, 'OPERATOR_GRANT_NOT_FOUND')

  const grant = await db.platformGrant.findUnique({
    where: { id: grantId },
    select: { id: true, personId: true, capability: true, status: true, person: { select: { code: true, displayName: true } } },
  })
  if (!grant || grant.capability !== OPERATOR_CAPABILITY) throw failure(404, 'OPERATOR_GRANT_NOT_FOUND')
  if (grant.status !== 'ACTIVE') {
    throw failure(409, 'OPERATOR_GRANT_ALREADY_INACTIVE — this grant is not ACTIVE; there is nothing to revoke')
  }

  if (!allowLast) {
    const activeOperatorCount = await db.platformGrant.count({
      where: { capability: OPERATOR_CAPABILITY, status: 'ACTIVE' },
    })
    if (activeOperatorCount <= 1) {
      throw failure(409, 'OPERATOR_GRANT_REFUSED_LAST_ACTIVE_OPERATOR — revoking the last ACTIVE OPERATOR grant would lock the installation out; pass --allow-last to override')
    }
  }

  // Guarded on status: 'ACTIVE' so a concurrent revoke of the same row can
  // only ever record one audit event, same discipline as api-access-auth's
  // revokeApiAccessKey.
  const outcome = await db.platformGrant.updateMany({
    where: { id: grant.id, status: 'ACTIVE' },
    data: { status: 'REVOKED', revokedAt: now(), revokeReason: reason },
  })
  const revoked = outcome.count > 0

  if (revoked) {
    await recordAudit(db, {
      entityType: 'PERSON',
      entityId: grant.personId,
      action: 'OPERATOR_GRANT_REVOKED',
      actorId,
      payload: { personCode: grant.person?.code ?? null, grantId: grant.id, reason, at: now().toISOString() },
    })
  }

  return {
    id: grant.id,
    personId: grant.personId,
    personCode: grant.person?.code ?? null,
    revoked,
    status: revoked ? 'REVOKED' : grant.status,
  }
}
