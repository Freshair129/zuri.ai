const { test, expect } = require('@playwright/test')

// @req FR-120 — the public door, walked the way a stranger walks it: no account,
// no invite, no operator. What source assertions cannot show is exactly what
// matters here — that the account created is real, that its owner can sign in
// with it afterwards, and that it grants them nothing.
// @req FR-044 — signup is an entry surface and never mounts the BusinessShell.
// @spec BR-002, SEC-008, ADR-015, SDD-022
// @tested tests/e2e/fr120-signup.spec.js

const PASSWORD = 'e2e-signup-Passw0rd'

// Unique per test AND per retry. The e2e database is reseeded once per run, not
// per test, so a fixed address would meet its own EMAIL_TAKEN on Playwright's
// retry and fail for a reason that has nothing to do with the code — the flake
// would look like a broken refusal rather than a test reusing an address.
const addressFor = (testInfo, label = 'new') =>
  `${label}-${testInfo.workerIndex}-${testInfo.retry}-${testInfo.title.replace(/[^a-z]/gi, '').slice(0, 12).toLowerCase()}@example.com`

// Next.js mounts its own <div role="alert" id="__next-route-announcer__"> at
// body level, so a bare getByRole('alert') matches two elements and its presence
// is a hydration race. Scoping to the form is also the truer assertion: what is
// under test is that the form reported the failure.
const formAlert = (page) => page.locator('form').getByRole('alert')

async function fillSignup(page, { email, name = 'ผู้ใช้ใหม่', password = PASSWORD, confirmation = password }) {
  await page.getByLabel('ชื่อที่ใช้แสดง').fill(name)
  await page.getByLabel('อีเมล').fill(email)
  await page.getByLabel('รหัสผ่าน (อย่างน้อย 8 ตัวอักษร)', { exact: true }).fill(password)
  await page.getByLabel('ยืนยันรหัสผ่าน', { exact: true }).fill(confirmation)
  await page.getByRole('button', { name: 'สมัครสมาชิก', exact: true }).click()
}

test.describe('FR-120 self-serve signup', () => {
  test('is reachable from Login and stays outside the shell', async ({ page }) => {
    await page.goto('/login')
    await page.getByRole('link', { name: 'สมัครสมาชิก' }).click()

    await expect(page).toHaveURL(/\/signup$/)
    await expect(page.getByRole('heading', { name: 'สมัครสมาชิก' })).toBeVisible()
    // FR-044/ADR-015: the entry journey never mounts BusinessShell chrome.
    await expect(page.getByRole('navigation', { name: 'Domains' })).toHaveCount(0)
  })

  test('says on the page that an account alone does not join a team', async ({ page }) => {
    // The claim a new person is most likely to get wrong, and the one FR-120
    // makes most loudly: signup creates a profile and confers no authority.
    await page.goto('/signup')
    await expect(page.getByText('รอคำเชิญจากเจ้าของทีม')).toBeVisible()
    await expect(page.getByText('ระบบไม่ส่งอีเมลยืนยัน')).toBeVisible()
  })

  test('catches a mismatched confirmation without creating anything', async ({ page }, testInfo) => {
    let posted = 0
    await page.route('**/api/auth/signup', (route) => {
      posted += 1
      return route.continue()
    })

    await page.goto('/signup')
    await fillSignup(page, { email: addressFor(testInfo), confirmation: `${PASSWORD}-typo` })

    await expect(formAlert(page)).toContainText('ไม่ตรงกัน')
    // No account exists to clean up, and the person is told before a request is
    // ever made rather than after one has half-succeeded.
    expect(posted).toBe(0)
    await expect(page).toHaveURL(/\/signup$/)
  })

  test('refuses a short password at the server, not only at the input', async ({ page }, testInfo) => {
    // `minLength` on the field stops a browser from ever sending this, which is
    // exactly why the assertion goes around it: a policy enforced only in the
    // markup is enforced only against people who use the form.
    const email = addressFor(testInfo, 'short')
    const response = await page.request.post('/api/auth/signup', {
      data: { displayName: 'ผู้ใช้ใหม่', email, password: 'short' },
    })

    expect(response.status()).toBe(400)
    expect((await response.json()).error).toBe('PASSWORD_INVALID')

    // And nothing was created: the address is still free.
    const retry = await page.request.post('/api/auth/signup', {
      data: { displayName: 'ผู้ใช้ใหม่', email, password: PASSWORD },
    })
    expect(retry.status()).toBe(201)
  })

  test('creates a real account, signs the person in, and grants them nothing', async ({ page, context }, testInfo) => {
    const email = addressFor(testInfo)

    await page.goto('/signup')
    await fillSignup(page, { email })

    // FR-066's PROFILE step — the requirement's own continuation point.
    await expect(page).toHaveURL(/\/onboarding\/profile$/)

    const sessionCookie = (await context.cookies()).find((cookie) => cookie.name === 'zuri_session')
    expect(sessionCookie).toBeTruthy()
    // AC-046-15's default: signup carries no "remember me" tick, so the cookie
    // dies with the browser. Playwright reports that as expires === -1.
    expect(sessionCookie.expires).toBe(-1)

    // **The requirement's central claim, asserted rather than described.**
    // A signed-in brand-new account must hold no Business, and therefore no
    // Tenant, Space or Project either — those are what a Business scopes.
    const scope = await (await page.request.get('/api/scope')).json()
    expect(scope.businesses ?? [], `a new account was granted scope: ${JSON.stringify(scope.businesses)}`).toHaveLength(0)
  })

  test('refuses the same address the second time, and says so plainly', async ({ page, browser }, testInfo) => {
    const email = addressFor(testInfo, 'twice')

    await page.goto('/signup')
    await fillSignup(page, { email })
    await expect(page).toHaveURL(/\/onboarding\/profile$/)

    // A second, clean browser: the refusal must not depend on who is signed in.
    const strangerContext = await browser.newContext()
    const stranger = await strangerContext.newPage()
    await stranger.goto('/signup')
    await fillSignup(stranger, { email })

    await expect(formAlert(stranger)).toContainText('มีบัญชีอยู่แล้ว')
    await expect(stranger).toHaveURL(/\/signup$/)
    await strangerContext.close()
  })

  test('leaves an account its owner can actually sign in with, whatever the casing', async ({ page, browser }, testInfo) => {
    // The failure this exists to catch: signup normalizes the address to
    // lowercase for storage, so an account created as `Mixed.Case@…` is only
    // reachable if the LOGIN lookup normalizes too. Without both halves this
    // creates accounts nobody can enter — and no source assertion can see it.
    const typed = `Mixed.Case-${testInfo.workerIndex}-${testInfo.retry}@Example.com`

    await page.goto('/signup')
    await fillSignup(page, { email: typed })
    await expect(page).toHaveURL(/\/onboarding\/profile$/)

    const returning = await browser.newContext()
    const returningPage = await returning.newPage()
    await returningPage.goto('/login')
    await returningPage.getByLabel('Email or account code').fill(typed)
    await returningPage.getByLabel('Password', { exact: true }).fill(PASSWORD)
    await returningPage.getByRole('button', { name: 'Sign in', exact: true }).click()

    // Signed in: a person holding no Business is routed on by the entry
    // contract rather than left on /login, and holds a session to prove it.
    // Both are asserted — leaving /login could also mean an error redirect.
    await expect(returningPage).not.toHaveURL(/\/login$/)
    expect((await returning.cookies()).some((cookie) => cookie.name === 'zuri_session')).toBe(true)
    await returning.close()
  })
})
