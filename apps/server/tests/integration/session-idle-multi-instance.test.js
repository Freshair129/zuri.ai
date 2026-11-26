import { afterEach, describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import prisma from '@/lib/db'
import {
  authenticateUser,
  hashPassword,
  hashSessionToken,
  revokeAllSessions,
  revokeSessionToken,
  SESSION_IDLE_TIMEOUT_REMEMBER_SECONDS,
  SESSION_IDLE_TIMEOUT_SECONDS,
} from '@/modules/identity/auth-service'
import { createSessionPort } from '@/modules/identity/session-port'
import { issueApiWriteCsrfToken } from '@/modules/identity/api-write-csrf'
import { POST as logoutAll } from '@/app/api/auth/logout-all/route'

// @req FR-046, FR-095 — separate session-port instances observe revocation, idle expiry, and throttled lastSeenAt writes.
// @spec ADR-045 D2, ADR-124 D2/D5, SEC-018
// @tested tests/integration/session-idle-multi-instance.test.js
// This suite uses the real SQLite integration database; it does not prove PostgreSQL row-lock or serialization behavior.

const origin = 'http://localhost:3000'
const password = 'integration-idle-test-password'
const env = {
  NODE_ENV: 'test',
  PUBLIC_BASE_URL: origin,
  ZURI_SESSION_SECRET: 'integration-idle-test-secret-with-more-than-32-characters',
}
const testPeople = new Set()

function dbWithFailingAuditCreate(cause = new Error('audit write failed')) {
  const wrapTransactionClient = (tx) => new Proxy(tx, {
    get(target, property) {
      if (property === 'auditEvent') {
        const delegate = Reflect.get(target, property, target)
        return new Proxy(delegate, {
          get(auditDelegate, operation) {
            if (operation === 'create') return async () => { throw cause }
            return Reflect.get(auditDelegate, operation, auditDelegate)
          },
        })
      }
      return Reflect.get(target, property, target)
    },
  })

  const db = new Proxy(prisma, {
    get(target, property) {
      if (property === '$transaction') {
        return (operation) => target.$transaction((tx) => operation(wrapTransactionClient(tx)))
      }
      return Reflect.get(target, property, target)
    },
  })
  return { cause, db }
}

function controllableClock(initial = Date.now()) {
  let value = initial
  return {
    now: () => value,
    set: next => { value = next },
  }
}

function ports(clock) {
  const options = { db: prisma, env, now: clock.now }
  return [createSessionPort(options), createSessionPort(options)]
}

async function createPerson() {
  const id = randomId()
  const person = await prisma.person.create({
    data: {
      id,
      code: `PER-IDLE-${id.slice(0, 12)}`,
      displayName: 'Idle timeout integration user',
      email: `idle-${id}@example.test`,
      credential: { create: { passwordHash: hashPassword(password) } },
    },
  })
  testPeople.add(person.id)
  return person
}

async function login(person, remember = false) {
  const result = await authenticateUser({ username: person.code, password, remember, env })
  expect(result.success).toBe(true)
  return result
}

function requestFor(token, url = `${origin}/api/test`) {
  return new Request(url, { headers: { cookie: `zuri_session=${token}` } })
}

function randomId() {
  return randomUUID()
}

afterEach(async () => {
  const personIds = [...testPeople]
  testPeople.clear()
  if (personIds.length) {
    await prisma.session.updateMany({
      where: { personId: { in: personIds }, status: 'ACTIVE' },
      data: {
        status: 'REVOKED',
        revokedAt: new Date(),
        revokeReason: 'IDLE_TEST_CLEANUP',
        version: { increment: 1 },
      },
    })
  }
})

describe('persisted session idle timeout across instances', () => {
  it('observes single-session and person-wide revocation on the next read', async () => {
    const clock = controllableClock()
    const [portA, portB] = ports(clock)
    const person = await createPerson()
    const first = await login(person)
    const second = await login(person)

    await revokeSessionToken(first.token, { db: prisma, env, now: clock.now() })
    await expect(portB.read(requestFor(first.token))).resolves.toEqual({ state: 'UNAUTHENTICATED' })

    await revokeAllSessions(person.id, { db: prisma, env, now: clock.now(), reason: 'LOGOUT_ALL' })
    await expect(portB.read(requestFor(second.token))).resolves.toEqual({ state: 'UNAUTHENTICATED' })
    await expect(portA.read(requestFor(second.token))).resolves.toEqual({ state: 'UNAUTHENTICATED' })
  })

  it('lets both instances observe the 12h idle boundary and persists IDLE_TIMEOUT', async () => {
    const clock = controllableClock()
    const [portA, portB] = ports(clock)
    const person = await createPerson()
    const session = await login(person)
    const before = await prisma.session.findUnique({ where: { id: session.sessionId } })
    clock.set(before.lastSeenAt.getTime() + SESSION_IDLE_TIMEOUT_SECONDS * 1000)

    const results = await Promise.all([
      portA.read(requestFor(session.token)),
      portB.read(requestFor(session.token)),
    ])
    expect(results).toEqual([{ state: 'UNAUTHENTICATED' }, { state: 'UNAUTHENTICATED' }])

    const after = await prisma.session.findUnique({ where: { id: session.sessionId } })
    expect(after).toMatchObject({ status: 'REVOKED', revokeReason: 'IDLE_TIMEOUT' })
    expect(after.revokedAt).toEqual(new Date(clock.now()))

    const audits = await prisma.auditEvent.findMany({
      where: { entityType: 'SESSION', entityId: session.sessionId, action: 'SESSION_REVOKED_IDLE_TIMEOUT' },
    })
    expect(audits).toHaveLength(1)
    expect(audits[0]).toMatchObject({ entityType: 'SESSION', entityId: session.sessionId, actorType: 'SYSTEM', actorId: null })
    expect(JSON.parse(audits[0].payloadJson)).toEqual({
      reason: 'IDLE_TIMEOUT',
      personId: person.id,
      revokedCount: 1,
      remember: false,
    })
    const idleAuditJson = JSON.stringify(audits[0])
    expect(idleAuditJson).not.toContain(session.token)
    expect(idleAuditJson).not.toContain(hashSessionToken(session.token))
    expect(idleAuditJson).not.toContain('zuri_session=')
    expect(idleAuditJson).not.toMatch(/tokenHash|cookie/i)
  })

  it('keeps remember sessions alive for 12h and expires them at 72h', async () => {
    const clock = controllableClock()
    const [portA, portB] = ports(clock)
    const person = await createPerson()
    const alive = await login(person, true)
    const expired = await login(person, true)
    const aliveRow = await prisma.session.findUnique({ where: { id: alive.sessionId } })
    const expiredRow = await prisma.session.findUnique({ where: { id: expired.sessionId } })

    clock.set(aliveRow.lastSeenAt.getTime() + SESSION_IDLE_TIMEOUT_SECONDS * 1000)
    await expect(portA.read(requestFor(alive.token))).resolves.toMatchObject({ state: 'AUTHENTICATED' })

    clock.set(expiredRow.lastSeenAt.getTime() + SESSION_IDLE_TIMEOUT_REMEMBER_SECONDS * 1000)
    await expect(portB.read(requestFor(expired.token))).resolves.toEqual({ state: 'UNAUTHENTICATED' })
    const after = await prisma.session.findUnique({ where: { id: expired.sessionId } })
    expect(after).toMatchObject({ status: 'REVOKED', revokeReason: 'IDLE_TIMEOUT' })
  })

  it('handles concurrent reads near the touch boundary without regressing lastSeenAt', async () => {
    const clock = controllableClock()
    const [portA, portB] = ports(clock)
    const person = await createPerson()
    const session = await login(person)
    const before = await prisma.session.findUnique({ where: { id: session.sessionId } })
    clock.set(before.lastSeenAt.getTime() + 60_001)

    const results = await Promise.all(Array.from({ length: 24 }, (_, index) => {
      const port = index % 2 === 0 ? portA : portB
      return port.read(requestFor(session.token))
    }))
    expect(results.every(result => result.state === 'AUTHENTICATED')).toBe(true)

    const after = await prisma.session.findUnique({ where: { id: session.sessionId } })
    expect(after.lastSeenAt).toBeInstanceOf(Date)
    expect(Number.isFinite(after.lastSeenAt.getTime())).toBe(true)
    expect(after.lastSeenAt.getTime()).toBeGreaterThanOrEqual(before.lastSeenAt.getTime())
  })

  it('fails closed on a session-store read outage', async () => {
    const clock = controllableClock()
    const person = await createPerson()
    const session = await login(person)
    const cause = new Error('private database detail')
    const port = createSessionPort({
      db: { session: { findUnique: async () => { throw cause } } },
      env,
      now: clock.now,
    })

    await expect(port.read(requestFor(session.token))).rejects.toMatchObject({
      message: 'SESSION_STORE_UNAVAILABLE',
      cause,
    })
  })

  it('revokes sessions through logout-all for both ports and a sibling handler port', async () => {
    const clock = controllableClock()
    const [portA, portB] = ports(clock)
    const siblingPort = createSessionPort({ db: prisma, env, now: clock.now })
    const person = await createPerson()
    const first = await login(person)
    const second = await login(person)
    const firstRow = await prisma.session.findUnique({ where: { id: first.sessionId } })
    const secondRow = await prisma.session.findUnique({ where: { id: second.sessionId } })
    clock.set(Math.max(firstRow.lastSeenAt.getTime(), secondRow.lastSeenAt.getTime()))

    const tokenRequest = new Request(`${origin}/api/auth/logout-all`, {
      method: 'POST',
      headers: { origin, cookie: `zuri_session=${first.token}` },
    })
    const session = await portA.read(tokenRequest)
    const csrf = issueApiWriteCsrfToken({ request: tokenRequest, session, env, now: clock.now() })
    const request = new Request(`${origin}/api/auth/logout-all`, {
      method: 'POST',
      headers: {
        origin,
        cookie: `zuri_session=${first.token}`,
        'x-csrf-token': csrf.token,
      },
    })
    const response = await logoutAll(request, {
      db: prisma,
      env,
      now: clock.now,
      resolveRequestViewer: async () => ({ principal: { id: person.id } }),
    })

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ revoked: 2 })
    expect(response.headers.get('set-cookie')).toMatch(/Max-Age=0/i)
    const audit = await prisma.auditEvent.findFirst({
      where: { entityType: 'SESSION', entityId: person.id, action: 'SESSIONS_REVOKED_LOGOUT_ALL' },
    })
    expect(audit).toMatchObject({ entityType: 'SESSION', entityId: person.id, actorId: person.id })
    expect(JSON.parse(audit.payloadJson)).toEqual({ reason: 'LOGOUT_ALL', revokedCount: 2 })
    const logoutAuditJson = JSON.stringify(audit)
    expect(logoutAuditJson).not.toContain(first.token)
    expect(logoutAuditJson).not.toContain(hashSessionToken(first.token))
    expect(logoutAuditJson).not.toContain(second.token)
    expect(logoutAuditJson).not.toContain(hashSessionToken(second.token))
    expect(logoutAuditJson).not.toContain('zuri_session=')
    expect(logoutAuditJson).not.toMatch(/tokenHash|cookie/i)
    await expect(portA.read(requestFor(first.token))).resolves.toEqual({ state: 'UNAUTHENTICATED' })
    await expect(portB.read(requestFor(second.token))).resolves.toEqual({ state: 'UNAUTHENTICATED' })
    await expect(siblingPort.read(requestFor(first.token))).resolves.toEqual({ state: 'UNAUTHENTICATED' })
  })

  it('does not write a logout-all audit for password reset or a zero-count logout-all', async () => {
    const person = await createPerson()
    const session = await login(person)

    await expect(revokeAllSessions(person.id, { db: prisma, env, reason: 'PASSWORD_RESET' })).resolves.toBe(1)
    await expect(revokeAllSessions(person.id, { db: prisma, env, reason: 'LOGOUT_ALL' })).resolves.toBe(0)
    await expect(prisma.auditEvent.count({
      where: { entityType: 'SESSION', entityId: person.id, action: 'SESSIONS_REVOKED_LOGOUT_ALL' },
    })).resolves.toBe(0)
    await expect(prisma.session.findUnique({ where: { id: session.sessionId } })).resolves.toMatchObject({
      status: 'REVOKED',
      revokeReason: 'PASSWORD_RESET',
    })
  })

  it('rolls back logout-all when the audit insert fails', async () => {
    const person = await createPerson()
    const session = await login(person)
    const { db, cause } = dbWithFailingAuditCreate()

    await expect(revokeAllSessions(person.id, { db, env })).rejects.toBe(cause)
    await expect(prisma.session.findUnique({ where: { id: session.sessionId } })).resolves.toMatchObject({ status: 'ACTIVE' })
    await expect(prisma.auditEvent.count({
      where: { entityType: 'SESSION', entityId: person.id, action: 'SESSIONS_REVOKED_LOGOUT_ALL' },
    })).resolves.toBe(0)
  })

  it('rolls back idle revocation and refuses the request when the audit insert fails', async () => {
    const clock = controllableClock()
    const person = await createPerson()
    const session = await login(person)
    const before = await prisma.session.findUnique({ where: { id: session.sessionId } })
    clock.set(before.lastSeenAt.getTime() + SESSION_IDLE_TIMEOUT_SECONDS * 1000)
    const { db, cause } = dbWithFailingAuditCreate()
    const port = createSessionPort({ db, env, now: clock.now })

    await expect(port.read(requestFor(session.token))).rejects.toMatchObject({
      message: 'SESSION_STORE_UNAVAILABLE',
      cause,
    })
    await expect(prisma.session.findUnique({ where: { id: session.sessionId } })).resolves.toMatchObject({ status: 'ACTIVE' })
    await expect(prisma.auditEvent.count({
      where: { entityType: 'SESSION', entityId: session.sessionId, action: 'SESSION_REVOKED_IDLE_TIMEOUT' },
    })).resolves.toBe(0)
  })
})
