import { describe, expect, it } from 'vitest'
import {
  base32Decode,
  base32Encode,
  generateTotp,
  generateTotpSecret,
  generateTotpUri,
  verifyTotp,
} from '@/modules/identity/totp'

// @req FR-094, FR-095 — multi-factor authentication (TOTP) RFC 6238
// @spec ADR-045 D2, D5, SDD-052, SEC-018
// @tested tests/unit/identity/totp.test.js

describe('TOTP & Base32 Engine', () => {
  it('encodes and decodes Base32 round-trip correctly', () => {
    const original = Buffer.from('Zuri-AI-Enterprise-MFA-Test', 'utf8')
    const encoded = base32Encode(original)
    const decoded = base32Decode(encoded)
    expect(decoded.toString('utf8')).toBe(original.toString('utf8'))
  })

  it('generates random Base32 secret with default 160-bit length', () => {
    const secret = generateTotpSecret()
    expect(secret).toBeTruthy()
    expect(secret.length).toBe(32) // 20 bytes * 8 / 5 = 32 chars
    const decoded = base32Decode(secret)
    expect(decoded.length).toBe(20)
  })

  it('generates valid otpauth:// URI for authenticator apps', () => {
    const secret = 'JBSWY3DPEHPK3PXP'
    const uri = generateTotpUri({
      secret,
      accountName: 'staff@zuri.ai',
      issuer: 'zuri.ai',
    })
    expect(uri).toContain('otpauth://totp/zuri.ai:staff%40zuri.ai')
    expect(uri).toContain('secret=JBSWY3DPEHPK3PXP')
    expect(uri).toContain('issuer=zuri.ai')
    expect(uri).toContain('period=30')
    expect(uri).toContain('digits=6')
  })

  it('generates and verifies 6-digit TOTP code across clock windows', () => {
    const secret = generateTotpSecret()
    const now = 1726156800000 // Fixed epoch ms

    const codeCurrent = generateTotp({ secret, timestamp: now })
    expect(codeCurrent).toMatch(/^\d{6}$/)

    // Current code verifies
    expect(verifyTotp({ token: codeCurrent, secret, timestamp: now, window: 1 })).toBe(true)

    // Code from 25s ago (same or previous step) verifies with window=1
    const pastCode = generateTotp({ secret, timestamp: now - 25000 })
    expect(verifyTotp({ token: pastCode, secret, timestamp: now, window: 1 })).toBe(true)

    // Code from 2 minutes ago fails with window=1
    const oldCode = generateTotp({ secret, timestamp: now - 120000 })
    expect(verifyTotp({ token: oldCode, secret, timestamp: now, window: 1 })).toBe(false)

    // Bad/malformed codes fail cleanly
    expect(verifyTotp({ token: '000000', secret, timestamp: now, window: 1 })).toBe(false)
    expect(verifyTotp({ token: 'abc', secret, timestamp: now })).toBe(false)
    expect(verifyTotp({ token: '', secret, timestamp: now })).toBe(false)
    expect(verifyTotp({ token: null, secret, timestamp: now })).toBe(false)
  })
})
