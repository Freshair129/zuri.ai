import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { passkeyLoginRateLimitKeys } from '@/modules/identity/rate-limit'

// @req FR-094, FR-095 — passkey login keys hash trusted addresses and opaque identifiers.
// @spec ADR-045, SEC-018, SEC-026
// @tested tests/unit/identity/passkey-login-rate-limit.test.js

function sha256(value) {
  return createHash('sha256').update(value, 'utf8').digest('hex')
}

describe('passkey login rate-limit keys', () => {
  it('hashes the trusted client address and identifier without exposing either value', () => {
    const keys = passkeyLoginRateLimitKeys(
      ' alice@example.com ',
      new Headers({ 'x-forwarded-for': '203.0.113.88, 198.51.100.25' }),
      { ZURI_TRUSTED_PROXY_HOPS: '1' },
    )

    expect(keys).toEqual({
      address: `AUTH_RATE_LIMIT:PASSKEY_LOGIN:ADDRESS:${sha256('198.51.100.25')}`,
      identifier: `AUTH_RATE_LIMIT:PASSKEY_LOGIN:IDENTIFIER:${sha256('alice@example.com')}`,
    })
    expect(JSON.stringify(keys)).not.toContain('198.51.100.25')
    expect(JSON.stringify(keys)).not.toContain('alice@example.com')
  })

  it('uses only the identifier when no trusted address is present and creates no unknown bucket', () => {
    const identifierOnly = passkeyLoginRateLimitKeys('credential-id-ABC123', new Headers(), {})
    expect(identifierOnly).toEqual({
      address: null,
      identifier: `AUTH_RATE_LIMIT:PASSKEY_LOGIN:IDENTIFIER:${sha256('credential-id-ABC123')}`,
    })
    expect(JSON.stringify(identifierOnly)).not.toContain('credential-id-ABC123')

    expect(passkeyLoginRateLimitKeys(undefined, new Headers(), {})).toEqual({
      address: null,
      identifier: null,
    })
  })
})
