import prisma from '@/lib/db'
import { resolveRequestViewer } from './request-viewer'
import { resolveViewer } from './resolve-viewer'
import { assertPluginAuthorizeParameters, derivePluginCapabilitiesForViewer } from './plugin-auth-service'
import {
  issuePluginConsentCsrfToken,
  pluginConsentSessionBinding,
  signPluginConsentRequest,
} from './plugin-consent'

// @req FR-123 — the server-side seam behind the plugin consent screen. Nothing
// the screen shows comes from the query string: the plugin's name comes from
// registered configuration, the capability list from the viewer the plugin will
// actually resolve to, and the account from the trusted session.
// @spec ADR-052 D3/D4, SDD-074, SEC-022
// @tested tests/unit/fr123-plugin-consent-view.test.js
//
// Deliberately free of `next/headers` and `next/navigation`, so the decision
// this file makes can be exercised directly in a unit test. The Next-only
// wiring that feeds it lives in `plugin-consent-access.js` — the same split
// FR-124's product-readiness seam uses, and for the same reason.

function serverRequest(cookieHeader) {
  return new Request('https://zuri.local/plugin/authorize', { headers: { cookie: cookieHeader } })
}

/**
 * Build everything the consent screen renders, or say why it cannot be shown.
 *
 * Returns one of:
 *   { state: 'AUTH_REQUIRED' }                — caller should send them to /login
 *   { state: 'SESSION_UNAVAILABLE' }          — the session store is down, not a refusal
 *   { state: 'INVALID_REQUEST' }              — parameters failed the same checks the mint applies
 *   { state: 'READY', consent: {...} }
 *
 * An INVALID_REQUEST is deliberately *not* redirected anywhere. The only place
 * to send an error is `redirect_uri`, and at that point `redirect_uri` is
 * precisely the field that failed validation — bouncing the browser to it would
 * turn the consent gate into an open redirect.
 */
export async function buildPluginConsent({
  searchParams,
  cookieHeader,
  sessionCookieValue,
  db = prisma,
  env = process.env,
  resolveRequest = resolveRequestViewer,
  resolvePluginViewer = resolveViewer,
  now = Date.now(),
} = {}) {
  let viewer
  try {
    viewer = await resolveRequest(serverRequest(cookieHeader))
  } catch (error) {
    return { state: Number(error?.status) === 401 ? 'AUTH_REQUIRED' : 'SESSION_UNAVAILABLE' }
  }
  if (!viewer?.principal?.id) return { state: 'AUTH_REQUIRED' }
  if (typeof sessionCookieValue !== 'string' || !sessionCookieValue) return { state: 'AUTH_REQUIRED' }

  let parameters
  let config
  try {
    ({ parameters, config } = assertPluginAuthorizeParameters(searchParams ?? {}, { env }))
  } catch {
    return { state: 'INVALID_REQUEST' }
  }

  // @spec ADR-052 D3 — the browser viewer carries `platformGrant`; the plugin's
  // will not. Deriving the displayed capabilities from the browser viewer would
  // show a platform DEV a wider list than the plugin is ever granted, which is
  // the exact direction a consent screen must never be wrong in. So the viewer
  // is re-resolved here the same way `getPluginCapabilities` resolves it — by
  // principal id alone, no grant passed.
  const pluginViewer = await resolvePluginViewer({ principalId: viewer.principal.id, db })
  const sessionBinding = pluginConsentSessionBinding(sessionCookieValue)

  return {
    state: 'READY',
    consent: {
      pluginName: config.clientName,
      clientId: config.clientId,
      redirectUri: parameters.redirect_uri,
      installationId: parameters.installation_id,
      account: {
        id: viewer.principal.id,
        code: viewer.principal.code ?? null,
        displayName: viewer.principal.displayName ?? null,
      },
      capabilities: derivePluginCapabilitiesForViewer(pluginViewer),
      csrfToken: issuePluginConsentCsrfToken({ sessionBinding, env }),
      requestToken: signPluginConsentRequest({ parameters, principalId: viewer.principal.id, sessionBinding, env, now }),
    },
  }
}
