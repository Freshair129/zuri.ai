import { describe, expect, it, vi } from 'vitest'
import {
  authenticateUser,
  generateSessionToken,
  hashPassword,
  hashSessionToken,
  revokeAllSessions,
  revokeSessionToken,
  verifySessionToken,
} from '@/modules/identity/auth-service'
import { createSessionPort } from '@/modules/identity/session-port'

// @req FR-095, NFR-019 — sessions are persisted, revalidated and revocable.
// @spec ADR-045 D2, SDD-052, SEC-018
// @tested tests/unit/iam-session.test.js

const secret = 'test-session-secret-that-is-long-enough-123456'

describe('FR-095 persisted IAM sessions', () => {
  it('persists only the token hash when credential login succeeds', async () => {
    const session = vi.fn().mockResolvedValue({ id: 'session-1' })
    const db = {
      person: {
        findFirst: vi.fn().mockResolvedValue({
          id: 'person-1',
          code: 'PER-001',
          displayName: 'Owner',
          credential: { passwordHash: hashPassword('correct horse battery staple') },
        }),
      },
      session: { create: session },
    }

    const result = await authenticateUser({
      username: 'PER-001',
      password: 'correct horse battery staple',
      db,
      env: { ZURI_SESSION_SECRET: secret },
    })

    expect(result.sessionId).toBeTruthy()
    expect(verifySessionToken(result.token, { secret })).toMatchObject({
      principalId: 'person-1',
      sessionId: result.sessionId,
    })
    expect(session).toHaveBeenCalledWith({
      data: expect.objectContaining({
        id: result.sessionId,
        personId: 'person-1',
        tokenHash: hashSessionToken(result.token),
        status: 'ACTIVE',
        expiresAt: expect.any(Date),
      }),
    })
    expect(JSON.stringify(session.mock.calls)).not.toContain(result.token)
  })

  it('revokes a current token only when its live row and hash match', async () => {
    const token = generateSessionToken('person-1', { secret, sessionId: 'session-1' })
    const updateMany = vi.fn().mockResolvedValue({ count: 1 })

    await expect(revokeSessionToken(token, {
      db: { session: { updateMany } },
      env: { ZURI_SESSION_SECRET: secret },
    })).resolves.toBe(true)

    expect(updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        id: 'session-1',
        personId: 'person-1',
        tokenHash: hashSessionToken(token),
        status: 'ACTIVE',
      }),
      data: expect.objectContaining({ status: 'REVOKED', version: { increment: 1 } }),
    }))
  })

  it('revalidates the persisted row on every protected request', async () => {
    const token = generateSessionToken('person-1', { secret, sessionId: 'session-1' })
    const db = {
      session: {
        findUnique: vi.fn().mockResolvedValue({
          id: 'session-1',
          personId: 'person-1',
          tokenHash: hashSessionToken(token),
          status: 'ACTIVE',
          expiresAt: new Date(Date.now() + 60_000),
        }),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
    }
    const port = createSessionPort({
      db,
      env: { NODE_ENV: 'production', ZURI_SESSION_SECRET: secret },
    })

    await expect(port.read(new Request('http://localhost/', {
      headers: { cookie: `zuri_session=${token}` },
    }))).resolves.toMatchObject({
      state: 'AUTHENTICATED',
      principalId: 'person-1',
      sessionId: 'session-1',
    })
    expect(db.session.findUnique).toHaveBeenCalledWith({ where: { id: 'session-1' } })

    db.session.findUnique.mockResolvedValue({
      id: 'session-1',
      personId: 'person-1',
      tokenHash: hashSessionToken(token),
      status: 'REVOKED',
      expiresAt: new Date(Date.now() + 60_000),
    })
    await expect(port.read(new Request('http://localhost/', {
      headers: { cookie: `zuri_session=${token}` },
    }))).resolves.toEqual({ state: 'UNAUTHENTICATED' })
  })

  it('supports explicit logout-all without exposing session material', async () => {
    const updateMany = vi.fn().mockResolvedValue({ count: 2 })
    await expect(revokeAllSessions('person-1', { db: { session: { updateMany } } })).resolves.toBe(2)
    expect(updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { personId: 'person-1', status: 'ACTIVE' },
      data: expect.objectContaining({ status: 'REVOKED', version: { increment: 1 } }),
    }))
  })
})
