const { test, expect } = require('@playwright/test')
const { randomUUID } = require('node:crypto')
const { E2E_PASSWORD, loginAsOwner } = require('./e2e-auth')

// @req FR-241 — the member roadmap is time-boxed; after its accepted closure,
//   /roadmap is unavailable to everyone while /control/roadmap remains guarded.
// @spec ADR-092 D1–D3; ADR-048 D2
// @tested tests/e2e/fr241-roadmap-member-view.spec.js

test('closed FR-241 roadmap returns 404 for anonymous, member, and operator viewers', async ({ page, browser, request }) => {
  const anonymous = await request.get('/roadmap', { maxRedirects: 0 })
  expect(anonymous.status()).toBe(404)

  const memberContext = await browser.newContext()
  try {
    const memberPage = await memberContext.newPage()
    const signup = await memberPage.request.post('/api/auth/signup', {
      headers: { 'x-forwarded-for': '198.51.100.51' },
      data: {
        email: `fr241-${randomUUID()}@example.test`, displayName: 'FR-241 member', password: E2E_PASSWORD,
      },
    })
    expect(signup.status()).toBe(201)
    const member = await memberPage.goto('/roadmap')
    expect(member?.status()).toBe(404)

    const control = await memberPage.goto('/control/roadmap')
    expect(control?.status()).toBe(403)
    await expect(memberPage).toHaveURL(/\/access-denied$/)
    await expect(memberPage.getByRole('heading', { name: 'ไม่มีสิทธิ์เข้าถึงหน้านี้' })).toBeVisible()
  } finally {
    await memberContext.close()
  }

  await loginAsOwner(page)
  const operator = await page.goto('/roadmap')
  expect(operator?.status()).toBe(404)
})

test('closed FR-241 roadmap remains unavailable at 390px and 430px', async ({ page }) => {
  for (const viewport of [{ width: 390, height: 844 }, { width: 430, height: 932 }]) {
    await page.setViewportSize(viewport)
    const response = await page.goto('/roadmap')
    expect(response?.status()).toBe(404)
    await expect(page.getByTestId('roadmap-evidence')).toHaveCount(0)
  }
})
