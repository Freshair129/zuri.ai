import { describe, it, expect } from 'vitest'
import {
  CONNECTION_HEALTH_STATES,
  DEFAULT_STALE_AFTER_MS,
  evaluateConnectionHealth,
} from '@/platform/integrations/core/connection-health'

// @req FR-080 — AC-075.3 health field on the Integration read model.
// @spec ADR-032, SEC-016 — metadata only: the calculator reads whether a secret
//   reference exists and whether it expired, never the secret itself.

const NOW = new Date('2026-08-19T12:00:00.000Z')
const agoMs = (ms) => new Date(NOW.getTime() - ms)

const channel = (over = {}) => ({
  status: 'ACTIVE',
  role: 'PRIMARY',
  externalAccountId: 'Uline-oa',
  provider: { code: 'LINE_OA' },
  ...over,
})

const modelProvider = (over = {}) => ({
  status: 'ACTIVE',
  role: 'PRIMARY',
  provider: { code: 'openai' },
  metadataJson: JSON.stringify({ model: 'gpt-x' }),
  ...over,
})

const evalChannel = (connection, rest = {}) =>
  evaluateConnectionHealth({ connection, kind: 'CHANNEL', now: NOW, ...rest })
const evalProvider = (connection, rest = {}) =>
  evaluateConnectionHealth({ connection, kind: 'MODEL_PROVIDER', now: NOW, ...rest })

