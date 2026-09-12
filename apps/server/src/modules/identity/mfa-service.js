// @req FR-094, FR-095 — multi-factor authentication lifecycle
// @spec ADR-045 D2, D5, SDD-052, SEC-018
// @tested tests/integration/mfa-totp-lifecycle.test.js

import prisma from '@/lib/db'
import { httpError } from '@/app/api/_helpers'
import { generateTotpSecret, generateTotpUri, verifyTotp } from './totp'
import { recordAudit } from '@/modules/project-manager/application/audit'

/**
 * Begin enrollment for a new TOTP MFA factor for a Person.
 *
 * @param {object} params
 * @param {string} params.personId
 * @param {string} [params.label]
 * @param {string} [params.issuer='zuri-ai']
 * @param {object} [params.db=prisma]
 * @returns {Promise<{ factorId: string, secret: string, uri: string }>}
 */
export async function startTotpEnrollment({ personId, label, issuer = 'zuri-ai', db = prisma }) {
  if (!personId) throw httpError(400, 'personId is required')

  const person = await db.person.findUnique({ where: { id: personId } })
  if (!person) throw httpError(404, 'Person not found')

  // Remove any stale unverified PENDING factors
  await db.mfaFactor.deleteMany({
    where: { personId, type: 'TOTP', status: 'PENDING' },
  })

  const secret = generateTotpSecret()
  const factor = await db.mfaFactor.create({
    data: {
      personId,
      type: 'TOTP',
      secret,
      label: label ?? 'Authenticator App',
      status: 'PENDING',
    },
  })

  const accountName = person.email || person.code || person.id
  const uri = generateTotpUri({ secret, accountName, issuer })

  return {
    factorId: factor.id,
    secret,
    uri,
  }
}

/**
 * Confirm and activate a pending TOTP factor with an initial 6-digit token.
 *
 * @param {object} params
 * @param {string} params.personId
 * @param {string} params.factorId
 * @param {string} params.code 6-digit token
 * @param {object} [params.db=prisma]
 * @returns {Promise<{ factorId: string, status: 'ACTIVE', verified: boolean }>}
 */
export async function confirmTotpEnrollment({ personId, factorId, code, db = prisma }) {
  if (!personId || !factorId || !code) {
    throw httpError(400, 'personId, factorId, and code are required')
  }

  const factor = await db.mfaFactor.findFirst({
    where: { id: factorId, personId, status: 'PENDING' },
  })
  if (!factor) {
    throw httpError(404, 'Pending MFA factor not found')
  }

  const isValid = verifyTotp({ token: code, secret: factor.secret })
  if (!isValid) {
    throw httpError(400, 'INVALID_MFA_CODE: Verification code does not match')
  }

  const now = new Date()
  const updated = await db.mfaFactor.update({
    where: { id: factor.id },
    data: {
      status: 'ACTIVE',
      verifiedAt: now,
      version: { increment: 1 },
    },
  })

  await recordAudit(db, {
    entityType: 'MFA_FACTOR',
    entityId: updated.id,
    action: 'ACTIVATED',
    payload: { personId, type: updated.type, factorId: updated.id },
  }).catch(() => {})

  return {
    factorId: updated.id,
    status: 'ACTIVE',
    verified: true,
  }
}

/**
 * Verify an MFA challenge against all active MFA factors of a Person.
 *
 * @param {object} params
 * @param {string} params.personId
 * @param {string} params.code 6-digit token
 * @param {object} [params.db=prisma]
 * @returns {Promise<{ verified: boolean, factorId?: string }>}
 */
export async function verifyMfaChallenge({ personId, code, db = prisma }) {
  if (!personId || !code) return { verified: false }

  const activeFactors = await db.mfaFactor.findMany({
    where: { personId, status: 'ACTIVE' },
  })

  for (const factor of activeFactors) {
    if (factor.type === 'TOTP' && verifyTotp({ token: code, secret: factor.secret })) {
      return { verified: true, factorId: factor.id }
    }
  }

  return { verified: false }
}

/**
 * List all non-revoked MFA factors for a Person (secrets redacted).
 *
 * @param {object} params
 * @param {string} params.personId
 * @param {object} [params.db=prisma]
 * @returns {Promise<Array<{ id: string, type: string, label: string|null, status: string, verifiedAt: Date|null, createdAt: Date }>>}
 */
export async function listMfaFactors({ personId, db = prisma }) {
  if (!personId) return []

  const factors = await db.mfaFactor.findMany({
    where: { personId, status: { in: ['ACTIVE', 'PENDING'] } },
    select: {
      id: true,
      type: true,
      label: true,
      status: true,
      verifiedAt: true,
      createdAt: true,
    },
    orderBy: { createdAt: 'desc' },
  })

  return factors
}

/**
 * Revoke an MFA factor for a Person.
 *
 * @param {object} params
 * @param {string} params.personId
 * @param {string} params.factorId
 * @param {object} [params.db=prisma]
 * @returns {Promise<{ factorId: string, status: 'REVOKED' }>}
 */
export async function revokeMfaFactor({ personId, factorId, db = prisma }) {
  if (!personId || !factorId) throw httpError(400, 'personId and factorId are required')

  const factor = await db.mfaFactor.findFirst({
    where: { id: factorId, personId },
  })
  if (!factor) throw httpError(404, 'MFA factor not found')

  const updated = await db.mfaFactor.update({
    where: { id: factor.id },
    data: {
      status: 'REVOKED',
      revokedAt: new Date(),
      version: { increment: 1 },
    },
  })

  await recordAudit(db, {
    entityType: 'MFA_FACTOR',
    entityId: updated.id,
    action: 'REVOKED',
    payload: { personId, type: updated.type, factorId: updated.id },
  }).catch(() => {})

  return {
    factorId: updated.id,
    status: 'REVOKED',
  }
}
