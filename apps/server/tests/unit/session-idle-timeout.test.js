import { describe, expect, it, vi } from 'vitest'
import {
  authenticateUser,
  generateSessionToken,
  hashPassword,
  hashSessionToken,
  SESSION_IDLE_TIMEOUT_REMEMBER_SECONDS,
  SESSION_IDLE_TIMEOUT_SECONDS,
  SESSION_LAST_SEEN_THROTTLE_SECONDS,
  SESSION_MAX_AGE_SECONDS,
  verifySessionToken,
} from '@/modules/identity/auth-service'
import { createSessionPort } from '@/modules/identity/session-port'

// @req FR-046, FR-095 — persisted sessions expire after an idle timeout and touch lastSeenAt at a bounded rate.
// @spec ADR-045 D2, SEC-018
// @tested tests/unit/session-idle-timeout.test.js, tests/integration/session-idle-multi-instance.test.js

const secret = 'session-idle-test-secret-with-more-than-32-characters'
const nowStart = 1_800_000_000_000
const idleMilliseconds = SESSION_IDLE_TIMEOUT_SECONDS * 1000
const env = { NODE_ENV: 'test', ZURI_SESSION_SECRET: secret }

function fixture({ remember = false, now = nowStart, lastSeenAt = nowStart } = {}) {
  const sessionId = 'session-idle-1'
  const token = generateSessionToken('person-idle-1', {
    secret,
    now: nowStart,
    sessionId,
    remember,
  })
  const row = {
    id: sessionId,
    personId: 'person-idle-1',
    tokenHash: hashSessionToken(token),
    status: 'ACTIVE',
    expiresAt: new Date(nowStart + SESSION_MAX_AGE_SECONDS * 1000),
    lastSeenAt,
  }
  const findUnique = vi.fn().mockResolvedValue(row)
  const updateMany = vi.fn(async ({ where, data }) => {
    if (row.status !== where.status) return { count: 0 }
    if (where.lastSeenAt?.lt && !(new Date(row.lastSeenAt).getTime() < where.lastSeenAt.lt.getTime())) {
      return { count: 0 }
    }
    if (data.status) {
      row.status = data.status
      row.revokedAt = data.revokedAt
      row.revokeReason = data.revokeReason
      row.version = (row.version || 1) + 1
    }
    if (data.lastSeenAt) row.lastSeenAt = data.lastSeenAt
    return { count: 1 }
  })
  const db = {
    session: { findUnique, updateMany },
    platformGrant: { findFirst: vi.fn().mockResolvedValue(null) },
    superadminGrant: { findFirst: vi.fn().mockResolvedValue(null) },
  }
  let clock = now
  const port = createSessionPort({ db, env, now: () => clock })
  const request = new Request('http://localhost/', { headers: { cookie: `zuri_session=${token}` } })
  return { db, findUnique, port, request, row, setNow: value => { clock = value }, token }
}

