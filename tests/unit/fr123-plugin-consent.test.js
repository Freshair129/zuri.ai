import { describe, expect, it } from 'vitest'
import {
  PLUGIN_CONSENT_REQUEST_TTL_SECONDS,
  assertPluginConsentCsrfToken,
  issuePluginConsentCsrfToken,
  pluginConsentSessionBinding,
  pluginConsentSessionBindingFromRequest,
  signPluginConsentRequest,
  verifyPluginConsentRequest,
} from '@/modules/identity/plugin-consent'

// @req FR-123 — the two tokens the consent gate stands on, tested at the unit
// where each field is decided rather than only through the route.
// @spec ADR-052 D4, SDD-074, SEC-022
// @tested tests/unit/fr123-plugin-consent.test.js

const env = {
  ZURI_SESSION_SECRET: 'consent-unit-secret-that-is-long-enough-0123456789',
  ZURI_PLUGIN_CLIENT_ID: 'zuri-plugin-unit',
  ZURI_PLUGIN_REDIRECT_URIS: 'http://127.0.0.1:43123/callback,http://127.0.0.1:43199/other',
}

const parameters = {
  client_id: 'zuri-plugin-unit',
  redirect_uri: 'http://127.0.0.1:43123/callback',
  code_challenge: 'Q'.repeat(43),
  code_challenge_method: 'S256',
  state: 'state_unit_consent_0001',
  installation_id: 'install_unit_0001',
}

const binding = pluginConsentSessionBinding('a-session-cookie-value')
const sign = (overrides = {}) => signPluginConsentRequest({ parameters, principalId: 'person-1', sessionBinding: binding, env, ...overrides })
const verify = (token, overrides = {}) =>
  verifyPluginConsentRequest({ token, principalId: 'person-1', sessionBinding: binding, env, ...overrides })

function reclaim(token, changes) {
  const [prefix, payload, signature] = token.split('.')
  const claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'))
  const forged = Buffer.from(JSON.stringify({ ...claims, ...changes }), 'utf8').toString('base64url')
  return `${prefix}.${forged}.${signature}`
}

describe('FR-123 consent session binding', () => {
  it('never carries session material and changes when the session does', () => {
    const a = pluginConsentSessionBinding('cookie-a')
    const b = pluginConsentSessionBinding('cookie-b')
    expect(a).not.toBe(b)
    expect(a).not.toContain('cookie-a')
    expect(a).toMatch(/^[a-f0-9]{64}$/)
  })

  it('refuses to bind when there is no session cookie at all', () => {
    expect(() => pluginConsentSessionBinding(null)).toThrow()
    expect(() => pluginConsentSessionBindingFromRequest(new Request('http://local/x'))).toThrow()
  })

  it('reads the same cookie the session port reads', () => {
    const request = new Request('http://local/x', { headers: { cookie: `other=1; zuri_session=${encodeURIComponent('abc.def')}` } })
    expect(pluginConsentSessionBindingFromRequest(request)).toBe(pluginConsentSessionBinding('abc.def'))
  })
})

describe('FR-123 anti-CSRF token', () => {
  it('accepts the token issued for this session and refuses one issued for another', () => {
    const mine = issuePluginConsentCsrfToken({ sessionBinding: binding, env })
    expect(assertPluginConsentCsrfToken({ token: mine, sessionBinding: binding, env })).toBe(true)

    const theirs = issuePluginConsentCsrfToken({ sessionBinding: pluginConsentSessionBinding('someone-else'), env })
    expect(() => assertPluginConsentCsrfToken({ token: theirs, sessionBinding: binding, env })).toThrow()
  })

  it('refuses an absent, empty or truncated token', () => {
    const mine = issuePluginConsentCsrfToken({ sessionBinding: binding, env })
    for (const token of [undefined, null, '', mine.slice(0, -1), mine.replace('zuri_pcsrf', 'zuri_other')]) {
      expect(() => assertPluginConsentCsrfToken({ token, sessionBinding: binding, env })).toThrow()
    }
  })
})

describe('FR-123 signed request token', () => {
  it('round-trips the exact parameters the screen displayed', () => {
    const { parameters: verified } = verify(sign())
    expect(verified).toMatchObject(parameters)
    expect(verified.response_type).toBe('code')
  })

  it('binds installation_id too, so no displayed parameter is left unsigned', () => {
    expect(() => verify(reclaim(sign(), { installation_id: 'install_someone_else' }))).toThrow()
  })

  for (const field of ['client_id', 'redirect_uri', 'code_challenge', 'code_challenge_method', 'state', 'principal_id', 'session_binding', 'exp']) {
    it(`refuses a token whose ${field} was changed after signing`, () => {
      const forged = field === 'exp'
        ? reclaim(sign(), { exp: Math.floor(Date.now() / 1000) + 86400 })
        : reclaim(sign(), { [field]: 'tampered-value' })
      expect(() => verify(forged)).toThrow()
    })
  }

  it('refuses a token bound to a different session even though the principal matches', () => {
    expect(() => verify(sign(), { sessionBinding: pluginConsentSessionBinding('a-different-cookie') })).toThrow()
  })

  it('refuses a token bound to a different principal even though the session matches', () => {
    expect(() => verify(sign(), { principalId: 'person-2' })).toThrow()
  })

  it('refuses a token signed with a different secret', () => {
    const foreign = sign({ env: { ...env, ZURI_SESSION_SECRET: 'a-completely-different-secret-0123456789ab' } })
    expect(() => verify(foreign)).toThrow()
  })

  it('expires', () => {
    const token = sign({ now: Date.now() - (PLUGIN_CONSENT_REQUEST_TTL_SECONDS + 1) * 1000 })
    expect(() => verify(token)).toThrow()
    // Still valid a second before the boundary, so the refusal above is the TTL
    // doing its job rather than the token never having verified at all.
    expect(() => verify(sign({ now: Date.now() - (PLUGIN_CONSENT_REQUEST_TTL_SECONDS - 5) * 1000 }))).not.toThrow()
  })

  // The signature says "this server said this five minutes ago". It cannot say
  // "and it is still true", which is why verification re-runs the parameter
  // checks against configuration as it stands now.
  it('refuses a genuinely signed token whose redirect_uri is no longer registered', () => {
    const token = signPluginConsentRequest({
      parameters: { ...parameters, redirect_uri: 'http://127.0.0.1:1/gone' },
      principalId: 'person-1',
      sessionBinding: binding,
      env,
    })
    expect(() => verify(token)).toThrow()
  })

  it('refuses a genuinely signed token once the client id has been rotated', () => {
    const token = sign()
    expect(() => verify(token, { env: { ...env, ZURI_PLUGIN_CLIENT_ID: 'rotated-client-id' } })).toThrow()
  })

  it('refuses malformed tokens rather than throwing something unhandled', () => {
    for (const token of [undefined, '', 'not-a-token', 'zuri_pcreq.only-two-parts', 'zuri_pcreq..sig']) {
      expect(() => verify(token)).toThrow()
    }
  })
})
