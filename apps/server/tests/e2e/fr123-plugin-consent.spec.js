// @req FR-123 — the consent screen is reachable and operable by a person: it
// is driven here by clicking, not by posting to the endpoint, because "the
// screen exists" and "the screen works" are different claims and only the
// second one closes the gate.
// @spec ADR-052 D4, SDD-074, SEC-022
// @tested tests/e2e/fr123-plugin-consent.spec.js
const { createHash, randomBytes } = require('node:crypto')
const { test, expect } = require('@playwright/test')
const { loginAsOwner } = require('./e2e-auth')
const { E2E_PLUGIN_CLIENT_ID, E2E_PLUGIN_CLIENT_NAME, e2ePluginRedirectUri } = require('./e2e-plugin')

const REDIRECT_URI = e2ePluginRedirectUri()

function authorizeUrl({ state, installationId, codeChallenge }) {
  const query = new URLSearchParams({
    response_type: 'code',
    client_id: E2E_PLUGIN_CLIENT_ID,
    redirect_uri: REDIRECT_URI,
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
    state,
    installation_id: installationId,
  })
  return `/api/plugin/auth/authorize?${query.toString()}`
}

function pkce() {
  const verifier = randomBytes(32).toString('base64url')
  return { verifier, challenge: createHash('sha256').update(verifier, 'utf8').digest('base64url') }
}

// `loginAsOwner` returns as soon as the Sign in button is clicked; the session
// cookie only exists once that fetch resolves. Waiting for the post-login
// landing page here is what stops the next navigation racing the cookie.
async function signIn(page) {
  await loginAsOwner(page)
  await expect(page).toHaveURL(/\/businesses/)
}

function attempt() {
  const { verifier, challenge } = pkce()
  const state = `state_e2e_${randomBytes(8).toString('hex')}`
  const installationId = `install_e2e_${randomBytes(6).toString('hex')}`
  return { verifier, state, installationId, url: authorizeUrl({ state, installationId, codeChallenge: challenge }) }
}

test.describe('FR-123 plugin authorization consent', () => {
  test('a GET navigation lands on a consent screen instead of handing the plugin a code', async ({ page }) => {
    await signIn(page)
    const run = attempt()

    // This is the shape of the defect: a top-level GET navigation carrying the
    // SameSite=Lax session cookie. It used to end at the redirect URI with a
    // code in the query string. It must now end on the consent screen.
    const response = await page.goto(run.url)

    // The screen carries the anti-CSRF and signed request tokens in its markup,
    // so it must never be cacheable by anything in front of the app. Asserted
    // rather than assumed: this is a framework default, and defaults move.
    expect(response.headers()['cache-control']).toContain('no-store')

    await expect(page).toHaveURL(/\/plugin\/authorize\?/)
    expect(page.url()).not.toContain('code=')
    await expect(page.getByRole('heading', { level: 1 })).toContainText(E2E_PLUGIN_CLIENT_NAME)
    await expect(page.getByTestId('consent-redirect-uri')).toHaveText(REDIRECT_URI)
    await expect(page.getByTestId('consent-account')).not.toBeEmpty()
    // Capabilities are rendered from the server-resolved viewer, so the seeded
    // owner sees the read baseline. Their presence is what makes the screen
    // consent rather than a confirmation prompt.
    await expect(page.getByTestId('consent-capabilities')).toContainText('plan.preview')
  })

  test('refusing returns access_denied with the original state and no code', async ({ page }) => {
    await signIn(page)
    const run = attempt()
    await page.goto(run.url)

    await page.getByRole('button', { name: 'ปฏิเสธ' }).click()
    await page.waitForURL(/plugin\/e2e-callback/)

    const landed = new URL(page.url())
    expect(landed.searchParams.get('error')).toBe('access_denied')
    expect(landed.searchParams.get('state')).toBe(run.state)
    expect(landed.searchParams.get('code')).toBeNull()
  })

  test('approving by clicking yields a code the token endpoint accepts exactly once', async ({ page, request }) => {
    await signIn(page)
    const run = attempt()
    await page.goto(run.url)

    await page.getByRole('button', { name: 'อนุมัติการเชื่อมต่อ' }).click()
    await page.waitForURL(/plugin\/e2e-callback/)

    const landed = new URL(page.url())
    expect(landed.searchParams.get('state')).toBe(run.state)
    const code = landed.searchParams.get('code')
    expect(code).toBeTruthy()

    const body = {
      grant_type: 'authorization_code',
      code,
      client_id: E2E_PLUGIN_CLIENT_ID,
      redirect_uri: REDIRECT_URI,
      code_verifier: run.verifier,
      installation_id: run.installationId,
    }
    const first = await request.post('/api/plugin/auth/token', { data: body })
    expect(first.status()).toBe(200)
    const token = await first.json()
    expect(token.token_type).toBe('Bearer')
    expect(token.refresh_token).toBeUndefined()

    const capabilities = await request.get('/api/plugin/auth/capabilities', {
      headers: { authorization: `Bearer ${token.access_token}` },
    })
    expect(capabilities.status()).toBe(200)

    // Single use, seen from the outside: the same code presented again is
    // refused rather than issuing a second session. It is checked *after* the
    // capability read on purpose — ADR-052 D2 treats a replayed code as
    // evidence the code leaked after use and revokes the session it already
    // minted, so a replay before that read would (correctly) 401 it.
    const second = await request.post('/api/plugin/auth/token', { data: body })
    expect(second.status()).toBe(400)

    const afterReplay = await request.get('/api/plugin/auth/capabilities', {
      headers: { authorization: `Bearer ${token.access_token}` },
    })
    expect(afterReplay.status()).toBe(401)
  })

  test('a browser with no session is sent to sign in and no consent screen is rendered', async ({ page }) => {
    await page.context().clearCookies()
    const run = attempt()
    const response = await page.goto(run.url)

    await expect(page).toHaveURL(/\/login/)
    const html = await response.text()
    expect(html).not.toContain(E2E_PLUGIN_CLIENT_NAME)
    expect(html).not.toContain('plan.preview')
  })
})
