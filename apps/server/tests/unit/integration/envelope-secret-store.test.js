// @req FR-223 — the envelope store's cryptography: per-secret data keys wrapped by a
//   key-encryption key, and additional authenticated data that binds Tenant,
//   Business, connection and version so a row opened for anyone else is refused.
// @spec SDD-097, SEC-030, ADR-089 D1
// @tested tests/unit/integration/envelope-secret-store.test.js
import { randomBytes, randomUUID } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import { openSecretEnvelope, resolveEnvelopeKeyring, sealSecretEnvelope } from '@/platform/integrations/core/secret-store/envelope-secret-store'
import { errorTrace, findLeaks, generateLineChannelBundle, secretNeedles } from '../../helpers/credential-vault-fixtures'

vi.mock('@/lib/db', () => ({ default: {} }))

const keyEnv = (extra = {}) => ({ ZURI_SECRET_KEK: randomBytes(32).toString('hex'), ZURI_SECRET_KEK_VERSION: '3', ...extra })
const scope = () => ({ tenantId: randomUUID(), businessId: randomUUID(), connectionId: randomUUID() })

function sealed(env, bundle = generateLineChannelBundle({ withToken: true })) {
  const s = scope()
  const id = randomUUID()
  const plaintext = JSON.stringify(bundle)
  return { bundle, plaintext, s, id, row: sealSecretEnvelope({ id, ...s, versionNumber: 2, plaintext }, env) }
}

describe('sealing', () => {
  it('stores ciphertext, a wrapped data key and the KEK label — never the bundle', () => {
    const env = keyEnv()
    const { bundle, row } = sealed(env)
    expect(row.kekId).toBe('v3')
    expect(row.aadVersion).toBe(2)
    expect(findLeaks({ row }, secretNeedles(bundle))).toEqual([])
    expect(findLeaks({ row }, [env.ZURI_SECRET_KEK])).toEqual([])
  })

  it('uses a fresh data key and nonce each time, so equal bundles never share ciphertext', () => {
    const env = keyEnv()
    const bundle = generateLineChannelBundle()
    const a = sealed(env, bundle).row
    const b = sealed(env, bundle).row
    expect(a.ciphertext).not.toBe(b.ciphertext)
    expect(a.wrappedDek).not.toBe(b.wrappedDek)
  })

  it('opens for the exact scope and version it was sealed for', () => {
    const env = keyEnv()
    const { plaintext, s, row } = sealed(env)
    expect(openSecretEnvelope(row, { ...s, versionNumber: 2 }, env)).toBe(plaintext)
  })
})

describe('the AAD check refuses every other binding with CHANNEL_SECRET_SCOPE_MISMATCH', () => {
  const env = keyEnv()
  const { bundle, s, row } = sealed(env)
  const cases = {
    'another Tenant': { ...s, tenantId: randomUUID(), versionNumber: 2 },
    'another Business': { ...s, businessId: randomUUID(), versionNumber: 2 },
    'another connection': { ...s, connectionId: randomUUID(), versionNumber: 2 },
    'another version': { ...s, versionNumber: 1 },
  }
  for (const [label, attempt] of Object.entries(cases)) {
    it(label, () => {
      let error
      try { openSecretEnvelope(row, attempt, env) } catch (caught) { error = caught }
      expect(error).toMatchObject({ code: 'CHANNEL_SECRET_SCOPE_MISMATCH' })
      expect(findLeaks({ error: errorTrace(error) }, secretNeedles(bundle))).toEqual([])
    })
  }

  it('a row relabelled under another id or tampered ciphertext', () => {
    expect(() => openSecretEnvelope({ ...row, id: randomUUID() }, { ...s, versionNumber: 2 }, env)).toThrow('CHANNEL_SECRET_SCOPE_MISMATCH')
    const flipped = Buffer.from(row.ciphertext, 'base64')
    flipped[0] ^= 1
    expect(() => openSecretEnvelope({ ...row, ciphertext: flipped.toString('base64') }, { ...s, versionNumber: 2 }, env)).toThrow('CHANNEL_SECRET_SCOPE_MISMATCH')
  })
})

describe('key-encryption keys', () => {
  it('opens with a retired key version and refuses a key that is gone', () => {
    const oldEnv = keyEnv({ ZURI_SECRET_KEK_VERSION: '1' })
    const { plaintext, s, row } = sealed(oldEnv)
    const rotated = keyEnv({ ZURI_SECRET_KEK_VERSION: '2', ZURI_SECRET_KEK_V1: oldEnv.ZURI_SECRET_KEK })
    expect(openSecretEnvelope(row, { ...s, versionNumber: 2 }, rotated)).toBe(plaintext)
    expect(() => openSecretEnvelope(row, { ...s, versionNumber: 2 }, keyEnv({ ZURI_SECRET_KEK_VERSION: '2' }))).toThrow('CHANNEL_SECRET_STORE_UNAVAILABLE')
  })

  it('production fails closed without a key and refuses every development-key envelope', () => {
    expect(() => resolveEnvelopeKeyring({ NODE_ENV: 'production' })).toThrow('CHANNEL_SECRET_STORE_UNAVAILABLE')
    expect(() => resolveEnvelopeKeyring({ NODE_ENV: 'production', ZURI_SECRET_KEK: 'not-hex' })).toThrow('CHANNEL_SECRET_STORE_UNAVAILABLE')
    const dev = sealed({ NODE_ENV: 'test' })
    expect(dev.row.kekId).toBe('v0')
    expect(() => openSecretEnvelope(dev.row, { ...dev.s, versionNumber: 2 }, keyEnv({ NODE_ENV: 'production' }))).toThrow('CHANNEL_SECRET_STORE_UNAVAILABLE')
  })
})
