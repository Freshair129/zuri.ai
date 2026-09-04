import { createHash } from 'node:crypto'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createPluginAuthorizationCode,
  exchangePluginAuthorizationCode,
  getPluginCapabilities,
  revokePluginToken,
} from '@/modules/identity/plugin-auth-service'

// @req FR-123 — the plugin authorization boundary: PKCE-bound single-use codes,
// short-lived opaque sessions, viewer-derived capabilities, idempotent revoke.
// @spec ADR-052, SDD-074, SEC-022
// @tested tests/unit/fr123-plugin-auth-service.test.js

const NOW = new Date('2026-08-30T04:00:00.000Z')

function createDb() {
  const installations = new Map()
  const codes = new Map()
  const sessions = new Map()
  const auditEvents = []
  let sequence = 0

  const db = {
    auditEvent: {
      create: vi.fn(async ({ data }) => {
        const row = { id: `audit-${++sequence}`, ...data }
        auditEvents.push(row)
        return row
      }),
    },
    pluginInstallation: {
      findUnique: vi.fn(async ({ where }) => {
        if (where.installationId) return [...installations.values()].find((row) => row.installationId === where.installationId) || null
        if (where.id) return installations.get(where.id) || null
        return null
      }),
      create: vi.fn(async ({ data }) => {
        const row = { id: `installation-${++sequence}`, ...data }
        installations.set(row.id, row)
        return row
      }),
    },
    pluginAuthorizationCode: {
      create: vi.fn(async ({ data }) => {
        const row = { id: `code-${++sequence}`, ...data }
        codes.set(row.id, row)
        return row
      }),
      findUnique: vi.fn(async ({ where, include }) => {
        const row = where.codeHash
          ? [...codes.values()].find((candidate) => candidate.codeHash === where.codeHash)
          : codes.get(where.id)
        if (!row) return null
        return include?.pluginInstallation
          ? { ...row, pluginInstallation: installations.get(row.pluginInstallationId) }
          : row
      }),
      updateMany: vi.fn(async ({ where, data }) => {
        const row = codes.get(where.id)
        if (!row || (where.consumedAt === null && row.consumedAt !== null) || (where.revokedAt === null && row.revokedAt !== null)) {
          return { count: 0 }
        }
        Object.assign(row, data)
        return { count: 1 }
      }),
    },
    pluginSession: {
      create: vi.fn(async ({ data }) => {
        const row = { id: `session-${++sequence}`, ...data }
        sessions.set(row.id, row)
        return row
      }),
      findUnique: vi.fn(async ({ where, include }) => {
        const row = [...sessions.values()].find((candidate) => candidate.tokenHash === where.tokenHash) || null
        if (!row) return null
        return include?.pluginInstallation
          ? { ...row, pluginInstallation: installations.get(row.pluginInstallationId) }
          : row
      }),
      updateMany: vi.fn(async ({ where, data }) => {
        const matches = [...sessions.values()].filter((candidate) => {
          if (where.tokenHash !== undefined && candidate.tokenHash !== where.tokenHash) return false
          if (where.authorizationCodeId !== undefined && candidate.authorizationCodeId !== where.authorizationCodeId) return false
          if (where.revokedAt === null && candidate.revokedAt !== null) return false
          return true
        })
        for (const row of matches) Object.assign(row, data)
        return { count: matches.length }
      }),
    },
    $transaction: vi.fn(async (callback) => callback(db)),
  }

  return { db, installations, codes, sessions, auditEvents }
}

const configEnv = {
  ZURI_PLUGIN_CLIENT_ID: 'zuri-plugin-v1',
  ZURI_PLUGIN_REDIRECT_URIS: 'http://127.0.0.1:43123/callback',
  ZURI_PLUGIN_POLICY_SNAPSHOT_ID: 'zuri-plugin-policy.v1',
}

