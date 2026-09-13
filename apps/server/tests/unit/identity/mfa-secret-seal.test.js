import { describe, expect, it } from 'vitest'
import {
  assertMfaSecretKeyConfigured,
  describeStoredMfaSecret,
  openMfaSecret,
  sealMfaSecret,
} from '@/modules/identity/mfa-secret-seal'
import { generateTotp, generateTotpSecret, verifyTotp } from '@/modules/identity/totp'

// @req FR-094, FR-095 — TOTP factor secrets are sealed at rest
// @spec SEC-029, SDD-096, ADR-088
// @tested tests/unit/identity/mfa-secret-seal.test.js

const KEY_1 = 'a1'.repeat(32)
const KEY_2 = 'b2'.repeat(32)
const binding = { personId: 'person-1', factorId: 'factor-1' }
const production = { NODE_ENV: 'production', ZURI_MFA_SECRET_KEY: KEY_1 }

function expectRefusal(fn, code, reason) {
  let caught
  try { fn() } catch (error) { caught = error }
  expect(caught, 'expected a refusal').toBeTruthy()
  expect(caught.code).toBe(code)
  expect(caught.status).toBe(503)
  if (reason) expect(caught.reason).toBe(reason)
  return caught
}

describe('SEC-029 — MFA factor secret seal', () => {
  it('stores something that is not, and does not contain, the base32 secret', () => {
    const secret = generateTotpSecret()
    const stored = sealMfaSecret(secret, binding, production)

    expect(stored).not.toBe(secret)
    expect(stored).not.toContain(secret)
    expect(stored.toUpperCase()).not.toContain(secret)
    expect(stored).toMatch(/^mfa\.v1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/)
    expect(describeStoredMfaSecret(stored, production)).toEqual({ state: 'SEALED_CURRENT', keyVersion: 1, currentKeyVersion: 1 })
  })

  it('opens to the same secret, and a code from the authenticator still verifies', () => {
    const secret = generateTotpSecret()
    const stored = sealMfaSecret(secret, binding, production)
    const opened = openMfaSecret(stored, binding, production)

    expect(opened).toBe(secret)
    expect(verifyTotp({ token: generateTotp({ secret }), secret: opened })).toBe(true)
  })

  it('uses a fresh nonce, so sealing the same secret twice never repeats', () => {
    const secret = generateTotpSecret()
    expect(sealMfaSecret(secret, binding, production)).not.toBe(sealMfaSecret(secret, binding, production))
  })

  it('binds the ciphertext to its Person and factor row', () => {
    const stored = sealMfaSecret(generateTotpSecret(), binding, production)
    expectRefusal(() => openMfaSecret(stored, { ...binding, factorId: 'factor-2' }, production), 'MFA_SECRET_UNAVAILABLE', 'AUTHENTICATION_FAILED')
    expectRefusal(() => openMfaSecret(stored, { ...binding, personId: 'person-2' }, production), 'MFA_SECRET_UNAVAILABLE', 'AUTHENTICATION_FAILED')
  })

  it('refuses a tampered value and a relabelled key version', () => {
    const stored = sealMfaSecret(generateTotpSecret(), binding, production)
    const parts = stored.split('.')
    const flipped = Buffer.from(parts[4], 'base64url')
    flipped[0] ^= 0x01
    expectRefusal(() => openMfaSecret([...parts.slice(0, 4), flipped.toString('base64url')].join('.'), binding, production),
      'MFA_SECRET_UNAVAILABLE', 'AUTHENTICATION_FAILED')

    const relabelled = ['mfa', 'v2', ...parts.slice(2)].join('.')
    const bothKeys = { NODE_ENV: 'production', ZURI_MFA_SECRET_KEY: KEY_1, ZURI_MFA_SECRET_KEY_VERSION: '2', ZURI_MFA_SECRET_KEY_V1: KEY_1 }
    expectRefusal(() => openMfaSecret(relabelled, binding, bothKeys), 'MFA_SECRET_UNAVAILABLE', 'AUTHENTICATION_FAILED')
  })

  it('refuses a legacy plaintext secret instead of using it', () => {
    const legacy = generateTotpSecret()
    expect(describeStoredMfaSecret(legacy, production).state).toBe('LEGACY_PLAINTEXT')
    expectRefusal(() => openMfaSecret(legacy, binding, production), 'MFA_SECRET_UNAVAILABLE', 'LEGACY_PLAINTEXT')
  })

  it('fails closed in production when the key is missing or malformed', () => {
    for (const env of [
      { NODE_ENV: 'production' },
      { NODE_ENV: 'production', ZURI_MFA_SECRET_KEY: 'too-short' },
      { NODE_ENV: 'production', ZURI_MFA_SECRET_KEY: KEY_1, ZURI_MFA_SECRET_KEY_VERSION: '0' },
      { NODE_ENV: 'production', ZURI_MFA_SECRET_KEY: KEY_1, ZURI_MFA_SECRET_KEY_VERSION: 'two' },
    ]) {
      expectRefusal(() => sealMfaSecret(generateTotpSecret(), binding, env), 'MFA_SECRET_KEY_REQUIRED')
      expectRefusal(() => assertMfaSecretKeyConfigured(env), 'MFA_SECRET_KEY_REQUIRED')
    }
    const stored = sealMfaSecret(generateTotpSecret(), binding, production)
    expectRefusal(() => openMfaSecret(stored, binding, { NODE_ENV: 'production' }), 'MFA_SECRET_KEY_REQUIRED')
  })

  it('outside production seals with the v0 development key, which production never opens', () => {
    const secret = generateTotpSecret()
    const development = sealMfaSecret(secret, binding, { NODE_ENV: 'test' })

    expect(development.startsWith('mfa.v0.')).toBe(true)
    expect(openMfaSecret(development, binding, { NODE_ENV: 'test' })).toBe(secret)
    expectRefusal(() => openMfaSecret(development, binding, production), 'MFA_SECRET_UNAVAILABLE', 'KEY_VERSION_UNAVAILABLE')
  })

  it('rotates: a retired key still opens, and the value reports as stale until resealed', () => {
    const secret = generateTotpSecret()
    const underV1 = sealMfaSecret(secret, binding, production)
    const rotated = { NODE_ENV: 'production', ZURI_MFA_SECRET_KEY: KEY_2, ZURI_MFA_SECRET_KEY_VERSION: '2', ZURI_MFA_SECRET_KEY_V1: KEY_1 }

    expect(describeStoredMfaSecret(underV1, rotated)).toEqual({ state: 'SEALED_STALE', keyVersion: 1, currentKeyVersion: 2 })
    expect(openMfaSecret(underV1, binding, rotated)).toBe(secret)

    const underV2 = sealMfaSecret(secret, binding, rotated)
    expect(underV2.startsWith('mfa.v2.')).toBe(true)
    expect(describeStoredMfaSecret(underV2, rotated).state).toBe('SEALED_CURRENT')

    const retiredKeyRemoved = { NODE_ENV: 'production', ZURI_MFA_SECRET_KEY: KEY_2, ZURI_MFA_SECRET_KEY_VERSION: '2' }
    expectRefusal(() => openMfaSecret(underV1, binding, retiredKeyRemoved), 'MFA_SECRET_UNAVAILABLE', 'KEY_VERSION_UNAVAILABLE')
  })

  it('refuses to seal without a binding or a base32 secret', () => {
    expectRefusal(() => sealMfaSecret(generateTotpSecret(), { personId: 'person-1' }, production), 'MFA_SECRET_BINDING_REQUIRED')
    expectRefusal(() => sealMfaSecret('not base32!', binding, production), 'MFA_SECRET_INVALID')
  })
})
