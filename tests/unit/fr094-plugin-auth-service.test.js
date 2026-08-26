import { createHash } from 'node:crypto'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createPluginAuthorizationCode,
  exchangePluginAuthorizationCode,
  getPluginCapabilities,
  revokePluginToken,
} from '@/modules/identity/plugin-auth-service'

const NOW = new Date('2026-08-23T04:00:00.000Z')

function createDb() {
  const installations = new Map()
  const codes = new Map()
  const sessions = new Map()
  let sequence = 0

  const db = {
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
        const row = [...sessions.values()].find((candidate) => candidate.tokenHash === where.tokenHash)
        if (!row || (where.revokedAt === null && row.revokedAt !== null)) return { count: 0 }
        Object.assign(row, data)
        return { count: 1 }
      }),
    },
    $transaction: vi.fn(async (callback) => callback(db)),
  }

  return { db, installations, codes, sessions }
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

describe('FR-094 plugin auth service', () => {
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
    expect(result.expiresAt).toBe('2026-08-23T04:01:00.000Z')
    const stored = [...codes.values()][0]
    expect(stored.codeHash).not.toBe(result.code)
    expect(stored.personId).toBe('person-1')
    expect(stored.clientId).toBe('zuri-plugin-v1')
    expect(stored.redirectUri).toBe(authorizeInput.redirect_uri)
    expect(stored.codeChallenge).toBe(authorizeInput.code_challenge)
    expect(stored.installationId).toBeUndefined()
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

  it('atomically exchanges the code with PKCE and rejects replay', async () => {
    const { db, sessions } = createDb()
    const authorization = await createPluginAuthorizationCode({
      db,
      principalId: 'person-1',
      input: { ...authorizeInput, code_challenge: TEST_CHALLENGE },
      env: configEnv,
      now: NOW,
    })
    const verifier = 'wrong_verifier_001_abcdefghijklmnopqrstuvwxyz_1234567890'

    await expect(exchangePluginAuthorizationCode({
      db,
      input: {
        grant_type: 'authorization_code',
        code: authorization.code,
        client_id: 'zuri-plugin-v1',
        redirect_uri: authorizeInput.redirect_uri,
        code_verifier: verifier,
        installation_id: authorizeInput.installation_id,
      },
      env: configEnv,
      now: NOW,
    })).rejects.toMatchObject({ code: 'INVALID_GRANT', status: 400 })

    const secondAuthorization = await createPluginAuthorizationCode({
      db,
      principalId: 'person-1',
      input: { ...authorizeInput, code_challenge: TEST_CHALLENGE, state: 'state_test_002_long_enough' },
      env: configEnv,
      now: NOW,
    })
    const exchange = await exchangePluginAuthorizationCode({
      db,
      input: {
        grant_type: 'authorization_code',
        code: secondAuthorization.code,
        client_id: 'zuri-plugin-v1',
        redirect_uri: authorizeInput.redirect_uri,
        code_verifier: TEST_VERIFIER,
        installation_id: authorizeInput.installation_id,
      },
      env: configEnv,
      now: NOW,
    })

    expect(exchange.accessToken).toMatch(/^[A-Za-z0-9_-]{40,}$/)
    expect(exchange.tokenType).toBe('Bearer')
    expect(exchange.principalId).toBe('person-1')
    expect(exchange.installationId).toBe('install_test_001')
    expect([...sessions.values()][0].tokenHash).not.toBe(exchange.accessToken)
    await expect(exchangePluginAuthorizationCode({
      db,
      input: {
        grant_type: 'authorization_code',
        code: secondAuthorization.code,
        client_id: 'zuri-plugin-v1',
        redirect_uri: authorizeInput.redirect_uri,
        code_verifier: TEST_VERIFIER,
        installation_id: authorizeInput.installation_id,
      },
      env: configEnv,
      now: NOW,
    })).rejects.toMatchObject({ code: 'INVALID_GRANT', status: 400 })
  })

  it('derives capabilities from the resolved viewer and never from client scope', async () => {
    const { db } = createDb()
    const authorization = await createPluginAuthorizationCode({
      db,
      principalId: 'person-1',
      input: authorizeInput,
      env: configEnv,
      now: NOW,
    })
    const token = await exchangePluginAuthorizationCode({
      db,
      input: {
        grant_type: 'authorization_code',
        code: authorization.code,
        client_id: 'zuri-plugin-v1',
        redirect_uri: authorizeInput.redirect_uri,
        code_verifier: TEST_VERIFIER,
        installation_id: authorizeInput.installation_id,
      },
      env: configEnv,
      now: NOW,
    })
    const resolveViewer = vi.fn(async () => ({
      principal: { id: 'person-1' },
      visibleBusinessIds: ['business-1'],
      ownedBusinessIds: ['business-1'],
    }))

    const capabilities = await getPluginCapabilities({
      db,
      token: token.accessToken,
      env: configEnv,
      now: NOW,
      resolveViewer,
    })

    expect(resolveViewer).toHaveBeenCalledWith({ principalId: 'person-1', db })
    expect(capabilities.policy_snapshot_id).toBe('zuri-plugin-policy.v1')
    expect(capabilities.capabilities.map((item) => item.capability)).toEqual(expect.arrayContaining([
      'plan.preview', 'plan.commit', 'pipeline.get', 'pipeline.start', 'connector.list', 'connector.health',
    ]))
    expect(JSON.stringify(capabilities)).not.toContain('business-1')
    expect(JSON.stringify(capabilities)).not.toContain(token.accessToken)
  })

  it('makes revoke idempotent and stops capability access', async () => {
    const { db } = createDb()
    const authorization = await createPluginAuthorizationCode({
      db,
      principalId: 'person-1',
      input: authorizeInput,
      env: configEnv,
      now: NOW,
    })
    const token = await exchangePluginAuthorizationCode({
      db,
      input: {
        grant_type: 'authorization_code',
        code: authorization.code,
        client_id: 'zuri-plugin-v1',
        redirect_uri: authorizeInput.redirect_uri,
        code_verifier: TEST_VERIFIER,
        installation_id: authorizeInput.installation_id,
      },
      env: configEnv,
      now: NOW,
    })

    await expect(revokePluginToken({ db, token: token.accessToken, now: NOW })).resolves.toEqual({ revoked: true })
    await expect(revokePluginToken({ db, token: token.accessToken, now: NOW })).resolves.toEqual({ revoked: true })
    await expect(getPluginCapabilities({ db, token: token.accessToken, env: configEnv, now: NOW })).rejects.toMatchObject({
      code: 'AUTH_REQUIRED',
      status: 401,
    })
  })
})
