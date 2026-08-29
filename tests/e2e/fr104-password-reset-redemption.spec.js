const { test, expect } = require('@playwright/test')
const { loginAsOwner } = require('./e2e-auth')
// api() retries a lost connection, never an answer — see ./reconnecting-request.
const { api } = require('./reconnecting-request')

// @req FR-104 — the consume leg had a route and no screen: an owner could mint a
// token and hand it over, and the holder had nowhere to type it. This walks the
// handover the way a person does.
// @req FR-046 — the sign-in surface's affordances: reveal, remember-me, and the
// one link out of Login.
// @spec ADR-015, ADR-017, SDD-022, SDD-054, SEC-008, SEC-014
// @tested tests/e2e/fr104-password-reset-redemption.spec.js
//
// Browser coverage rather than source assertions, because the unit tests here
// read component source (this repo has no React rendering harness) and source
// text cannot show that a toggle actually flips an input's type, that a link
// actually arrives somewhere, or that a minted token is actually spendable.

const NEW_PASSWORD = 'e2e-reset-Passw0rd'

// Next.js mounts its own <div role="alert" id="__next-route-announcer__"> at
// body level, so a bare getByRole('alert') matches two elements and its
// presence is a hydration race — one of the three uses here passed only
// because the announcer had not mounted yet. Scoping to the form is also the
// truer assertion: what is under test is that the form reported the failure.
const formAlert = (page) => page.locator('form').getByRole('alert')

test.describe('FR-046 sign-in affordances', () => {
  test('reveals and re-hides the password without touching its value', async ({ page }) => {
    await page.goto('/login')
    const password = page.getByLabel('Password', { exact: true })
    await password.fill('correct horse battery staple')

    await expect(password).toHaveAttribute('type', 'password')
    const toggle = page.getByRole('button', { name: 'แสดงรหัสผ่าน' })
    await toggle.click()

    await expect(password).toHaveAttribute('type', 'text')
    // The name states the action and flips with the state; a static "show"
    // announced while the password is visible would be the opposite of true.
    await expect(page.getByRole('button', { name: 'ซ่อนรหัสผ่าน' })).toHaveAttribute('aria-pressed', 'true')
    // The point of the toggle is to read what you typed, so it must survive it.
    await expect(password).toHaveValue('correct horse battery staple')

    await page.getByRole('button', { name: 'ซ่อนรหัสผ่าน' }).click()
    await expect(password).toHaveAttribute('type', 'password')
  })

  // AC-046-15. The cookie's lifetime is asserted in the unit route test; what
  // only a browser can show is that the checkbox reaches the response at all.
  test('leaves "remember me" unticked, so the default is what an unticked box means', async ({ page }) => {
    await page.goto('/login')
    await expect(page.getByLabel('จดจำฉันไว้')).not.toBeChecked()
  })

  test('sends no cookie expiry unless "remember me" is ticked', async ({ page, context }) => {
    await loginAsOwner(page)
    await expect(page).toHaveURL(/\/businesses$/)

    const sessionCookie = (await context.cookies()).find((cookie) => cookie.name === 'zuri_session')
    expect(sessionCookie).toBeTruthy()
    // Playwright reports a browser-session cookie as expires === -1.
    expect(sessionCookie.expires).toBe(-1)
  })

  test('keeps the seven days available behind the tick', async ({ page, context }) => {
    // Ticked inside the helper: it navigates to /login itself, so a box checked
    // out here is wiped by that navigation and the test passes on the default.
    await loginAsOwner(page, { remember: true })
    await expect(page).toHaveURL(/\/businesses$/)

    const sessionCookie = (await context.cookies()).find((cookie) => cookie.name === 'zuri_session')
    expect(sessionCookie.expires).toBeGreaterThan(0)
  })

  // Two ways out since FR-120 added /signup. Asserted as a set rather than a
  // single link, because the failure worth catching is a *third* one appearing
  // — an entry surface that grew an unaccounted exit — and a test that clicks
  // one known link can never see that.
  test('offers exactly the two ways out of Login, both outside the shell', async ({ page }) => {
    await page.goto('/login')
    const names = await page.locator('main').getByRole('link').allInnerTexts()
    expect(names.map((name) => name.trim()).sort()).toEqual(['ลืมรหัสผ่าน?', 'สมัครสมาชิก'])

    await page.getByRole('link', { name: 'ลืมรหัสผ่าน?' }).click()
    await expect(page).toHaveURL(/\/reset-password$/)
    await expect(page.getByRole('heading', { name: 'ตั้งรหัสผ่านใหม่' })).toBeVisible()
    // FR-044/ADR-015: the entry journey never mounts BusinessShell chrome.
    await expect(page.getByRole('navigation', { name: 'Domains' })).toHaveCount(0)
  })
})

