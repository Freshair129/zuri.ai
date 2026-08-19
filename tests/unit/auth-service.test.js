// @req FR-082 — Production Auth & Password Reset Service Tests.
// @spec SEC-015, SDD-024
// @tested tests/unit/auth-service.test.js
import { describe, expect, it } from 'vitest'
import {
  hashPassword,
  verifyPassword,
  generateSessionToken,
  verifySessionToken,
  authenticateUser,
  createPasswordResetToken,
  resetPassword,
} from '@/modules/identity/auth-service'

describe('FR-081 Auth Service', () => {
  it('hashes and verifies passwords correctly', () => {
    const password = 'SecretPassword123!'
    const hash = hashPassword(password)
    expect(hash).toMatch(/^scrypt:/)
    expect(verifyPassword(password, hash)).toBe(true)
    expect(verifyPassword('WrongPassword', hash)).toBe(false)
  })

  it('generates and verifies valid session tokens', () => {
    const principalId = 'person-uuid-123'
    const token = generateSessionToken(principalId)
    expect(token).toMatch(/^zuri_sess:person-uuid-123:/)

    const verified = verifySessionToken(token)
    expect(verified).not.toBeNull()
    expect(verified.principalId).toBe(principalId)

    const tampered = token.replace('person-uuid-123', 'fake-uuid')
    expect(verifySessionToken(tampered)).toBeNull()
  })

  it('handles user authentication queries', async () => {
    const fakeDb = {
      person: {
        findFirst: async ({ where }) => {
          const query = where.OR[0].email
          if (query === 'owner@local' || query === 'PER-OWNER') {
            return {
              id: 'per-owner-id',
              code: 'PER-OWNER',
              displayName: 'Local Owner',
              email: 'owner@local',
              credential: {
                passwordHash: hashPassword('Password123!'),
              },
            }
          }
          return null
        },
      },
    }

    const validResult = await authenticateUser({ username: 'owner@local', password: 'Password123!', db: fakeDb })
    expect(validResult.success).toBe(true)
    expect(validResult.person.code).toBe('PER-OWNER')
    expect(validResult.token).toMatch(/^zuri_sess:/)

    const invalidResult = await authenticateUser({ username: 'owner@local', password: 'WrongPassword', db: fakeDb })
    expect(invalidResult.success).toBe(false)
    expect(invalidResult.error).toBe('INVALID_CREDENTIALS')

    const unknownResult = await authenticateUser({ username: 'unknown@user', password: 'Password123!', db: fakeDb })
    expect(unknownResult.success).toBe(false)
  })

  it('creates and processes password reset tokens', async () => {
    let createdToken = null
    let updatedCredential = null
    let usedTokenId = null

    const fakeDb = {
      person: {
        findFirst: async () => ({ id: 'per-owner-id', code: 'PER-OWNER', email: 'owner@local' }),
      },
      passwordResetToken: {
        create: async ({ data }) => {
          createdToken = data.token
          return { id: 'reset-id-1', ...data }
        },
        findUnique: async ({ where }) => {
          if (where.token === createdToken) {
            return {
              id: 'reset-id-1',
              personId: 'per-owner-id',
              token: createdToken,
              expiresAt: new Date(Date.now() + 3600000),
              usedAt: usedTokenId ? new Date() : null,
            }
          }
          return null
        },
        update: async ({ where, data }) => {
          if (where.id === 'reset-id-1') usedTokenId = 'reset-id-1'
        },
      },
      personCredential: {
        upsert: async ({ update, create }) => {
          updatedCredential = update.passwordHash || create.passwordHash
          return { personId: 'per-owner-id', passwordHash: updatedCredential }
        },
      },
      $transaction: async (promises) => Promise.all(promises),
    }

    const forgotResult = await createPasswordResetToken({ emailOrUsername: 'owner@local', db: fakeDb })
    expect(forgotResult.success).toBe(true)
    expect(forgotResult.resetToken).toBe(createdToken)

    const resetResult = await resetPassword({ token: createdToken, newPassword: 'NewPassword123!', db: fakeDb })
    expect(resetResult.success).toBe(true)
    expect(updatedCredential).toMatch(/^scrypt:/)
  })
})
