import { NextResponse } from 'next/server'
import prisma from '@/lib/db'
import { createPluginAuthorizationCode } from '@/modules/identity/plugin-auth-service'
import {
  assertPluginConsentCsrfToken,
  pluginConsentSessionBindingFromRequest,
  verifyPluginConsentRequest,
} from '@/modules/identity/plugin-consent'
import { resolveRequestViewer } from '@/modules/identity/request-viewer'

// @req FR-123 — authorization is split in two: GET renders and never acts, POST
// acts and only from the consent screen's own form.
// @spec ADR-052 D4, SDD-074, SEC-022
// @tested tests/unit/fr123-plugin-auth-route.test.js, tests/e2e/fr123-plugin-consent.spec.js
//
// WHY GET STOPPED MINTING
// -----------------------
// `zuri_session` is `sameSite: 'lax'`, and Lax *sends* the cookie on a top-level
// GET navigation. So while GET minted, any page that could cause a navigation —
// a link, a `window.location`, a 302 — issued an authorization code for a
// signed-in person with nothing shown to them and nothing asked of them. The
// redirect allowlist bounded where the code went; it did nothing about whether
// the person agreed to it going. GET is now a same-origin redirect to the
// consent screen: it reads no session, touches no database, and mints nothing,
// so there is no longer a state-changing operation for a navigation to trigger.

export const dynamic = 'force-dynamic'

const CONSENT_PATH = '/plugin/authorize'
const publicErrorCodes = new Set(['AUTH_REQUIRED', 'AUTH_UNAVAILABLE', 'INVALID_REQUEST', 'INVALID_GRANT', 'PLUGIN_AUTH_CONFIG_MISSING'])

// `resolveRequestViewer` throws `httpError`, which carries a status but no
// `code`, so the fallback is chosen by status rather than fixed. Reporting a
// 503 session outage as `AUTH_REQUIRED` would tell a caller to re-authenticate
// against a boundary that is merely unavailable.
function errorResponse(error) {
  const status = Number(error?.status) === 401 ? 401 : Number(error?.status) === 400 ? 400 : 503
  const fallback = status === 401 ? 'AUTH_REQUIRED' : status === 400 ? 'INVALID_REQUEST' : 'AUTH_UNAVAILABLE'
  const code = publicErrorCodes.has(error?.code) ? error.code : fallback
  return NextResponse.json({ error: code }, { status, headers: { 'Cache-Control': 'no-store' } })
}

export function GET(request) {
  const url = new URL(request.url)
  // A fixed path on this request's own origin, so the query string cannot steer
  // the destination. The parameters ride along unvalidated on purpose: the page
  // validates them through the same service check the mint applies, and a second
  // validator here would be a second definition of a valid request.
  const target = new URL(CONSENT_PATH, url.origin)
  target.search = url.search
  return NextResponse.redirect(target, { status: 302, headers: { 'Cache-Control': 'no-store' } })
}

function readDecision(value) {
  return value === 'approve' ? 'approve' : value === 'deny' ? 'deny' : null
}

// @spec SEC-022 — a form submission is the user gesture. There is no second
// gesture check on top of it: the person pressed a button on a page that stated
// what pressing it does, and inventing another signal to look for would be
// theatre, not consent.
export async function POST(request) {
  let viewer
  try {
    viewer = await resolveRequestViewer(request)
  } catch (error) {
    return errorResponse(error)
  }
  if (!viewer?.principal?.id) {
    return NextResponse.json({ error: 'AUTH_REQUIRED' }, { status: 401, headers: { 'Cache-Control': 'no-store' } })
  }

  let form
  try {
    form = await request.formData()
  } catch {
    return NextResponse.json({ error: 'INVALID_REQUEST' }, { status: 400, headers: { 'Cache-Control': 'no-store' } })
  }

  try {
    const sessionBinding = pluginConsentSessionBindingFromRequest(request)
    // Order matters: the anti-CSRF token is checked before anything is decoded,
    // so a cross-origin post is refused without this handler having parsed a
    // single attacker-supplied field.
    assertPluginConsentCsrfToken({ token: form.get('csrf_token'), sessionBinding })

    // Every authorization parameter comes from here and from nowhere else in the
    // request. The form carries no client_id, redirect_uri, challenge or state
    // for this handler to trust, so the POST is structurally incapable of being
    // handed different parameters than the ones the consent screen displayed.
    const { parameters } = verifyPluginConsentRequest({
      token: form.get('request_token'),
      principalId: viewer.principal.id,
      sessionBinding,
    })

    const decision = readDecision(form.get('decision'))
    if (!decision) throw Object.assign(new Error('INVALID_REQUEST'), { code: 'INVALID_REQUEST', status: 400 })

    const redirect = new URL(parameters.redirect_uri)
    redirect.searchParams.set('state', parameters.state)
    if (decision === 'deny') {
      // OAuth 2.0 §4.1.2.1 — refusal is an answer, not a dead end. Without it
      // the plugin hangs on a callback that never arrives and the person has no
      // way to say no.
      redirect.searchParams.set('error', 'access_denied')
      return NextResponse.redirect(redirect, { status: 303, headers: { 'Cache-Control': 'no-store' } })
    }

    const result = await createPluginAuthorizationCode({
      db: prisma,
      principalId: viewer.principal.id,
      input: { response_type: 'code', ...parameters },
    })
    // Safe only because the service already refused any redirect_uri outside the
    // configured allowlist — twice: once when the consent screen was rendered,
    // and again on this request, against configuration as it stands now.
    redirect.searchParams.set('code', result.code)
    return NextResponse.redirect(redirect, { status: 303, headers: { 'Cache-Control': 'no-store' } })
  } catch (error) {
    return errorResponse(error)
  }
}
