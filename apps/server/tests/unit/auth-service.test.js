import { describe, expect, it, vi } from 'vitest'
import {
  authenticateUser,
  generateSessionToken,
  hashPassword,
  verifyPassword,
  verifySessionToken,
} from '@/modules/identity/auth-service'

// @req FR-046 — credentials are verified against PersonCredential and sessions are signed.
// @spec ADR-017, SDD-024, SEC-008
// @tested tests/unit/auth-service.test.js

const secret = 'test-session-secret-that-is-long-enough-123456'

describe('credential auth service', () => {
  it('hashes and verifies passwords without storing the plaintext', () => {
    const hash = hashPassword('correct horse battery staple')

    expect(hash).toMatch(/^scrypt\$[a-f0-9]+\$[a-f0-9]+$/)
    expect(hash).not.toContain('correct horse')
    expect(verifyPassword('correct horse battery staple', hash)).toBe(true)
    expect(verifyPassword('wrong password', hash)).toBe(false)
  })

  it('authenticates an email or person code and returns a signed session token', async () => {
    const db = {
      person: {
        findFirst: vi.fn().mockResolvedValue({
          id: 'person-1',
          code: 'PER-001',
          displayName: 'Owner',
          email: 'owner@example.com',
          credential: { passwordHash: hashPassword('correct horse battery staple') },
        }),
      },
    }

    const result = await authenticateUser({
      username: 'owner@example.com',
      password: 'correct horse battery staple',
      db,
      env: { ZURI_SESSION_SECRET: secret },
    })

    expect(result.success).toBe(true)
    expect(result.user).toEqual({ id: 'person-1', code: 'PER-001', displayName: 'Owner' })
    expect(verifySessionToken(result.token, { secret }).principalId).toBe('person-1')
    expect(db.person.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: { OR: [{ email: 'owner@example.com' }, { code: 'owner@example.com' }] },
      include: { credential: true },
    }))
  })

  it('uses one generic result for missing users and invalid passwords', async () => {
    const db = { person: { findFirst: vi.fn().mockResolvedValue(null) } }

    await expect(authenticateUser({ username: '', password: '', db, env: { ZURI_SESSION_SECRET: secret } }))
      .resolves.toEqual({ success: false, error: 'INVALID_CREDENTIALS' })

    db.person.findFirst.mockResolvedValue({
      id: 'person-1',
      code: 'PER-001',
      displayName: 'Owner',
      credential: { passwordHash: hashPassword('correct horse battery staple') },
    })
    await expect(authenticateUser({ username: 'PER-001', password: 'wrong', db, env: { ZURI_SESSION_SECRET: secret } }))
      .resolves.toEqual({ success: false, error: 'INVALID_CREDENTIALS' })
  })

  it('rejects expired or tampered session tokens', () => {
    const issuedAt = 1_700_000_000_000
    const token = generateSessionToken('person-1', { secret, now: issuedAt })

    expect(verifySessionToken(token, { secret, now: issuedAt + 1000 })).toMatchObject({ principalId: 'person-1' })
    expect(verifySessionToken(token, { secret, now: issuedAt + (7 * 24 * 60 * 60 * 1000) + 1000 })).toBeNull()
    expect(verifySessionToken(`${token}tampered`, { secret, now: issuedAt + 1000 })).toBeNull()
  })
})
