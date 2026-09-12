// @req FR-094, FR-095 — FIDO2 WebAuthn Passkey cryptographic engine
// @spec ADR-045 D2, D5, SDD-052, SEC-018
// @tested tests/unit/identity/webauthn.test.js

import { createHash, createPublicKey, verify } from 'node:crypto'
import { decodeCbor } from './webauthn-cbor'

export function toBase64Url(buffer) {
  const buf = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer)
  return buf.toString('base64url')
}

export function fromBase64Url(str) {
  return Buffer.from(str, 'base64url')
}

function sha256(data) {
  return createHash('sha256').update(data).digest()
}

/**
 * Generate WebAuthn registration options for a Person.
 *
 * @param {object} params
 * @param {object} params.person
 * @param {string} params.challenge
 * @param {string} [params.rpName='Zuri AI']
 * @param {string} [params.rpId='localhost']
 * @param {Array<{ credentialId: string }>} [params.excludeCredentials=[]]
 * @returns {object} PublicKeyCredentialCreationOptions
 */
export function generateRegistrationOptions({
  person,
  challenge,
  rpName = 'Zuri AI',
  rpId = 'localhost',
  excludeCredentials = [],
}) {
  const userIdBuffer = Buffer.from(person.id, 'utf8')

  return {
    challenge,
    rp: {
      name: rpName,
      id: rpId,
    },
    user: {
      id: toBase64Url(userIdBuffer),
      name: person.email || person.code || person.id,
      displayName: person.displayName || person.code || 'User',
    },
    pubKeyCredParams: [
      { type: 'public-key', alg: -7 }, // ES256 (ECDSA w/ SHA-256)
      { type: 'public-key', alg: -257 }, // RS256 (RSASSA-PKCS1-v1_5 w/ SHA-256)
    ],
    authenticatorSelection: {
      residentKey: 'preferred',
      userVerification: 'preferred',
    },
    timeout: 60000,
    attestation: 'none',
    excludeCredentials: excludeCredentials.map(c => ({
      id: c.credentialId,
      type: 'public-key',
    })),
  }
}

/**
 * Verify WebAuthn registration response (attestation).
 *
 * @param {object} params
 * @param {object} params.response - credential.response from client
 * @param {string} params.expectedChallenge
 * @param {string} params.expectedOrigin
 * @param {string} params.expectedRpId
 * @returns {{ credentialId: string, publicKey: string, counter: number, aaguid: string }}
 */
export function verifyRegistrationResponse({
  response,
  expectedChallenge,
  expectedOrigin,
  expectedRpId,
}) {
  if (!response?.clientDataJSON || !response?.attestationObject) {
    throw new Error('INVALID_WEBAUTHN_RESPONSE: Missing clientDataJSON or attestationObject')
  }

  const clientDataBuf = fromBase64Url(response.clientDataJSON)
  const clientData = JSON.parse(clientDataBuf.toString('utf8'))

  if (clientData.type !== 'webauthn.create') {
    throw new Error(`INVALID_WEBAUTHN_TYPE: Expected webauthn.create, got ${clientData.type}`)
  }

  if (clientData.challenge !== expectedChallenge) {
    throw new Error('CHALLENGE_MISMATCH: Provided challenge does not match expected challenge')
  }

  if (expectedOrigin && clientData.origin !== expectedOrigin) {
    // Allow localhost port variations in development/test
    const isLocalhost = clientData.origin?.includes('localhost') || clientData.origin?.includes('127.0.0.1')
    const expectedLocal = expectedOrigin.includes('localhost') || expectedOrigin.includes('127.0.0.1')
    if (!(isLocalhost && expectedLocal)) {
      throw new Error(`ORIGIN_MISMATCH: Expected ${expectedOrigin}, got ${clientData.origin}`)
    }
  }

  const attestationBuf = fromBase64Url(response.attestationObject)
  const attestation = decodeCbor(attestationBuf)

  const authData = attestation.get('authData')
  if (!authData || !Buffer.isBuffer(authData) || authData.length < 37) {
    throw new Error('INVALID_AUTH_DATA: authData missing or too short')
  }

  // Verify rpIdHash
  const rpIdHash = authData.subarray(0, 32)
  const expectedRpIdHash = sha256(expectedRpId)
  if (!rpIdHash.equals(expectedRpIdHash)) {
    throw new Error('RP_ID_MISMATCH: rpIdHash does not match expected rpId')
  }

  const flags = authData.readUInt8(32)
  const userPresent = (flags & 0x01) !== 0
  const attestedCredentialDataPresent = (flags & 0x40) !== 0

  if (!userPresent) {
    throw new Error('USER_NOT_PRESENT: User present flag was not set')
  }

  if (!attestedCredentialDataPresent) {
    throw new Error('ATTESTED_DATA_MISSING: Attested credential data flag was not set')
  }

  const signCount = authData.readUInt32BE(33)

  // Parse attested credential data (starts at byte 37)
  const aaguidBuf = authData.subarray(37, 53)
  const aaguid = aaguidBuf.toString('hex')

  const credentialIdLength = authData.readUInt16BE(53)
  const credentialIdStart = 55
  const credentialIdEnd = credentialIdStart + credentialIdLength
  const credentialIdBuf = authData.subarray(credentialIdStart, credentialIdEnd)
  const credentialId = toBase64Url(credentialIdBuf)

  const coseKeyBuf = authData.subarray(credentialIdEnd)
  const coseKey = decodeCbor(coseKeyBuf)

  const alg = coseKey.get(3) // alg
  let pem = null

  if (alg === -7) {
    // ES256: kty=2 (EC), crv=1 (P-256), x=-2, y=-3
    const x = coseKey.get(-2)
    const y = coseKey.get(-3)
    if (!x || !y) throw new Error('INVALID_COSE_KEY: Missing EC x or y coordinates')

    const jwk = {
      kty: 'EC',
      crv: 'P-256',
      x: toBase64Url(x),
      y: toBase64Url(y),
    }
    const pubKey = createPublicKey({ key: jwk, format: 'jwk' })
    pem = pubKey.export({ type: 'spki', format: 'pem' }).toString()
  } else if (alg === -257) {
    // RS256: kty=3 (RSA), n=-1, e=-2
    const n = coseKey.get(-1)
    const e = coseKey.get(-2)
    if (!n || !e) throw new Error('INVALID_COSE_KEY: Missing RSA n or e parameters')

    const jwk = {
      kty: 'RSA',
      n: toBase64Url(n),
      e: toBase64Url(e),
    }
    const pubKey = createPublicKey({ key: jwk, format: 'jwk' })
    pem = pubKey.export({ type: 'spki', format: 'pem' }).toString()
  } else {
    throw new Error(`UNSUPPORTED_ALGORITHM: COSE algorithm ${alg} is not supported`)
  }

  return {
    credentialId,
    publicKey: pem,
    counter: signCount,
    aaguid,
  }
}

