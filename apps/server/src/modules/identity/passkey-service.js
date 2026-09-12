// @req FR-094, FR-095 — FIDO2 WebAuthn Passkey lifecycle service
// @spec ADR-045 D2, D5, SDD-052, SEC-018
// @tested tests/integration/passkey-lifecycle.test.js

import prisma from '@/lib/db'
import { httpError } from '@/app/api/_helpers'
import {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
  fromBase64Url,
} from './webauthn'
import { createChallenge, consumeChallenge } from './webauthn-challenge'
import { elevateSession } from './session-assurance'
import { recordAudit } from '@/modules/project-manager/application/audit'

const DEFAULT_RP_ID = process.env.WEBAUTHN_RP_ID || 'localhost'
const DEFAULT_ORIGIN = process.env.WEBAUTHN_ORIGIN || 'http://localhost:3000'

/**
 * Begin Passkey registration for an authenticated viewer.
 *
 * @param {object} params
 * @param {object} params.viewer
 * @param {string} [params.rpId]
 * @param {string} [params.rpName]
 * @param {object} [params.db=prisma]
 * @returns {Promise<object>} PublicKeyCredentialCreationOptions
 */
export async function startPasskeyRegistration({
  viewer,
  rpId = DEFAULT_RP_ID,
  rpName = 'Zuri AI',
  db = prisma,
}) {
  const personId = viewer?.personId || viewer?.person?.id
  if (!personId) throw httpError(401, 'AUTH_REQUIRED')

  const person = await db.person.findUnique({ where: { id: personId } })
  if (!person) throw httpError(404, 'Person not found')

  const existingPasskeys = await db.passkeyCredential.findMany({
    where: { personId, status: 'ACTIVE' },
    select: { credentialId: true },
  })

  const challenge = createChallenge({ personId, type: 'registration' })

  const options = generateRegistrationOptions({
    person,
    challenge,
    rpName,
    rpId,
    excludeCredentials: existingPasskeys,
  })

  return options
}

/**
 * Finish Passkey registration for an authenticated viewer.
 *
 * @param {object} params
 * @param {object} params.viewer
 * @param {object} params.credential - PublicKeyCredential object from navigator.credentials.create
 * @param {string} [params.deviceLabel]
 * @param {string} [params.rpId]
 * @param {string} [params.origin]
 * @param {object} [params.db=prisma]
 * @returns {Promise<object>}
 */
export async function finishPasskeyRegistration({
  viewer,
  credential,
  deviceLabel,
  rpId = DEFAULT_RP_ID,
  origin = DEFAULT_ORIGIN,
  db = prisma,
}) {
  const personId = viewer?.personId || viewer?.person?.id
  if (!personId) throw httpError(401, 'AUTH_REQUIRED')

  if (!credential?.response?.clientDataJSON) {
    throw httpError(400, 'INVALID_PAYLOAD: Missing credential response data')
  }

  const clientData = JSON.parse(fromBase64Url(credential.response.clientDataJSON).toString('utf8'))
  const challenge = clientData.challenge

  const challengeValid = consumeChallenge({
    challenge,
    type: 'registration',
    personId,
  })
  if (!challengeValid) {
    throw httpError(400, 'CHALLENGE_EXPIRED_OR_INVALID: Challenge is invalid or has already been used')
  }

  let verified
  try {
    verified = verifyRegistrationResponse({
      response: credential.response,
      expectedChallenge: challenge,
      expectedOrigin: origin,
      expectedRpId: rpId,
    })
  } catch (err) {
    throw httpError(400, `WEBAUTHN_VERIFICATION_FAILED: ${err.message}`)
  }

  // Ensure credentialId is not already claimed
  const existing = await db.passkeyCredential.findUnique({
    where: { credentialId: verified.credentialId },
  })
  if (existing) {
    throw httpError(409, 'CREDENTIAL_ALREADY_REGISTERED: This security key or passkey is already registered')
  }

  const passkey = await db.passkeyCredential.create({
    data: {
      personId,
      credentialId: verified.credentialId,
      publicKey: verified.publicKey,
      counter: verified.counter,
      deviceLabel: deviceLabel || 'Passkey',
      aaguid: verified.aaguid,
      status: 'ACTIVE',
    },
  })

  // Elevate current session to AAL2
  if (viewer?.sessionTokenHash) {
    await elevateSession({
      tokenHash: viewer.sessionTokenHash,
      db,
    }).catch(() => {})
  }

  await recordAudit(db, {
    entityType: 'PASSKEY_CREDENTIAL',
    entityId: passkey.id,
    action: 'REGISTERED',
    payload: { personId, credentialId: verified.credentialId, deviceLabel: passkey.deviceLabel },
  }).catch(() => {})

  return {
    passkeyId: passkey.id,
    credentialId: passkey.credentialId,
    deviceLabel: passkey.deviceLabel,
    status: 'ACTIVE',
    verified: true,
  }
}

/**
 * Begin Passkey sign-in / assertion.
 *
 * @param {object} params
 * @param {string} [params.email]
 * @param {string} [params.rpId]
 * @param {object} [params.db=prisma]
 * @returns {Promise<object>} PublicKeyCredentialRequestOptions
 */
export async function startPasskeyLogin({
  email,
  rpId = DEFAULT_RP_ID,
  db = prisma,
}) {
  let allowCredentials = []

  if (email) {
    const person = await db.person.findFirst({
      where: { email: email.trim().toLowerCase() },
    })
    if (person) {
      const passkeys = await db.passkeyCredential.findMany({
        where: { personId: person.id, status: 'ACTIVE' },
        select: { credentialId: true },
      })
      allowCredentials = passkeys
    }
  }

  const challenge = createChallenge({ type: 'authentication' })

  const options = generateAuthenticationOptions({
    challenge,
    rpId,
    allowCredentials,
  })

  return options
}