describe('signed remember claim and idle timeout', () => {
  it('keeps the seven-day ceiling and verifies only signed remember claims', () => {
    expect(SESSION_MAX_AGE_SECONDS).toBe(7 * 24 * 60 * 60)
    expect(SESSION_IDLE_TIMEOUT_SECONDS).toBe(12 * 60 * 60)
    expect(SESSION_IDLE_TIMEOUT_REMEMBER_SECONDS).toBe(72 * 60 * 60)
    expect(SESSION_LAST_SEEN_THROTTLE_SECONDS).toBe(60)

    const normal = generateSessionToken('person-idle-1', { secret, now: nowStart, sessionId: 'normal' })
    const remembered = generateSessionToken('person-idle-1', { secret, now: nowStart, sessionId: 'remember', remember: true })
    expect(verifySessionToken(normal, { secret, now: nowStart })).toMatchObject({ remember: false })
    expect(verifySessionToken(remembered, { secret, now: nowStart })).toMatchObject({ remember: true })
    expect(verifySessionToken(remembered, { secret, now: nowStart + SESSION_MAX_AGE_SECONDS * 1000 - 1000 })).not.toBeNull()
    expect(verifySessionToken(remembered, { secret, now: nowStart + SESSION_MAX_AGE_SECONDS * 1000 })).toBeNull()

    const [prefix, encoded, signature] = normal.split('.')
    const payload = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'))
    const forgedPayload = Buffer.from(JSON.stringify({ ...payload, rem: 1 }), 'utf8').toString('base64url')
    expect(verifySessionToken(`${prefix}.${forgedPayload}.${signature}`, { secret, now: nowStart })).toBeNull()
  })

  it('passes remember through authenticateUser into its signed token', async () => {
    const db = {
      person: {
        findFirst: vi.fn().mockResolvedValue({
          id: 'person-idle-1',
          code: 'PER-IDLE-1',
          displayName: 'Idle User',
          credential: { passwordHash: hashPassword('correct horse battery staple') },
        }),
      },
      session: { create: vi.fn().mockResolvedValue({}) },
    }

    const result = await authenticateUser({
      username: 'PER-IDLE-1',
      password: 'correct horse battery staple',
      remember: true,
      db,
      env,
    })

    expect(result.success).toBe(true)
    expect(verifySessionToken(result.token, { secret }).remember).toBe(true)
  })

  it('authenticates at 11h59m and revokes at the normal-session 12h boundary', async () => {
    const before = fixture({ now: nowStart + idleMilliseconds - 60_000 })
    await expect(before.port.read(before.request)).resolves.toMatchObject({ state: 'AUTHENTICATED' })

    const expired = fixture({ now: nowStart + idleMilliseconds })
    await expect(expired.port.read(expired.request)).resolves.toEqual({ state: 'UNAUTHENTICATED' })
    expect(expired.db.session.updateMany).toHaveBeenCalledWith({
      where: { id: 'session-idle-1', status: 'ACTIVE' },
      data: {
        status: 'REVOKED',
        revokedAt: new Date(nowStart + idleMilliseconds),
        revokeReason: 'IDLE_TIMEOUT',
        version: { increment: 1 },
      },
    })
    expect(expired.row.status).toBe('REVOKED')
    expect(expired.row.revokeReason).toBe('IDLE_TIMEOUT')
  })

  it('keeps a remember session alive at 71h and revokes it at 72h', async () => {
    const rememberMilliseconds = SESSION_IDLE_TIMEOUT_REMEMBER_SECONDS * 1000
    const before = fixture({ remember: true, now: nowStart + rememberMilliseconds - 60 * 60 * 1000 })
    await expect(before.port.read(before.request)).resolves.toMatchObject({ state: 'AUTHENTICATED' })

    const expired = fixture({ remember: true, now: nowStart + rememberMilliseconds })
    await expect(expired.port.read(expired.request)).resolves.toEqual({ state: 'UNAUTHENTICATED' })
    expect(expired.row).toMatchObject({ status: 'REVOKED', revokeReason: 'IDLE_TIMEOUT' })
  })

  it('revokes a session whose lastSeenAt is missing or invalid', async () => {
    for (const lastSeenAt of [null, 'not-a-date']) {
      const state = fixture({ lastSeenAt })
      await expect(state.port.read(state.request)).resolves.toEqual({ state: 'UNAUTHENTICATED' })
      expect(state.row).toMatchObject({ status: 'REVOKED', revokeReason: 'IDLE_TIMEOUT' })
    }
  })

  it('accepts a Date-parseable lastSeenAt value', async () => {
    const state = fixture({ lastSeenAt: new Date(nowStart).toISOString(), now: nowStart + 1000 })

    await expect(state.port.read(state.request)).resolves.toMatchObject({ state: 'AUTHENTICATED' })
    expect(state.db.session.updateMany).not.toHaveBeenCalled()
  })

  it('does not write lastSeenAt inside 60 seconds and uses a conditional touch after the throttle', async () => {
    const insideWindow = fixture({ now: nowStart + 59_999 })
    await expect(insideWindow.port.read(insideWindow.request)).resolves.toMatchObject({ state: 'AUTHENTICATED' })
    expect(insideWindow.db.session.updateMany).not.toHaveBeenCalled()

    const afterWindow = fixture({ now: nowStart + 60_001 })
    await expect(afterWindow.port.read(afterWindow.request)).resolves.toMatchObject({ state: 'AUTHENTICATED' })
    expect(afterWindow.db.session.updateMany).toHaveBeenCalledTimes(1)
    expect(afterWindow.db.session.updateMany).toHaveBeenCalledWith({
      where: {
        id: 'session-idle-1',
        status: 'ACTIVE',
        lastSeenAt: { lt: new Date(nowStart + 1) },
      },
      data: { lastSeenAt: new Date(nowStart + 60_001) },
    })
  })

  it('maps session store read failures to SESSION_STORE_UNAVAILABLE with a cause', async () => {
    const state = fixture()
    const cause = new Error('private database detail')
    state.db.session.findUnique.mockRejectedValue(cause)

    await expect(state.port.read(state.request)).rejects.toMatchObject({
      message: 'SESSION_STORE_UNAVAILABLE',
      cause,
    })
  })

  it('maps a lastSeenAt touch failure to SESSION_STORE_UNAVAILABLE', async () => {
    const state = fixture({ now: nowStart + 60_001 })
    const cause = new Error('private database detail')
    state.db.session.updateMany.mockRejectedValue(cause)

    await expect(state.port.read(state.request)).rejects.toMatchObject({
      message: 'SESSION_STORE_UNAVAILABLE',
      cause,
    })
  })

  it('fails closed when an idle revocation write fails', async () => {
    const state = fixture({ now: nowStart + idleMilliseconds })
    const cause = new Error('private database detail')
    state.db.session.updateMany.mockRejectedValue(cause)

    await expect(state.port.read(state.request)).rejects.toMatchObject({
      message: 'SESSION_STORE_UNAVAILABLE',
      cause,
    })
  })
})