/**
 * Generate WebAuthn authentication options for passkey sign-in.
 *
 * @param {object} params
 * @param {string} params.challenge
 * @param {string} [params.rpId='localhost']
 * @param {Array<{ credentialId: string }>} [params.allowCredentials]
 * @returns {object} PublicKeyCredentialRequestOptions
 */
export function generateAuthenticationOptions({
  challenge,
  rpId = 'localhost',
  allowCredentials = [],
}) {
  return {
    challenge,
    rpId,
    timeout: 60000,
    userVerification: 'preferred',
    allowCredentials: allowCredentials.map(c => ({
      id: c.credentialId,
      type: 'public-key',
    })),
  }
}

/**
 * Verify WebAuthn authentication assertion signature.
 *
 * @param {object} params
 * @param {object} params.response - credential.response from client
 * @param {string} params.expectedChallenge
 * @param {string} params.expectedOrigin
 * @param {string} params.expectedRpId
 * @param {object} params.authenticator - stored credential row
 * @param {string} params.authenticator.publicKey - SPKI PEM public key
 * @param {number} params.authenticator.counter - stored signCount
 * @returns {{ verified: boolean, counter: number }}
 */
export function verifyAuthenticationResponse({
  response,
  expectedChallenge,
  expectedOrigin,
  expectedRpId,
  authenticator,
}) {
  if (!response?.clientDataJSON || !response?.authenticatorData || !response?.signature) {
    throw new Error('INVALID_WEBAUTHN_RESPONSE: Missing clientDataJSON, authenticatorData, or signature')
  }

  const clientDataBuf = fromBase64Url(response.clientDataJSON)
  const clientData = JSON.parse(clientDataBuf.toString('utf8'))

  if (clientData.type !== 'webauthn.get') {
    throw new Error(`INVALID_WEBAUTHN_TYPE: Expected webauthn.get, got ${clientData.type}`)
  }

  if (clientData.challenge !== expectedChallenge) {
    throw new Error('CHALLENGE_MISMATCH: Provided challenge does not match expected challenge')
  }

  if (expectedOrigin && clientData.origin !== expectedOrigin) {
    const isLocalhost = clientData.origin?.includes('localhost') || clientData.origin?.includes('127.0.0.1')
    const expectedLocal = expectedOrigin.includes('localhost') || expectedOrigin.includes('127.0.0.1')
    if (!(isLocalhost && expectedLocal)) {
      throw new Error(`ORIGIN_MISMATCH: Expected ${expectedOrigin}, got ${clientData.origin}`)
    }
  }

  const authDataBuf = fromBase64Url(response.authenticatorData)
  if (authDataBuf.length < 37) {
    throw new Error('INVALID_AUTH_DATA: authenticatorData too short')
  }

  const rpIdHash = authDataBuf.subarray(0, 32)
  const expectedRpIdHash = sha256(expectedRpId)
  if (!rpIdHash.equals(expectedRpIdHash)) {
    throw new Error('RP_ID_MISMATCH: rpIdHash does not match expected rpId')
  }

  const flags = authDataBuf.readUInt8(32)
  const userPresent = (flags & 0x01) !== 0
  if (!userPresent) {
    throw new Error('USER_NOT_PRESENT: User present flag was not set')
  }

  const signCount = authDataBuf.readUInt32BE(33)
  if (signCount > 0 && authenticator.counter > 0 && signCount <= authenticator.counter) {
    throw new Error('SIGN_COUNT_REGRESSION: Possible cloned authenticator detected')
  }

  const clientDataHash = sha256(clientDataBuf)
  const signatureBase = Buffer.concat([authDataBuf, clientDataHash])
  const signatureBuf = fromBase64Url(response.signature)

  const pubKey = createPublicKey(authenticator.publicKey)
  const isValid = verify('SHA256', signatureBase, pubKey, signatureBuf)

  if (!isValid) {
    throw new Error('SIGNATURE_INVALID: Cryptographic verification failed')
  }

  return {
    verified: true,
    counter: signCount,
  }
}
