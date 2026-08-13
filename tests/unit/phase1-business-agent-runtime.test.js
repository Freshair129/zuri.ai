import { describe, it, expect, vi } from 'vitest'
import { assertPhase1TransportAuthorization, createPhase1BusinessAgentPortsFromEnv } from '@/modules/agent/phase1-runtime'
import { createOpenRouterAuthorization, exchangeOpenRouterCode } from '@/modules/agent/openrouter-oauth'

// @req FR-048 — Phase 1 provider selection and OpenRouter OAuth PKCE are configuration boundaries.
// @spec SDD-025, SEC-009
// @tested tests/unit/phase1-business-agent-runtime.test.js

describe('Phase 1 business-agent runtime', () => {
  it('is off by default and fails closed when enabled without required server secrets', () => {
    expect(createPhase1BusinessAgentPortsFromEnv({})).toBeNull()
    expect(() => createPhase1BusinessAgentPortsFromEnv({ ZURI_LINE_BUSINESS_AGENT_ENABLED: 'true' })).toThrow(/configuration/i)
  })

  it('builds Supabase and selected provider ports from server-only environment values', () => {
    const ports = createPhase1BusinessAgentPortsFromEnv({
      ZURI_LINE_BUSINESS_AGENT_ENABLED: 'true',
      SUPABASE_URL: 'https://example.supabase.co',
      SUPABASE_SECRET_KEY: 'server-only',
      ZURI_MODEL_PROVIDER: 'groq',
      ZURI_MODEL_NAME: 'llama-test',
      ZURI_MODEL_CREDENTIAL: 'provider-secret',
      ZURI_LINE_TRANSPORT_TOKEN: 'transport-secret-long-enough',
    }, { fetchFn: vi.fn() })
    expect(ports.businessKnowledge.query).toBeTypeOf('function')
    expect(ports.model.provider).toBe('groq')
    expect(JSON.stringify(ports)).not.toContain('server-only')
    expect(JSON.stringify(ports)).not.toContain('provider-secret')
  })

  it('requires a server-to-server bearer token before Phase 1 work', () => {
    const env = { ZURI_LINE_BUSINESS_AGENT_ENABLED: 'true', ZURI_LINE_TRANSPORT_TOKEN: 'transport-secret-long-enough' }
    expect(() => assertPhase1TransportAuthorization(new Headers(), env)).toThrow(/unauthorized/i)
    expect(() => assertPhase1TransportAuthorization(new Headers({ authorization: 'Bearer wrong' }), env)).toThrow(/unauthorized/i)
    expect(assertPhase1TransportAuthorization(new Headers({ authorization: 'Bearer transport-secret-long-enough' }), env)).toBe(true)
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