/**
 * Finish Passkey sign-in / assertion.
 *
 * @param {object} params
 * @param {object} params.credential - PublicKeyCredential object from navigator.credentials.get
 * @param {string} [params.rpId]
 * @param {string} [params.origin]
 * @param {object} [params.db=prisma]
 * @returns {Promise<{ person: object, passkey: object }>}
 */
export async function finishPasskeyLogin({
  credential,
  rpId = DEFAULT_RP_ID,
  origin = DEFAULT_ORIGIN,
  db = prisma,
}) {
  if (!credential?.id || !credential?.response?.clientDataJSON) {
    throw httpError(400, 'INVALID_PAYLOAD: Missing credential ID or response data')
  }

  const clientData = JSON.parse(fromBase64Url(credential.response.clientDataJSON).toString('utf8'))
  const challenge = clientData.challenge

  const challengeValid = consumeChallenge({
    challenge,
    type: 'authentication',
  })
  if (!challengeValid) {
    throw httpError(400, 'CHALLENGE_EXPIRED_OR_INVALID: Challenge is invalid or has already been used')
  }

  const passkey = await db.passkeyCredential.findUnique({
    where: { credentialId: credential.id },
    include: { person: true },
  })
  if (!passkey || passkey.status !== 'ACTIVE') {
    throw httpError(401, 'INVALID_CREDENTIALS: Passkey not found or revoked')
  }

  let verified
  try {
    verified = verifyAuthenticationResponse({
      response: credential.response,
      expectedChallenge: challenge,
      expectedOrigin: origin,
      expectedRpId: rpId,
      authenticator: passkey,
    })
  } catch (err) {
    throw httpError(401, `PASSKEY_AUTH_FAILED: ${err.message}`)
  }

  // Update counter & lastUsedAt
  await db.passkeyCredential.update({
    where: { id: passkey.id },
    data: {
      counter: verified.counter,
      lastUsedAt: new Date(),
      version: { increment: 1 },
    },
  })

  await recordAudit(db, {
    entityType: 'PASSKEY_CREDENTIAL',
    entityId: passkey.id,
    action: 'AUTHENTICATED',
    payload: { personId: passkey.personId, credentialId: passkey.credentialId },
  }).catch(() => {})

  return {
    person: passkey.person,
    passkey,
  }
}

/**
 * Step-up session assurance using a registered passkey.
 *
 * @param {object} params
 * @param {object} params.viewer
 * @param {object} params.credential
 * @param {string} [params.rpId]
 * @param {string} [params.origin]
 * @param {object} [params.db=prisma]
 * @returns {Promise<object>}
 */
export async function stepUpWithPasskey({
  viewer,
  credential,
  rpId = DEFAULT_RP_ID,
  origin = DEFAULT_ORIGIN,
  db = prisma,
}) {
  const personId = viewer?.personId || viewer?.person?.id
  if (!personId || !viewer?.sessionTokenHash) {
    throw httpError(401, 'AUTH_REQUIRED')
  }

  const { passkey } = await finishPasskeyLogin({
    credential,
    rpId,
    origin,
    db,
  })

  if (passkey.personId !== personId) {
    throw httpError(403, 'FORBIDDEN: Passkey belongs to a different principal')
  }

  const elevation = await elevateSession({
    tokenHash: viewer.sessionTokenHash,
    db,
  })

  return {
    elevated: true,
    assuranceLevel: elevation.assuranceLevel,
    elevatedUntil: elevation.elevatedUntil,
  }
}

/**
 * List all registered passkeys for a Person.
 *
 * @param {object} params
 * @param {string} params.personId
 * @param {object} [params.db=prisma]
 * @returns {Promise<Array<object>>}
 */
export async function listPasskeys({ personId, db = prisma }) {
  if (!personId) return []

  const passkeys = await db.passkeyCredential.findMany({
    where: { personId, status: 'ACTIVE' },
    select: {
      id: true,
      credentialId: true,
      deviceLabel: true,
      counter: true,
      aaguid: true,
      lastUsedAt: true,
      createdAt: true,
    },
    orderBy: { createdAt: 'desc' },
  })

  return passkeys
}

/**
 * Revoke a Passkey for a Person.
 *
 * @param {object} params
 * @param {string} params.personId
 * @param {string} params.passkeyId
 * @param {object} [params.db=prisma]
 * @returns {Promise<object>}
 */
export async function revokePasskey({ personId, passkeyId, db = prisma }) {
  if (!personId || !passkeyId) throw httpError(400, 'personId and passkeyId are required')

  const passkey = await db.passkeyCredential.findFirst({
    where: { id: passkeyId, personId },
  })
  if (!passkey) throw httpError(404, 'Passkey not found')

  const updated = await db.passkeyCredential.update({
    where: { id: passkey.id },
    data: {
      status: 'REVOKED',
      revokedAt: new Date(),
      version: { increment: 1 },
    },
  })

  await recordAudit(db, {
    entityType: 'PASSKEY_CREDENTIAL',
    entityId: updated.id,
    action: 'REVOKED',
    payload: { personId, passkeyId: updated.id, credentialId: updated.credentialId },
  }).catch(() => {})

  return {
    passkeyId: updated.id,
    status: 'REVOKED',
  }
}