const TEST_VERIFIER = 'verifier_test_001_abcdefghijklmnopqrstuvwxyz_1234567890'
const TEST_CHALLENGE = createHash('sha256').update(TEST_VERIFIER).digest('base64url')

const authorizeInput = {
  response_type: 'code',
  client_id: 'zuri-plugin-v1',
  redirect_uri: 'http://127.0.0.1:43123/callback',
  code_challenge: TEST_CHALLENGE,
  code_challenge_method: 'S256',
  state: 'state_test_001_long_enough',
  installation_id: 'install_test_001',
}

const tokenInput = (code) => ({
  grant_type: 'authorization_code',
  code,
  client_id: 'zuri-plugin-v1',
  redirect_uri: authorizeInput.redirect_uri,
  code_verifier: TEST_VERIFIER,
  installation_id: authorizeInput.installation_id,
})

async function authorizeAndExchange(db, { state = authorizeInput.state } = {}) {
  const authorization = await createPluginAuthorizationCode({
    db, principalId: 'person-1', input: { ...authorizeInput, state }, env: configEnv, now: NOW,
  })
  const exchange = await exchangePluginAuthorizationCode({
    db, input: tokenInput(authorization.code), env: configEnv, now: NOW,
  })
  return { authorization, exchange }
}

describe('FR-123 plugin auth service', () => {
  beforeEach(() => {
    vi.unstubAllEnvs()
  })

  it('issues a hashed, short-lived authorization code for the trusted principal only', async () => {
    const { db, codes } = createDb()
    const result = await createPluginAuthorizationCode({
      db,
      principalId: 'person-1',
      input: authorizeInput,
      env: configEnv,
      now: NOW,
    })

    expect(result.code).toMatch(/^[A-Za-z0-9_-]{40,}$/)
    expect(result.expiresAt).toBe('2026-08-30T04:01:00.000Z')
    const stored = [...codes.values()][0]
    expect(stored.codeHash).not.toBe(result.code)
    expect(stored.personId).toBe('person-1')
    expect(stored.clientId).toBe('zuri-plugin-v1')
    expect(stored.redirectUri).toBe(authorizeInput.redirect_uri)
    expect(stored.codeChallenge).toBe(authorizeInput.code_challenge)
    expect(stored.installationId).toBeUndefined()
  })

  it('refuses to mint a code without a principal', async () => {
    const { db } = createDb()
    await expect(createPluginAuthorizationCode({
      db, principalId: '', input: authorizeInput, env: configEnv, now: NOW,
    })).rejects.toMatchObject({ code: 'AUTH_REQUIRED', status: 401 })
    expect(db.pluginAuthorizationCode.create).not.toHaveBeenCalled()
  })

  it('rejects missing configuration and an unregistered redirect before creating a code', async () => {
    const { db } = createDb()
    await expect(createPluginAuthorizationCode({
      db,
      principalId: 'person-1',
      input: authorizeInput,
      env: { ZURI_PLUGIN_CLIENT_ID: 'zuri-plugin-v1' },
      now: NOW,
    })).rejects.toMatchObject({ code: 'PLUGIN_AUTH_CONFIG_MISSING', status: 503 })

    await expect(createPluginAuthorizationCode({
      db,
      principalId: 'person-1',
      input: { ...authorizeInput, redirect_uri: 'https://evil.example/callback' },
      env: configEnv,
      now: NOW,
    })).rejects.toMatchObject({ code: 'INVALID_REQUEST', status: 400 })
    expect(db.pluginAuthorizationCode.create).not.toHaveBeenCalled()
  })

  // The RCA at .brain/rca/2026-08-24-plugin-auth-loopback-verifier.md records a
  // Preview run where the transport rewrote 127.0.0.1 to localhost and the fix
  // was to register both spellings, NOT to normalize loopback hosts here. This
  // holds that decision down: an unregistered spelling of the same host is
  // still an unregistered redirect.
  it('does not treat localhost and 127.0.0.1 as the same registered redirect', async () => {
    const { db } = createDb()
    await expect(createPluginAuthorizationCode({
      db,
      principalId: 'person-1',
      input: { ...authorizeInput, redirect_uri: 'http://localhost:43123/callback' },
      env: configEnv,
      now: NOW,
    })).rejects.toMatchObject({ code: 'INVALID_REQUEST', status: 400 })
  })

  it('atomically exchanges the code with PKCE and rejects replay', async () => {
    const { db, sessions } = createDb()
    const authorization = await createPluginAuthorizationCode({
      db,
      principalId: 'person-1',
      input: authorizeInput,
      env: configEnv,
      now: NOW,
    })

    await expect(exchangePluginAuthorizationCode({
      db,
      input: { ...tokenInput(authorization.code), code_verifier: 'wrong_verifier_001_abcdefghijklmnopqrstuvwxyz_1234567890' },
      env: configEnv,
      now: NOW,
    })).rejects.toMatchObject({ code: 'INVALID_GRANT', status: 400 })
    expect(sessions.size).toBe(0)

    const exchange = await exchangePluginAuthorizationCode({
      db, input: tokenInput(authorization.code), env: configEnv, now: NOW,
    })

    expect(exchange.accessToken).toMatch(/^[A-Za-z0-9_-]{40,}$/)
    expect(exchange.tokenType).toBe('Bearer')
    expect(exchange.expiresIn).toBe(15 * 60)
    expect(exchange.principalId).toBe('person-1')
    expect(exchange.installationId).toBe('install_test_001')
    expect([...sessions.values()][0].tokenHash).not.toBe(exchange.accessToken)
    await expect(exchangePluginAuthorizationCode({
      db, input: tokenInput(authorization.code), env: configEnv, now: NOW,
    })).rejects.toMatchObject({ code: 'INVALID_GRANT', status: 400 })
  })

  it('never returns refresh material or tenant/business authority in the token response', async () => {
    const { db } = createDb()
    const { exchange } = await authorizeAndExchange(db)
    expect(Object.keys(exchange).sort()).toEqual([
      'accessToken', 'expiresAt', 'expiresIn', 'installationId', 'principalId', 'sessionId', 'tokenType',
    ])
    const serialized = JSON.stringify(exchange).toLowerCase()
    for (const forbidden of ['refresh', 'tenant', 'business', 'membership', 'role']) {
      expect(serialized).not.toContain(forbidden)
    }
  })

  // Single-use is a database predicate, not a read-then-write. Two redemptions
  // that both pass the pre-read must still produce exactly one session: the
  // loser's conditional update matches zero rows and it throws before creating
  // anything. Racing them with Promise.all is the only shape that can fail if
  // somebody later replaces the conditional update with a plain update.
  it('yields exactly one session when the same code is redeemed concurrently', async () => {
    const { db, sessions } = createDb()
    const authorization = await createPluginAuthorizationCode({
      db, principalId: 'person-1', input: authorizeInput, env: configEnv, now: NOW,
    })

    const results = await Promise.allSettled([
      exchangePluginAuthorizationCode({ db, input: tokenInput(authorization.code), env: configEnv, now: NOW }),
      exchangePluginAuthorizationCode({ db, input: tokenInput(authorization.code), env: configEnv, now: NOW }),
    ])

    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1)
    expect(results.filter((r) => r.status === 'rejected')).toHaveLength(1)
    expect(results.find((r) => r.status === 'rejected').reason).toMatchObject({ code: 'INVALID_GRANT' })
    expect(sessions.size).toBe(1)
  })

  // RFC 9700 §4.1.1: a replayed code is evidence the code leaked after use, so
  // the session it already minted must not survive the replay.
  it('revokes the session a replayed code already produced', async () => {
    const { db, sessions } = createDb()
    const { authorization, exchange } = await authorizeAndExchange(db)
    expect([...sessions.values()][0].revokedAt).toBeNull()

    await expect(exchangePluginAuthorizationCode({
      db, input: tokenInput(authorization.code), env: configEnv, now: NOW,
    })).rejects.toMatchObject({ code: 'INVALID_GRANT', status: 400 })

    expect([...sessions.values()][0].revokedAt).toEqual(NOW)
    await expect(getPluginCapabilities({
      db, token: exchange.accessToken, env: configEnv, now: NOW,
    })).rejects.toMatchObject({ code: 'AUTH_REQUIRED', status: 401 })
  })

  it('derives capabilities from the resolved viewer and never from client scope', async () => {
    const { db } = createDb()
    const { exchange } = await authorizeAndExchange(db)
    const resolveViewer = vi.fn(async () => ({
      principal: { id: 'person-1' },
      visibleBusinessIds: ['business-1'],
      ownedBusinessIds: ['business-1'],
    }))

    const capabilities = await getPluginCapabilities({
      db,
      token: exchange.accessToken,
      env: configEnv,
      now: NOW,
      resolveViewer,
    })

    expect(resolveViewer).toHaveBeenCalledWith({ principalId: 'person-1', db })
    // Cross-tenant platform visibility is never inherited by a plugin session.
    expect(resolveViewer.mock.calls[0][0].platformGrant).toBeUndefined()
    expect(capabilities.policy_snapshot_id).toBe('zuri-plugin-policy.v1')
    expect(capabilities.capabilities.map((item) => item.capability)).toEqual(expect.arrayContaining([
      'plan.preview', 'plan.commit', 'pipeline.get', 'pipeline.start', 'connector.list', 'connector.health',
    ]))
    expect(capabilities.capabilities.filter((item) => item.access === 'write').every((item) => item.requiresApproval)).toBe(true)
    expect(JSON.stringify(capabilities)).not.toContain('business-1')
    expect(JSON.stringify(capabilities)).not.toContain(exchange.accessToken)
  })

  it('gives a viewer who owns nothing no write capabilities at all', async () => {
    const { db } = createDb()
    const { exchange } = await authorizeAndExchange(db)
    const capabilities = await getPluginCapabilities({
      db,
      token: exchange.accessToken,
      env: configEnv,
      now: NOW,
      resolveViewer: async () => ({ principal: { id: 'person-1' }, visibleBusinessIds: ['business-1'], ownedBusinessIds: [] }),
    })
    expect(capabilities.capabilities.some((item) => item.access === 'write')).toBe(false)
  })

  it('refuses capability discovery once the session has expired', async () => {
    const { db } = createDb()
    const { exchange } = await authorizeAndExchange(db)
    const afterExpiry = new Date(NOW.getTime() + (15 * 60 + 1) * 1000)
    await expect(getPluginCapabilities({
      db, token: exchange.accessToken, env: configEnv, now: afterExpiry, resolveViewer: async () => ({}),
    })).rejects.toMatchObject({ code: 'AUTH_REQUIRED', status: 401 })
  })

  it('makes revoke idempotent and stops capability access', async () => {
    const { db } = createDb()
    const { exchange } = await authorizeAndExchange(db)

    await expect(revokePluginToken({ db, token: exchange.accessToken, now: NOW })).resolves.toEqual({ revoked: true })
    await expect(revokePluginToken({ db, token: exchange.accessToken, now: NOW })).resolves.toEqual({ revoked: true })
    // A token that never existed answers exactly the same, so revoke discloses
    // nothing about which tokens are real.
    await expect(revokePluginToken({ db, token: 'never_issued_token', now: NOW })).resolves.toEqual({ revoked: true })
    await expect(getPluginCapabilities({ db, token: exchange.accessToken, env: configEnv, now: NOW })).rejects.toMatchObject({
      code: 'AUTH_REQUIRED',
      status: 401,
    })
  })

  // @spec D3-identity-onboarding-forms-03 — every plugin-auth write is audited,
  // and none of those audit payloads may carry the secret material the write
  // itself handled.
  describe('audit coverage (D3-identity-onboarding-forms-03)', () => {
    it('audits a new installation and the authorization code mint, without the code in the payload', async () => {
      const { db, auditEvents } = createDb()
      const result = await createPluginAuthorizationCode({
        db, principalId: 'person-1', input: authorizeInput, env: configEnv, now: NOW,
      })

      const installationEvent = auditEvents.find((event) => event.action === 'PLUGIN_INSTALLATION_CREATED')
      expect(installationEvent).toMatchObject({
        entityType: 'PLUGIN_INSTALLATION',
        actorId: 'person-1',
      })
      const mintEvent = auditEvents.find((event) => event.action === 'PLUGIN_AUTH_CODE_MINTED')
      expect(mintEvent).toMatchObject({
        entityType: 'PLUGIN_AUTHORIZATION_CODE',
        actorId: 'person-1',
      })
      const serialized = JSON.stringify(auditEvents)
      expect(serialized).not.toContain(result.code)
      expect(serialized).not.toContain(authorizeInput.code_challenge)

      // A second code minted for the same installation must not audit a
      // second installation creation — only the code mint fires again.
      const before = auditEvents.filter((event) => event.action === 'PLUGIN_INSTALLATION_CREATED').length
      await createPluginAuthorizationCode({
        db, principalId: 'person-1', input: { ...authorizeInput, state: 'state_test_002_long_enough' }, env: configEnv, now: NOW,
      })
      expect(auditEvents.filter((event) => event.action === 'PLUGIN_INSTALLATION_CREATED')).toHaveLength(before)
    })

    it('audits session issuance on exchange, without the access token, code or verifier in the payload', async () => {
      const { db, auditEvents } = createDb()
      const { authorization, exchange } = await authorizeAndExchange(db)

      const issuedEvent = auditEvents.find((event) => event.action === 'PLUGIN_SESSION_ISSUED')
      expect(issuedEvent).toMatchObject({ entityType: 'PLUGIN_SESSION', actorType: 'PLUGIN' })
      const serialized = JSON.stringify(auditEvents)
      expect(serialized).not.toContain(exchange.accessToken)
      expect(serialized).not.toContain(authorization.code)
      expect(serialized).not.toContain(TEST_VERIFIER)
    })

    it('audits the replay-triggered session revocation, without the replayed code in the payload', async () => {
      const { db, auditEvents } = createDb()
      const { authorization } = await authorizeAndExchange(db)

      await expect(exchangePluginAuthorizationCode({
        db, input: tokenInput(authorization.code), env: configEnv, now: NOW,
      })).rejects.toMatchObject({ code: 'INVALID_GRANT' })

      const replayEvent = auditEvents.find((event) => event.action === 'PLUGIN_SESSION_REVOKED_REPLAY')
      expect(replayEvent).toMatchObject({ entityType: 'PLUGIN_AUTHORIZATION_CODE' })
      expect(JSON.stringify(auditEvents)).not.toContain(authorization.code)
    })

    it('audits explicit token revoke, without the token in the payload', async () => {
      const { db, auditEvents } = createDb()
      const { exchange } = await authorizeAndExchange(db)

      await revokePluginToken({ db, token: exchange.accessToken, now: NOW })

      const revokeEvent = auditEvents.find((event) => event.action === 'PLUGIN_TOKEN_REVOKED')
      expect(revokeEvent).toMatchObject({ entityType: 'PLUGIN_SESSION', actorType: 'PLUGIN' })
      expect(JSON.stringify(auditEvents)).not.toContain(exchange.accessToken)

      // Revoking a token that never existed must not fabricate an audit row —
      // that would make the audit stream itself an oracle over real tokens.
      const before = auditEvents.length
      await revokePluginToken({ db, token: 'never_issued_token', now: NOW })
      expect(auditEvents).toHaveLength(before)
    })
  })
})
