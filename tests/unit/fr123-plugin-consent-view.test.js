import { describe, expect, it, vi } from 'vitest'
import { buildPluginConsent } from '@/modules/identity/plugin-consent-view'
import { verifyPluginConsentRequest, pluginConsentSessionBinding } from '@/modules/identity/plugin-consent'

// @req FR-123 — what the consent screen is allowed to say, and where each fact
// it says comes from. A capability list assembled from caller input would be
// decoration; this test is what stops it becoming that.
// @spec ADR-052 D3/D4, SDD-074, SEC-022
// @tested tests/unit/fr123-plugin-consent-view.test.js

const env = {
  ZURI_SESSION_SECRET: 'consent-view-secret-that-is-long-enough-0123456789',
  ZURI_PLUGIN_CLIENT_ID: 'zuri-plugin-view',
  ZURI_PLUGIN_REDIRECT_URIS: 'http://127.0.0.1:43123/callback',
  ZURI_PLUGIN_CLIENT_NAME: 'Zuri Harness (registered name)',
}

const SESSION_COOKIE = 'zuri_sess.payload.signature'

const searchParams = {
  response_type: 'code',
  client_id: 'zuri-plugin-view',
  redirect_uri: 'http://127.0.0.1:43123/callback',
  code_challenge: 'Q'.repeat(43),
  code_challenge_method: 'S256',
  state: 'state_view_consent_0001',
  installation_id: 'install_view_0001',
}

const browserViewer = {
  principal: { id: 'person-1', code: 'PER-001', displayName: 'Somchai' },
  // A platform DEV at a browser: visible everywhere, owns nothing.
  visibleBusinessIds: ['biz-a', 'biz-b', 'biz-c'],
  ownedBusinessIds: [],
}

function build(overrides = {}) {
  return buildPluginConsent({
    searchParams,
    cookieHeader: `zuri_session=${SESSION_COOKIE}`,
    sessionCookieValue: SESSION_COOKIE,
    env,
    db: {},
    resolveRequest: vi.fn(async () => browserViewer),
    resolvePluginViewer: vi.fn(async () => ({ visibleBusinessIds: [], ownedBusinessIds: [] })),
    ...overrides,
  })
}

describe('FR-123 plugin consent view', () => {
  it('shows the registered plugin name, never a caller-supplied one', async () => {
    const result = await build({ searchParams: { ...searchParams, client_name: 'Totally Trustworthy Inc' } })
    expect(result.state).toBe('READY')
    expect(result.consent.pluginName).toBe('Zuri Harness (registered name)')
    expect(JSON.stringify(result.consent)).not.toContain('Totally Trustworthy')
  })

  // @spec ADR-052 D3 — the screen must show what the *plugin* will receive. The
  // browser viewer carries `platformGrant`; the plugin's viewer never does. If
  // the screen derived its list from the browser viewer it would over-state the
  // grant to exactly the people whose grant is widest.
  it('derives capabilities from a viewer resolved without the platform grant', async () => {
    const resolvePluginViewer = vi.fn(async () => ({ visibleBusinessIds: [], ownedBusinessIds: [] }))
    const result = await build({ resolvePluginViewer })

    expect(resolvePluginViewer).toHaveBeenCalledWith(expect.objectContaining({ principalId: 'person-1' }))
    expect(resolvePluginViewer).not.toHaveBeenCalledWith(expect.objectContaining({ platformGrant: true }))
    // The browser viewer sees three Businesses; the plugin viewer sees none, and
    // it is the plugin viewer the screen reports.
    expect(result.consent.capabilities).toEqual([])
  })

  it('marks owner-scoped writes as requiring approval and never invents a capability', async () => {
    const result = await build({
      resolvePluginViewer: vi.fn(async () => ({ visibleBusinessIds: ['biz-a'], ownedBusinessIds: ['biz-a'] })),
    })
    const byAccess = Object.fromEntries(result.consent.capabilities.map((c) => [c.capability, c]))
    expect(byAccess['plan.preview']).toMatchObject({ access: 'read', requiresApproval: false })
    expect(byAccess['plan.commit']).toMatchObject({ access: 'write', requiresApproval: true })
    expect(result.consent.capabilities.every((c) => ['read', 'write'].includes(c.access))).toBe(true)
  })

  it('issues a request token that verifies back to exactly the displayed parameters', async () => {
    const result = await build()
    const { parameters } = verifyPluginConsentRequest({
      token: result.consent.requestToken,
      principalId: 'person-1',
      sessionBinding: pluginConsentSessionBinding(SESSION_COOKIE),
      env,
    })
    expect(parameters.redirect_uri).toBe(result.consent.redirectUri)
    expect(parameters.client_id).toBe(result.consent.clientId)
    expect(parameters.installation_id).toBe(result.consent.installationId)
    expect(parameters.state).toBe(searchParams.state)
  })

  it('refuses parameters the mint would refuse, without resolving a plugin viewer or naming a target', async () => {
    const resolvePluginViewer = vi.fn()
    const result = await build({
      searchParams: { ...searchParams, redirect_uri: 'http://127.0.0.1:9/unregistered' },
      resolvePluginViewer,
    })
    expect(result.state).toBe('INVALID_REQUEST')
    expect(resolvePluginViewer).not.toHaveBeenCalled()
    expect(JSON.stringify(result)).not.toContain('127.0.0.1:9')
  })

  it('separates "not signed in" from "session store is down"', async () => {
    const authRequired = await build({
      resolveRequest: vi.fn(async () => { throw Object.assign(new Error('AUTH_REQUIRED'), { status: 401 }) }),
    })
    expect(authRequired.state).toBe('AUTH_REQUIRED')

    const outage = await build({
      resolveRequest: vi.fn(async () => { throw Object.assign(new Error('SESSION_UNAVAILABLE'), { status: 503 }) }),
    })
    expect(outage.state).toBe('SESSION_UNAVAILABLE')
  })

  it('refuses when the plugin client is not configured at all', async () => {
    const result = await build({ env: { ZURI_SESSION_SECRET: env.ZURI_SESSION_SECRET } })
    expect(result.state).toBe('INVALID_REQUEST')
  })
})
