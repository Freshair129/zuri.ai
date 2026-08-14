import { describe, it, expect, vi } from 'vitest'
import crypto from 'node:crypto'
import {
  createPhase1BusinessAgentPortsFromEnv,
  executeAsLineReadRole,
  resolvePhase1RequestScope,
} from '@/modules/agent/phase1-runtime'
import { createOpenRouterAuthorization, exchangeOpenRouterCode } from '@/modules/agent/openrouter-oauth'

// @req FR-048 — Phase 1 provider selection and OpenRouter OAuth PKCE are configuration boundaries.
// @spec SDD-025, SEC-009
// @tested tests/unit/phase1-business-agent-runtime.test.js

describe('Phase 1 business-agent runtime', () => {
  it('is off by default and fails closed when enabled without required server secrets', () => {
    expect(createPhase1BusinessAgentPortsFromEnv({})).toBeNull()
    expect(() => createPhase1BusinessAgentPortsFromEnv({ ZURI_LINE_BUSINESS_AGENT_ENABLED: 'true' })).toThrow(/configuration/i)
  })

  it('rejects a Supabase secret key because it bypasses RLS', () => {
    expect(() => createPhase1BusinessAgentPortsFromEnv({
      ZURI_LINE_BUSINESS_AGENT_ENABLED: 'true',
      SUPABASE_URL: 'https://example.supabase.co',
      SUPABASE_SECRET_KEY: 'server-only',
      ZURI_MODEL_PROVIDER: 'groq',
      ZURI_MODEL_NAME: 'llama-test',
      ZURI_MODEL_CREDENTIAL: 'provider-secret',
      ZURI_LINE_TRANSPORT_TOKEN: 'transport-secret-long-enough',
    }, { fetchFn: vi.fn() })).toThrow(/secret.*forbidden|bypass/i)
  })

  it('builds scope-bound Postgres and selected provider ports from server-only values', () => {
    const queryFn = vi.fn()
    const ports = createPhase1BusinessAgentPortsFromEnv({
      ZURI_LINE_BUSINESS_AGENT_ENABLED: 'true',
      ZURI_LINE_DB_URL: 'postgresql://zuri_line_smartgift_login:password@db.example.supabase.co:5432/postgres',
      ZURI_LINE_BINDING_HASH_PEPPER: 'p'.repeat(32),
      ZURI_MODEL_PROVIDER: 'groq',
      ZURI_MODEL_NAME: 'llama-test',
      ZURI_MODEL_CREDENTIAL: 'provider-secret',
    }, { fetchFn: vi.fn(), queryFn })
    expect(ports.businessKnowledge.query).toBeTypeOf('function')
    expect(ports.bindingResolver.resolve).toBeTypeOf('function')
    expect(ports.model.provider).toBe('groq')
    expect(JSON.stringify(ports)).not.toContain('password')
    expect(JSON.stringify(ports)).not.toContain('provider-secret')
  })

  it('executes each database query under the NOLOGIN read role in a short transaction', async () => {
    const client = {
      query: vi.fn()
        .mockResolvedValueOnce(undefined)
        .mockResolvedValueOnce(undefined)
        .mockResolvedValueOnce({ rows: [{ ok: true }] })
        .mockResolvedValueOnce(undefined),
      release: vi.fn(),
    }
    const pool = { connect: vi.fn(async () => client) }

    await expect(executeAsLineReadRole(pool, 'select $1::text', ['safe'])).resolves.toEqual({ rows: [{ ok: true }] })
    expect(client.query.mock.calls).toEqual([
      ['begin'],
      ['set local role zuri_line_smartgift_ro'],
      ['select $1::text', ['safe']],
      ['commit'],
    ])
    expect(client.release).toHaveBeenCalledOnce()
  })

  it('rolls back and releases the database connection when a scoped query fails', async () => {
    const queryError = new Error('query failed')
    const client = {
      query: vi.fn()
        .mockResolvedValueOnce(undefined)
        .mockResolvedValueOnce(undefined)
        .mockRejectedValueOnce(queryError)
        .mockResolvedValueOnce(undefined),
      release: vi.fn(),
    }

    await expect(executeAsLineReadRole({ connect: async () => client }, 'select broken', [])).rejects.toBe(queryError)
    expect(client.query).toHaveBeenLastCalledWith('rollback')
    expect(client.release).toHaveBeenCalledOnce()
  })

  it('rejects client-selected tenant or Business scope when production runtime is enabled', async () => {
    const runtime = { bindingResolver: { resolve: vi.fn() } }
    await expect(resolvePhase1RequestScope({
      runtime,
      headers: new Headers({ authorization: 'Bearer ' + 'x'.repeat(32) }),
      body: { bindingId: crypto.randomUUID(), destination: 'Udest', tenantId: 'attacker-tenant' },
    })).rejects.toMatchObject({ message: 'PHASE1_CLIENT_SCOPE_FORBIDDEN', status: 400 })
    expect(runtime.bindingResolver.resolve).not.toHaveBeenCalled()
  })

  it('returns only scope resolved by the active LINE binding', async () => {
    const resolved = {
      id: crypto.randomUUID(), code: 'LINE-SMARTGIFT-OA',
      tenantId: crypto.randomUUID(), businessId: crypto.randomUUID(),
    }
    const runtime = { bindingResolver: { resolve: vi.fn(async () => resolved) } }
    const headers = new Headers({ authorization: 'Bearer ' + 'x'.repeat(32) })
    const body = { bindingId: resolved.id, destination: 'Udest' }
    await expect(resolvePhase1RequestScope({ runtime, headers, body })).resolves.toEqual(resolved)
    expect(runtime.bindingResolver.resolve).toHaveBeenCalledWith({
      bindingId: resolved.id, destination: 'Udest', authorization: 'Bearer ' + 'x'.repeat(32),
    })
  })
})

describe('OpenRouter OAuth PKCE (FR-048)', () => {
  it('creates a S256 authorization request without embedding a client secret', () => {
    const auth = createOpenRouterAuthorization({ callbackUrl: 'https://zuri.example/auth/openrouter/callback' })
    const url = new URL(auth.authorizationUrl)
    expect(url.searchParams.get('code_challenge_method')).toBe('S256')
    expect(url.searchParams.get('code_challenge')).toBeTruthy()
    expect(url.searchParams.get('callback_url')).toBe('https://zuri.example/auth/openrouter/callback')
    expect(auth.codeVerifier.length).toBeGreaterThanOrEqual(43)
    expect(auth.state.length).toBeGreaterThanOrEqual(32)
    expect(auth.authorizationUrl).not.toContain(auth.codeVerifier)
  })

  it('exchanges a code and returns only the user-controlled OpenRouter key', async () => {
    const fetchFn = vi.fn(async () => new Response(JSON.stringify({ key: 'sk-or-user-key' }), { status: 200 }))
    const result = await exchangeOpenRouterCode({
      code: 'one-time-code', codeVerifier: 'v'.repeat(64),
      callbackUrl: 'https://zuri.example/auth/openrouter/callback', fetchFn,
    })
    expect(result).toEqual({ provider: 'openrouter', credential: 'sk-or-user-key' })
  })
})
