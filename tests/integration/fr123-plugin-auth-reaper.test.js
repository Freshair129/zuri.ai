import { afterEach, describe, expect, it } from 'vitest'
import { randomUUID, createHash } from 'node:crypto'
import prisma from '@/lib/db'
import {
  createPluginAuthorizationCode,
  exchangePluginAuthorizationCode,
  reapExpiredPluginAuthRecords,
} from '@/modules/identity/plugin-auth-service'

// @req FR-123 — expired plugin credentials are pruned without removing the
// consumed-code evidence needed to revoke a still-live session on replay.
// @spec ADR-052 D2, SEC-022
// @tested tests/integration/fr123-plugin-auth-reaper.test.js

const NOW = new Date('2026-08-31T00:00:00.000Z')
const CLIENT_ID = 'zuri-plugin-reaper-test'
const REDIRECT_URI = 'http://127.0.0.1:43123/callback'
const VERIFIER = 'verifier_reaper_001_abcdefghijklmnopqrstuvwxyz_1234567890'
const CHALLENGE = createHash('sha256').update(VERIFIER, 'utf8').digest('base64url')
const ENV = {
  ZURI_PLUGIN_CLIENT_ID: CLIENT_ID,
  ZURI_PLUGIN_REDIRECT_URIS: REDIRECT_URI,
}

const createdFixtures = []

const later = (seconds) => new Date(NOW.getTime() + seconds * 1000)

async function fixture(label) {
  const person = await prisma.person.create({
    data: { code: `PER-FR123-REAPER-${label}-${randomUUID().slice(0, 8)}`, displayName: label },
  })
  const installation = await prisma.pluginInstallation.create({
    data: { installationId: `install-fr123-reaper-${label}-${randomUUID().slice(0, 8)}`, clientId: CLIENT_ID },
  })
  createdFixtures.push({ personId: person.id, installationId: installation.id })
  return { person, installation }
}

async function createCode({ installation, person }, label, overrides = {}) {
  return prisma.pluginAuthorizationCode.create({
    data: {
      codeHash: `code-hash-${label}-${randomUUID()}`,
      clientId: CLIENT_ID,
      redirectUri: REDIRECT_URI,
      codeChallenge: CHALLENGE,
      codeChallengeMethod: 'S256',
      pluginInstallationId: installation.id,
      personId: person.id,
      expiresAt: later(-1),
      consumedAt: null,
      revokedAt: null,
      createdAt: later(-61),
      ...overrides,
    },
  })
}

async function createSession({ installation, person }, codeId, label, overrides = {}) {
  return prisma.pluginSession.create({
    data: {
      tokenHash: `token-hash-${label}-${randomUUID()}`,
      clientId: CLIENT_ID,
      pluginInstallationId: installation.id,
      personId: person.id,
      authorizationCodeId: codeId,
      expiresAt: later(900),
      revokedAt: null,
      lastUsedAt: null,
      createdAt: NOW,
      updatedAt: NOW,
      ...overrides,
    },
  })
}

function deferred() {
  let resolve
  const promise = new Promise((settle) => { resolve = settle })
  return { promise, resolve }
}

// These wrappers still execute the real Prisma transactions and SQLite
// statements. They only hold a real transaction at the row-lock boundary so
// each side of the race can be exercised deterministically.
function controlledDb({ onTransactionRequested, onReaperRaw, onCodeUpdateClaimed } = {}) {
  const wrapTransaction = (tx) => new Proxy(tx, {
    get(target, property, receiver) {
      if (property === '$executeRaw' && onReaperRaw) {
        const executeRaw = target.$executeRaw.bind(target)
        return async (...args) => {
          await onReaperRaw.before?.()
          const result = await executeRaw(...args)
          await onReaperRaw.after?.()
          return result
        }
      }
      if (property === 'pluginAuthorizationCode' && onCodeUpdateClaimed) {
        const codeModel = target.pluginAuthorizationCode
        return new Proxy(codeModel, {
          get(model, method, modelReceiver) {
            const original = Reflect.get(model, method, modelReceiver)
            if (method !== 'updateMany') return original
            return async (...args) => {
              const result = await original.apply(model, args)
              await onCodeUpdateClaimed?.()
              return result
            }
          },
        })
      }
      return Reflect.get(target, property, receiver)
    },
  })

  return new Proxy(prisma, {
    get(target, property, receiver) {
      if (property === '$transaction') {
        return (callback) => {
          onTransactionRequested?.()
          return target.$transaction((tx) => callback(wrapTransaction(tx)))
        }
      }
      return Reflect.get(target, property, receiver)
    },
  })
}