describe('evaluateConnectionHealth (FR-080 AC-075.3)', () => {
  it('reports CONNECTED for a channel that is enabled, configured and recently active', () => {
    const health = evalChannel(channel(), { lastEventAt: agoMs(60_000) })
    expect(health.state).toBe('CONNECTED')
    expect(health.reasons).toEqual([])
    expect(health.evidence).toMatchObject({
      kind: 'CHANNEL', provider: 'LINE_OA', lastEventAgeMs: 60_000,
    })
  })

  it('will not call a channel CONNECTED on configuration alone', () => {
    // never observed working — green here is the claim an operator would regret
    const health = evalChannel(channel(), { lastEventAt: null })
    expect(health.state).toBe('DEGRADED')
    expect(health.reasons).toEqual(['NO_TRAFFIC_OBSERVED'])
  })

  it('degrades a channel that has gone quiet past the window', () => {
    expect(evalChannel(channel(), { lastEventAt: agoMs(DEFAULT_STALE_AFTER_MS + 1) }).state)
      .toBe('DEGRADED')
    expect(evalChannel(channel(), { lastEventAt: agoMs(DEFAULT_STALE_AFTER_MS + 1) }).reasons)
      .toEqual(['TRAFFIC_STALE'])
    // exactly at the boundary is still healthy — the window is "older than", not "at"
    expect(evalChannel(channel(), { lastEventAt: agoMs(DEFAULT_STALE_AFTER_MS) }).state)
      .toBe('CONNECTED')
  })

  it('honours a caller-supplied staleness window', () => {
    const opts = { lastEventAt: agoMs(90_000), staleAfterMs: 60_000 }
    expect(evalChannel(channel(), opts).state).toBe('DEGRADED')
    expect(evalChannel(channel(), { ...opts, staleAfterMs: 120_000 }).state).toBe('CONNECTED')
  })

  it('reports DISABLED before anything else, but still names what else is wrong', () => {
    const health = evalChannel(channel({ status: 'DRAFT', externalAccountId: null }))
    expect(health.state).toBe('DISABLED')
    // precedence picks the headline; it must not hide the rest
    expect(health.reasons).toEqual(['CONNECTION_DRAFT', 'MISSING_EXTERNAL_ACCOUNT_ID'])
  })

  it('reports MISCONFIGURED for a channel with no account to listen to', () => {
    const health = evalChannel(channel({ externalAccountId: '   ' }))
    expect(health.state).toBe('MISCONFIGURED')
    expect(health.reasons).toContain('MISSING_EXTERNAL_ACCOUNT_ID')
  })

  it('does not demand a channel secret, which belongs to zuri-cli (BR-011)', () => {
    // requiring one here would report MISCONFIGURED for a channel that works fine
    expect(evalChannel(channel(), { credential: null, lastEventAt: agoMs(1000) }).state)
      .toBe('CONNECTED')
  })

  it('separates missing configuration from a broken credential', () => {
    // absent reference is something nobody set up yet
    expect(evalProvider(modelProvider(), { credential: null }).state).toBe('MISCONFIGURED')
    expect(evalProvider(modelProvider(), { credential: null }).reasons).toEqual(['MISSING_SECRET_REF'])

    // a reference that has stopped working is a different problem with a different fix
    const expired = { secretRef: 'supabase-vault:abc', status: 'ACTIVE', expiresAt: agoMs(1) }
    expect(evalProvider(modelProvider(), { credential: expired }).state).toBe('ERROR')
    expect(evalProvider(modelProvider(), { credential: expired }).reasons).toEqual(['CREDENTIAL_EXPIRED'])

    const revoked = { secretRef: 'supabase-vault:abc', status: 'REVOKED' }
    expect(evalProvider(modelProvider(), { credential: revoked }).reasons).toEqual(['CREDENTIAL_REVOKED'])
  })

  it('does not judge a model provider on silence', () => {
    // an LLM connection has no inbound stream; requiring traffic would leave every
    // one of them permanently DEGRADED
    const credential = { secretRef: 'supabase-vault:abc', status: 'ACTIVE' }
    const health = evalProvider(modelProvider(), { credential, lastEventAt: null })
    expect(health.state).toBe('CONNECTED')
    expect(health.evidence.staleAfterMs).toBeNull()
  })

  it('treats Ollama as credential-free by design (FR-079)', () => {
    const ollama = modelProvider({ provider: { code: 'ollama' } })
    expect(evalProvider(ollama, { credential: null }).state).toBe('CONNECTED')
  })

  it('reports MISCONFIGURED for a model provider with no model set', () => {
    const noModel = modelProvider({ metadataJson: JSON.stringify({}) })
    const credential = { secretRef: 'supabase-vault:abc', status: 'ACTIVE' }
    expect(evalProvider(noModel, { credential }).reasons).toEqual(['MISSING_MODEL'])
  })

  it('survives metadataJson that is not valid JSON rather than throwing', () => {
    const broken = modelProvider({ metadataJson: '{not json' })
    const credential = { secretRef: 'supabase-vault:abc', status: 'ACTIVE' }
    expect(evalProvider(broken, { credential }).state).toBe('MISCONFIGURED')
  })

  it('never returns a state outside the declared vocabulary', () => {
    const cases = [
      evalChannel(channel()),
      evalChannel(channel({ status: 'DISABLED' })),
      evalChannel(channel({ externalAccountId: null })),
      evalChannel(channel(), { lastEventAt: agoMs(1000) }),
      evalProvider(modelProvider(), { credential: { secretRef: 'x', status: 'ACTIVE' } }),
      evalProvider(modelProvider(), { credential: { secretRef: 'x', status: 'EXPIRED' } }),
    ]
    for (const health of cases) expect(CONNECTION_HEALTH_STATES).toContain(health.state)
  })

  it('refuses a call it cannot answer instead of guessing', () => {
    expect(() => evaluateConnectionHealth({})).toThrow(/CONNECTION_REQUIRED/)
    expect(() => evaluateConnectionHealth({ connection: channel(), kind: 'WHATEVER' }))
      .toThrow(/CONNECTION_KIND_INVALID/)
  })

  it('leaks no secret material into the evidence it returns', () => {
    const credential = { secretRef: 'supabase-vault:11111111-2222-3333-4444-555555555555', status: 'ACTIVE' }
    const health = evalProvider(modelProvider(), { credential })
    expect(JSON.stringify(health)).not.toContain('11111111-2222-3333-4444-555555555555')
    expect(JSON.stringify(health)).not.toContain('supabase-vault:')
  })
})
