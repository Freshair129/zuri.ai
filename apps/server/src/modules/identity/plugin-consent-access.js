import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { AUTH_SESSION_COOKIE } from './auth-service'
import { buildPluginConsent } from './plugin-consent-view'

// @req FR-123 — the Next-only wiring behind the plugin consent screen. It reads
// the request's cookies and nothing else; every decision is made in
// `plugin-consent-view.js`, which is importable without a Next runtime and is
// where the tests live.
// @spec ADR-052 D3/D4, SDD-074, SEC-022
// @tested tests/unit/fr123-plugin-consent-view.test.js

export async function readPluginConsent(searchParams) {
  const jar = cookies()
  const cookieHeader = jar.getAll().map(({ name, value }) => `${name}=${encodeURIComponent(value)}`).join('; ')
  const result = await buildPluginConsent({
    searchParams,
    cookieHeader,
    sessionCookieValue: jar.get(AUTH_SESSION_COOKIE)?.value ?? null,
  })
  // A person who is simply not signed in is sent to sign in, not shown a
  // refusal. Nothing about the request is carried into the login URL: a `next`
  // parameter on /login would be a new redirect surface, and this gate is not
  // the place to open one.
  if (result.state === 'AUTH_REQUIRED') redirect('/login')
  return result
}
