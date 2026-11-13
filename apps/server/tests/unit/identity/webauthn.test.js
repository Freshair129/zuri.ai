import { describe, expect, it } from 'vitest'
import { createHash, generateKeyPairSync, sign } from 'node:crypto'
import {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
  toBase64Url,
} from '@/modules/identity/webauthn'
import { clearAllChallenges, createChallenge, consumeChallenge } from '@/modules/identity/webauthn-challenge'

// @req FR-094, FR-095 — single-use WebAuthn challenges remain type/person bound,
//   expire after five minutes, and stay bounded per process.
// @spec ADR-045, SEC-018, SEC-026
// @tested tests/unit/identity/webauthn.test.js

function sha256(buf) {
  return createHash('sha256').update(buf).digest()
}

describe('WebAuthn engine & challenge lifecycle', () => {
  it('manages single-use challenges and prevents replay', () => {
    const challenge = createChallenge({ personId: 'p-123', type: 'registration' })
    expect(typeof challenge).toBe('string')
    expect(challenge.length).toBeGreaterThan(20)

    // First consumption succeeds
    const consumed = consumeChallenge({ challenge, type: 'registration', personId: 'p-123' })
    expect(consumed).toBe(true)

    // Second consumption fails (anti-replay)
    const replayed = consumeChallenge({ challenge, type: 'registration', personId: 'p-123' })
    expect(replayed).toBe(false)
  })

  it('rejects challenge if personId or ceremony type mismatches', () => {
    const challenge = createChallenge({ personId: 'p-123', type: 'registration' })
    // Wrong type
    expect(consumeChallenge({ challenge, type: 'authentication', personId: 'p-123' })).toBe(false)

    const challenge2 = createChallenge({ personId: 'p-123', type: 'registration' })
    // Wrong personId
    expect(consumeChallenge({ challenge: challenge2, type: 'registration', personId: 'p-other' })).toBe(false)
  })

  it('evicts the oldest challenge at the configured cap while retaining newer ones', () => {
    clearAllChallenges()
    const oldest = createChallenge({ personId: 'p-123', type: 'registration', maxEntries: 2 })
    const newer = createChallenge({ personId: 'p-123', type: 'registration', maxEntries: 2 })
    const newest = createChallenge({ personId: 'p-123', type: 'registration', maxEntries: 2 })

    expect(consumeChallenge({ challenge: oldest, type: 'registration', personId: 'p-123' })).toBe(false)
    expect(consumeChallenge({ challenge: newer, type: 'registration', personId: 'p-123' })).toBe(true)
    expect(consumeChallenge({ challenge: newest, type: 'registration', personId: 'p-123' })).toBe(true)
  })

  it('rejects and prunes an expired challenge without evicting a live one', () => {
    clearAllChallenges()
    const live = createChallenge({ personId: 'p-123', type: 'registration', maxEntries: 2 })
    const expired = createChallenge({ personId: 'p-123', type: 'registration', ttlMs: -1, maxEntries: 2 })

    expect(consumeChallenge({ challenge: expired, type: 'registration', personId: 'p-123' })).toBe(false)
    const next = createChallenge({ personId: 'p-123', type: 'registration', maxEntries: 2 })

    expect(consumeChallenge({ challenge: live, type: 'registration', personId: 'p-123' })).toBe(true)
    expect(consumeChallenge({ challenge: next, type: 'registration', personId: 'p-123' })).toBe(true)
  })

  it('generates compliant registration and authentication options', () => {
    const regOptions = generateRegistrationOptions({
      person: { id: 'p-1', email: 'alice@example.com', displayName: 'Alice', code: 'USR-01' },
      challenge: 'test-challenge-123',
      rpName: 'Zuri AI',
      rpId: 'localhost',
    })
    expect(regOptions.challenge).toBe('test-challenge-123')
    expect(regOptions.rp.id).toBe('localhost')
    expect(regOptions.user.name).toBe('alice@example.com')
    expect(regOptions.pubKeyCredParams).toContainEqual({ type: 'public-key', alg: -7 })

    const authOptions = generateAuthenticationOptions({
      challenge: 'auth-challenge-456',
      rpId: 'localhost',
      allowCredentials: [{ credentialId: 'cred-1' }],
    })
    expect(authOptions.challenge).toBe('auth-challenge-456')
    expect(authOptions.allowCredentials).toEqual([{ id: 'cred-1', type: 'public-key' }])
  })

  it('verifies valid authentication assertion and detects tampering or counter regression', () => {
    // Generate EC P-256 key pair
    const { publicKey, privateKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' })
    const spkiPem = publicKey.export({ type: 'spki', format: 'pem' }).toString()

    const rpId = 'localhost'
    const rpIdHash = sha256(Buffer.from(rpId))
    const challenge = 'auth-chal-789'
    const origin = 'http://localhost:3000'

    const clientDataJSON = JSON.stringify({
      type: 'webauthn.get',
      challenge,
      origin,
    })
    const clientDataBuf = Buffer.from(clientDataJSON, 'utf8')

    // Construct authenticatorData: 32 bytes rpIdHash + 1 byte flags (0x01 UP) + 4 bytes signCount (1)
    const flagsBuf = Buffer.from([0x01])
    const counterBuf = Buffer.alloc(4)
    counterBuf.writeUInt32BE(10, 0)
    const authenticatorData = Buffer.concat([rpIdHash, flagsBuf, counterBuf])

    const clientDataHash = sha256(clientDataBuf)
    const signatureBase = Buffer.concat([authenticatorData, clientDataHash])

    const sig = sign('SHA256', signatureBase, privateKey)

    const response = {
      clientDataJSON: toBase64Url(clientDataBuf),
      authenticatorData: toBase64Url(authenticatorData),
      signature: toBase64Url(sig),
    }

    // Verification succeeds
    const result = verifyAuthenticationResponse({
      response,
      expectedChallenge: challenge,
      expectedOrigin: origin,
      expectedRpId: rpId,
      authenticator: {
        publicKey: spkiPem,
        counter: 5,
      },
    })
    expect(result.verified).toBe(true)
    expect(result.counter).toBe(10)

    // Counter regression fails (replay / clone attack protection)
    expect(() => {
      verifyAuthenticationResponse({
        response,
        expectedChallenge: challenge,
        expectedOrigin: origin,
        expectedRpId: rpId,
        authenticator: {
          publicKey: spkiPem,
          counter: 20, // stored counter is higher than 10
        },
      })
    }).toThrow(/SIGN_COUNT_REGRESSION/)

    // Tampered challenge fails
    expect(() => {
      verifyAuthenticationResponse({
        response,
        expectedChallenge: 'different-challenge',
        expectedOrigin: origin,
        expectedRpId: rpId,
        authenticator: {
          publicKey: spkiPem,
          counter: 5,
        },
      })
    }).toThrow(/CHALLENGE_MISMATCH/)

    // Tampered signature fails
    const badSig = Buffer.from(sig)
    badSig[0] ^= 0xff
    expect(() => {
      verifyAuthenticationResponse({
        response: { ...response, signature: toBase64Url(badSig) },
        expectedChallenge: challenge,
        expectedOrigin: origin,
        expectedRpId: rpId,
        authenticator: {
          publicKey: spkiPem,
          counter: 5,
        },
      })
    }).toThrow(/SIGNATURE_INVALID/)
  })
})