test.describe('FR-104 redemption screen', () => {
  test('refuses a wrong token with one sentence that names nothing', async ({ page }) => {
    await page.goto('/reset-password')
    await page.getByLabel('รหัสรีเซ็ต').fill('not-a-real-token')
    await page.getByLabel('รหัสผ่านใหม่', { exact: true }).fill(NEW_PASSWORD)
    await page.getByLabel('ยืนยันรหัสผ่านใหม่').fill(NEW_PASSWORD)
    await page.getByRole('button', { name: 'ตั้งรหัสผ่านใหม่' }).click()

    const alert = formAlert(page)
    await expect(alert).toBeVisible()
    // The route answers unknown, used and expired with one code by design. The
    // screen must not sort them back out into three sentences.
    await expect(alert).toContainText('ไม่ถูกต้อง หมดอายุ หรือถูกใช้ไปแล้ว')
  })

  test('catches a mismatched confirmation before spending the token', async ({ page }) => {
    let posted = 0
    await page.route('**/api/auth/reset-password', (route) => {
      posted += 1
      return route.continue()
    })

    await page.goto('/reset-password')
    await page.getByLabel('รหัสรีเซ็ต').fill('some-token')
    await page.getByLabel('รหัสผ่านใหม่', { exact: true }).fill(NEW_PASSWORD)
    await page.getByLabel('ยืนยันรหัสผ่านใหม่').fill(`${NEW_PASSWORD}-typo`)
    await page.getByRole('button', { name: 'ตั้งรหัสผ่านใหม่' }).click()

    await expect(formAlert(page)).toContainText('ไม่ตรงกัน')
    // The token is single-use: a round trip to report a typo would burn it and
    // cost the holder a second request to their owner.
    expect(posted).toBe(0)
  })

  test('accepts a token carried in the link', async ({ page }) => {
    await page.goto('/reset-password?token=handed-over-in-a-message')
    await expect(page.getByLabel('รหัสรีเซ็ต')).toHaveValue('handed-over-in-a-message')
  })

  test('spends a real minted token and reports the session revocation', async ({ page, browser }) => {
    // Mint as the owner, in a context that is thrown away, so the redemption
    // below runs as the unauthenticated stranger it is meant to serve.
    const ownerContext = await browser.newContext()
    const ownerPage = await ownerContext.newPage()
    await loginAsOwner(ownerPage)
    await expect(ownerPage).toHaveURL(/\/businesses$/)

    // /api/resolve has no PERSON type and /api/people is Business-scoped, so the
    // id is reached the way the console reaches it: scope inventory → Business →
    // its directory. Each step asserts, rather than being swallowed: an earlier
    // version wrapped this in `.catch(() => null)` and the missing id surfaced as
    // TARGET_PERSON_REQUIRED, which reads as a broken mint route rather than a
    // broken lookup in the test.
    const scope = await (await api(ownerPage.request).get('/api/scope')).json()
    const business = scope.businesses?.find((entry) => entry.code === 'BUS-001')
    expect(business, `BUS-001 not visible to the owner: ${JSON.stringify(scope.businesses)}`).toBeTruthy()

    const directory = await (await api(ownerPage.request).get(`/api/people?businessId=${business.id}`)).json()
    const target = directory.people?.find((entry) => entry.person.code === 'PER-DELIVERY')
    expect(target, 'PER-DELIVERY is not in the BUS-001 directory').toBeTruthy()

    const minted = await (await api(ownerPage.request).post('/api/platform/users/password-resets', {
      data: { personId: target.person.id },
    })).json()
    await ownerContext.close()

    // The raw token appears exactly once, in this authenticated response — that
    // is the whole handover, and this asserts the screen can consume it. The
    // field is `resetToken`, not `token`: naming it wrongly here would have made
    // a working route look broken.
    expect(minted.resetToken, `mint failed: ${JSON.stringify(minted)}`).toBeTruthy()

    await page.goto(`/reset-password?token=${encodeURIComponent(minted.resetToken)}`)
    await page.getByLabel('รหัสผ่านใหม่', { exact: true }).fill(NEW_PASSWORD)
    await page.getByLabel('ยืนยันรหัสผ่านใหม่').fill(NEW_PASSWORD)
    await page.getByRole('button', { name: 'ตั้งรหัสผ่านใหม่' }).click()

    await expect(page.getByRole('heading', { name: 'ตั้งรหัสผ่านใหม่แล้ว' })).toBeVisible()
    // FR-104 revokes every active session on consumption; the screen has to say
    // so, because a person whose other devices just signed out deserves to know
    // it was this action that did it.
    await expect(page.getByRole('status')).toContainText('ออกจากระบบแล้ว')

    // And the token is burnt: the same link cannot be replayed.
    await page.goto(`/reset-password?token=${encodeURIComponent(minted.resetToken)}`)
    await page.getByLabel('รหัสผ่านใหม่', { exact: true }).fill(NEW_PASSWORD)
    await page.getByLabel('ยืนยันรหัสผ่านใหม่').fill(NEW_PASSWORD)
    await page.getByRole('button', { name: 'ตั้งรหัสผ่านใหม่' }).click()
    await expect(formAlert(page)).toBeVisible()
  })
})