afterEach(async () => {
  const fixtureIds = createdFixtures.splice(0)
  if (!fixtureIds.length) return
  const personIds = fixtureIds.map(({ personId }) => personId)
  const installationIds = fixtureIds.map(({ installationId }) => installationId)
  await prisma.pluginSession.deleteMany({ where: { personId: { in: personIds } } })
  await prisma.pluginAuthorizationCode.deleteMany({ where: { personId: { in: personIds } } })
  await prisma.pluginInstallation.deleteMany({ where: { id: { in: installationIds } } })
  await prisma.person.deleteMany({ where: { id: { in: personIds } } })
})

describe('FR-123 expired plugin credential reaper', () => {
  it('deletes only expired sessions and expired codes without active linked sessions', async () => {
    const subject = await fixture('predicates')
    const expiredLinkedCode = await createCode(subject, 'expired-linked', { consumedAt: later(-60) })
    const expiredUnlinkedCode = await createCode(subject, 'expired-unlinked')
    const boundaryCode = await createCode(subject, 'boundary-code', { expiresAt: NOW })
    const revokedLinkedCode = await createCode(subject, 'revoked-linked', { consumedAt: later(-60) })
    const futureCode = await createCode(subject, 'future-code', { expiresAt: later(1) })
    const activeLinkedCode = await createCode(subject, 'active-linked', { consumedAt: later(-60) })

    await createSession(subject, expiredLinkedCode.id, 'expired', { expiresAt: NOW })
    const revokedAt = later(-30)
    const revokedSession = await createSession(subject, revokedLinkedCode.id, 'revoked', { revokedAt })
    const activeSession = await createSession(subject, activeLinkedCode.id, 'active')

    // The integration database can contain expired plugin rows left by an
    // adjacent FR-123 file. Derive the expected global effect from the real
    // database while keeping the fixture-specific assertions below exact.
    const expectedExpiredSessions = await prisma.pluginSession.count({
      where: { expiresAt: { lte: NOW } },
    })
    const expectedExpiredCodes = await prisma.pluginAuthorizationCode.findMany({
      where: { expiresAt: { lte: NOW } },
      select: { id: true },
    })
    const expectedActiveLinks = await prisma.pluginSession.findMany({
      where: {
        authorizationCodeId: { in: expectedExpiredCodes.map(({ id }) => id) },
        revokedAt: null,
        expiresAt: { gt: NOW },
      },
      select: { authorizationCodeId: true },
    })
    const expectedActiveCodeIds = new Set(
      expectedActiveLinks
        .map(({ authorizationCodeId }) => authorizationCodeId)
        .filter(Boolean),
    )

    const result = await reapExpiredPluginAuthRecords({ db: prisma, now: NOW })

    expect(result).toEqual({
      deletedSessions: expectedExpiredSessions,
      deletedAuthorizationCodes: expectedExpiredCodes.length - expectedActiveCodeIds.size,
    })
    expect(await prisma.pluginSession.findUnique({ where: { id: revokedSession.id } })).toMatchObject({ revokedAt })
    expect(await prisma.pluginSession.findUnique({ where: { id: activeSession.id } })).toMatchObject({ revokedAt: null })
    expect(await prisma.pluginAuthorizationCode.findUnique({ where: { id: expiredLinkedCode.id } })).toBeNull()
    expect(await prisma.pluginAuthorizationCode.findUnique({ where: { id: expiredUnlinkedCode.id } })).toBeNull()
    expect(await prisma.pluginAuthorizationCode.findUnique({ where: { id: boundaryCode.id } })).toBeNull()
    expect(await prisma.pluginAuthorizationCode.findUnique({ where: { id: revokedLinkedCode.id } })).toBeNull()
    expect(await prisma.pluginAuthorizationCode.findUnique({ where: { id: futureCode.id } })).not.toBeNull()
    expect(await prisma.pluginAuthorizationCode.findUnique({ where: { id: activeLinkedCode.id } })).not.toBeNull()

    // @spec D3-identity-onboarding-forms-03 — the reaper's own deletes are audited.
    const reapEvent = await prisma.auditEvent.findFirst({
      where: { entityType: 'PluginAuthMaintenance', action: 'PLUGIN_AUTH_RECORDS_REAPED', entityId: `reap:${NOW.toISOString()}` },
    })
    expect(reapEvent).toMatchObject({ action: 'PLUGIN_AUTH_RECORDS_REAPED' })
    expect(JSON.parse(reapEvent.payloadJson)).toMatchObject({
      deletedSessions: result.deletedSessions,
      deletedAuthorizationCodes: result.deletedAuthorizationCodes,
    })
  })

  it('retains an expired consumed code until its active session is gone so replay still revokes it', async () => {
    const subject = await fixture('replay')
    const authorizeInput = {
      response_type: 'code',
      client_id: CLIENT_ID,
      redirect_uri: REDIRECT_URI,
      code_challenge: CHALLENGE,
      code_challenge_method: 'S256',
      state: 'state_reaper_replay_001',
      installation_id: subject.installation.installationId,
    }
    const authorization = await createPluginAuthorizationCode({
      db: prisma,
      principalId: subject.person.id,
      input: authorizeInput,
      env: ENV,
      now: NOW,
    })
    const exchangeInput = {
      grant_type: 'authorization_code',
      code: authorization.code,
      client_id: CLIENT_ID,
      redirect_uri: REDIRECT_URI,
      code_verifier: VERIFIER,
      installation_id: subject.installation.installationId,
    }
    const exchange = await exchangePluginAuthorizationCode({ db: prisma, input: exchangeInput, env: ENV, now: NOW })
    const linkedSession = await prisma.pluginSession.findUnique({ where: { id: exchange.sessionId } })
    const storedCode = await prisma.pluginAuthorizationCode.findUnique({
      where: { codeHash: createHash('sha256').update(authorization.code).digest('hex') },
    })
    expect(linkedSession).toMatchObject({
      authorizationCodeId: expect.any(String),
      revokedAt: null,
      expiresAt: later(900),
    })
    expect(linkedSession.authorizationCodeId).toBe(storedCode.id)
    expect(await prisma.pluginSession.findMany({
      where: { authorizationCodeId: storedCode.id, revokedAt: null, expiresAt: { gt: later(61) } },
    })).toHaveLength(1)

    await expect(reapExpiredPluginAuthRecords({ db: prisma, now: later(61) }))
      .resolves.toEqual({ deletedSessions: 0, deletedAuthorizationCodes: 0 })
    expect(await prisma.pluginAuthorizationCode.findUnique({
      where: { codeHash: createHash('sha256').update(authorization.code).digest('hex') },
    })).toMatchObject({ consumedAt: NOW })

    await expect(exchangePluginAuthorizationCode({ db: prisma, input: exchangeInput, env: ENV, now: later(62) }))
      .rejects.toMatchObject({ code: 'INVALID_GRANT', status: 400 })
    expect(await prisma.pluginSession.findUnique({ where: { id: exchange.sessionId } })).toMatchObject({ revokedAt: later(62) })

    // @spec D3-identity-onboarding-forms-03 — mint, issue and replay-revoke are
    // all audited, and none of those rows carry the code or access token.
    const auditRows = await prisma.auditEvent.findMany({
      where: { entityId: { in: [storedCode.id, exchange.sessionId] } },
    })
    expect(auditRows.map((row) => row.action)).toEqual(expect.arrayContaining([
      'PLUGIN_AUTH_CODE_MINTED', 'PLUGIN_SESSION_ISSUED', 'PLUGIN_SESSION_REVOKED_REPLAY',
    ]))
    const serializedAudit = JSON.stringify(auditRows)
    expect(serializedAudit).not.toContain(authorization.code)
    expect(serializedAudit).not.toContain(exchange.accessToken)
    expect(serializedAudit).not.toContain(VERIFIER)
  })

  it('orders reaper-first expiry cleanup before redemption without creating a session', async () => {
    const subject = await fixture('interleaving')
    const authorizeInput = {
      response_type: 'code',
      client_id: CLIENT_ID,
      redirect_uri: REDIRECT_URI,
      code_challenge: CHALLENGE,
      code_challenge_method: 'S256',
      state: 'state_reaper_race_001',
      installation_id: subject.installation.installationId,
    }
    const authorization = await createPluginAuthorizationCode({
      db: prisma,
      principalId: subject.person.id,
      input: authorizeInput,
      env: ENV,
      now: NOW,
    })
    const exchangeInput = {
      grant_type: 'authorization_code',
      code: authorization.code,
      client_id: CLIENT_ID,
      redirect_uri: REDIRECT_URI,
      code_verifier: VERIFIER,
      installation_id: subject.installation.installationId,
    }

    const lockAcquired = deferred()
    const releaseReaper = deferred()
    const exchangeTransactionRequested = deferred()
    const reaperDb = controlledDb({
      onReaperRaw: {
        after: async () => {
          lockAcquired.resolve()
          await releaseReaper.promise
        },
      },
    })
    const exchangeDb = controlledDb({ onTransactionRequested: () => exchangeTransactionRequested.resolve() })
    const reapPromise = reapExpiredPluginAuthRecords({ db: reaperDb, now: later(61) })
    await lockAcquired.promise
    const exchangePromise = exchangePluginAuthorizationCode({ db: exchangeDb, input: exchangeInput, env: ENV, now: NOW })
    await exchangeTransactionRequested.promise
    releaseReaper.resolve()
    const [exchange, reap] = await Promise.allSettled([exchangePromise, reapPromise])

    expect(exchange.status).toBe('rejected')
    expect(exchange.reason).toMatchObject({ code: 'INVALID_GRANT', status: 400 })
    expect(reap).toMatchObject({ status: 'fulfilled', value: { deletedSessions: 0, deletedAuthorizationCodes: 1 } })
    expect(await prisma.pluginSession.count({ where: { pluginInstallationId: subject.installation.id } })).toBe(0)
    expect(await prisma.pluginAuthorizationCode.count({ where: { pluginInstallationId: subject.installation.id } })).toBe(0)
  })

  it('orders redemption-first expiry cleanup after session creation and preserves replay linkage', async () => {
    const subject = await fixture('interleaving-commit')
    const authorizeInput = {
      response_type: 'code',
      client_id: CLIENT_ID,
      redirect_uri: REDIRECT_URI,
      code_challenge: CHALLENGE,
      code_challenge_method: 'S256',
      state: 'state_reaper_race_002',
      installation_id: subject.installation.installationId,
    }
    const authorization = await createPluginAuthorizationCode({
      db: prisma,
      principalId: subject.person.id,
      input: authorizeInput,
      env: ENV,
      now: NOW,
    })
    const exchangeInput = {
      grant_type: 'authorization_code',
      code: authorization.code,
      client_id: CLIENT_ID,
      redirect_uri: REDIRECT_URI,
      code_verifier: VERIFIER,
      installation_id: subject.installation.installationId,
    }
    const exchangeClaimed = deferred()
    const releaseExchange = deferred()
    const reaperTransactionRequested = deferred()
    const exchangeDb = controlledDb({
      onCodeUpdateClaimed: async () => {
        exchangeClaimed.resolve()
        await releaseExchange.promise
      },
    })
    const reaperDb = controlledDb({ onTransactionRequested: () => reaperTransactionRequested.resolve() })
    const exchangePromise = exchangePluginAuthorizationCode({ db: exchangeDb, input: exchangeInput, env: ENV, now: NOW })
    await exchangeClaimed.promise
    const reapPromise = reapExpiredPluginAuthRecords({ db: reaperDb, now: later(61) })
    await reaperTransactionRequested.promise
    releaseExchange.resolve()
    const [exchange, reap] = await Promise.allSettled([exchangePromise, reapPromise])

    expect(exchange).toMatchObject({ status: 'fulfilled', value: { sessionId: expect.any(String) } })
    expect(reap).toMatchObject({ status: 'fulfilled', value: { deletedSessions: 0, deletedAuthorizationCodes: 0 } })
    const code = await prisma.pluginAuthorizationCode.findUnique({
      where: { codeHash: createHash('sha256').update(authorization.code).digest('hex') },
    })
    const session = await prisma.pluginSession.findUnique({ where: { id: exchange.value.sessionId } })
    expect(code).not.toBeNull()
    expect(session).toMatchObject({ authorizationCodeId: code.id, revokedAt: null })
  })

  it('is idempotent when run again after cleanup', async () => {
    const subject = await fixture('idempotent')
    await createCode(subject, 'expired')

    await expect(reapExpiredPluginAuthRecords({ db: prisma, now: NOW }))
      .resolves.toEqual({ deletedSessions: 0, deletedAuthorizationCodes: 1 })
    await expect(reapExpiredPluginAuthRecords({ db: prisma, now: NOW }))
      .resolves.toEqual({ deletedSessions: 0, deletedAuthorizationCodes: 0 })
  })
})
