// @req FR-094, FR-095 — bring every stored MFA factor secret to the current seal.
// @spec SEC-029, SDD-096, ADR-088 D4, SEC-018
// @tested tests/integration/mfa-totp-lifecycle.test.js, tests/unit/identity/seal-mfa-factor-secrets-cli.test.js
//
// The one migration path for factors written before SEC-029 (plaintext base32)
// and for factors sealed under a key version that is being rotated out. It is an
// explicit operator sweep, not re-encrypt-on-read, for the reasons in ADR-088 D4:
// a factor nobody challenges is never read, so a read-time upgrade would leave its
// secret in the clear indefinitely, and a reader that accepts plaintext is a
// reader a database writer can hand a secret of their choosing.
//
// Relative imports only, so `scripts/seal-mfa-factor-secrets.mjs` runs under plain node.

import prisma from '../../lib/db.js'
import { recordAudit } from '../project-manager/application/audit.js'
import { assertMfaSecretKeyConfigured, describeStoredMfaSecret, openMfaSecret, sealMfaSecret } from './mfa-secret-seal.js'

/**
 * Report (default) or write the reseal of every MfaFactor secret that is not
 * sealed under the current key. Writes are compare-and-set on the old stored
 * value, so a factor enrolled, revoked or resealed concurrently is skipped rather
 * than overwritten. Output carries factor and Person ids only — never a secret.
 *
 * @param {object} [params]
 * @param {boolean} [params.write=false]
 * @param {object} [params.db=prisma]
 * @param {object} [params.env=process.env]
 * @returns {Promise<{ write: boolean, currentKeyVersion: number, scanned: number, alreadyCurrent: number,
 *   pending: Array<{ factorId: string, personId: string, status: string, from: string, fromKeyVersion: number|null }>,
 *   resealed: string[], changedConcurrently: string[],
 *   unreadable: Array<{ factorId: string, personId: string, status: string, reason: string }> }>}
 */
export async function resealMfaFactorSecrets({ write = false, db = prisma, env = process.env } = {}) {
  // Resolve the keyring before the first read: production without a key stops here.
  const currentKeyVersion = assertMfaSecretKeyConfigured(env)

  // Every status, REVOKED included: a revoked factor cannot verify, but its secret
  // is still at rest in the table and in every backup export (backup-service).
  const factors = await db.mfaFactor.findMany({
    select: { id: true, personId: true, status: true, secret: true },
    orderBy: { createdAt: 'asc' },
  })

  const report = {
    write,
    currentKeyVersion,
    scanned: factors.length,
    alreadyCurrent: 0,
    pending: [],
    resealed: [],
    changedConcurrently: [],
    unreadable: [],
  }

  for (const factor of factors) {
    const binding = { personId: factor.personId, factorId: factor.id }
    const described = describeStoredMfaSecret(factor.secret, env)
    if (described.state === 'SEALED_CURRENT') {
      report.alreadyCurrent += 1
      continue
    }
    if (described.state === 'UNRECOGNIZED') {
      report.unreadable.push({ factorId: factor.id, personId: factor.personId, status: factor.status, reason: 'UNRECOGNIZED' })
      continue
    }

    let secret
    try {
      secret = described.state === 'LEGACY_PLAINTEXT' ? factor.secret : openMfaSecret(factor.secret, binding, env)
    } catch (error) {
      if (error?.code !== 'MFA_SECRET_UNAVAILABLE') throw error
      report.unreadable.push({ factorId: factor.id, personId: factor.personId, status: factor.status, reason: error.reason })
      continue
    }

    report.pending.push({
      factorId: factor.id,
      personId: factor.personId,
      status: factor.status,
      from: described.state,
      fromKeyVersion: described.keyVersion,
    })
    if (!write) continue

    const { count } = await db.mfaFactor.updateMany({
      where: { id: factor.id, secret: factor.secret },
      data: { secret: sealMfaSecret(secret, binding, env) },
    })
    if (count !== 1) {
      report.changedConcurrently.push(factor.id)
      continue
    }
    report.resealed.push(factor.id)
    await recordAudit(db, {
      entityType: 'MFA_FACTOR',
      entityId: factor.id,
      action: 'SECRET_RESEALED',
      actorType: 'SYSTEM',
      payload: {
        personId: factor.personId,
        factorId: factor.id,
        from: described.state,
        fromKeyVersion: described.keyVersion,
        toKeyVersion: currentKeyVersion,
      },
    })
  }

  return report
}
