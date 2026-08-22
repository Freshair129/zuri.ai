const { test, expect } = require('@playwright/test')
const { loginAsOwner } = require('./e2e-auth')

// @req FR-046 — browser entry requires an explicit signed credential session and one viewer-scoped response.
// @spec ADR-017, SDD-024, SEC-008
// @tested tests/e2e/fr046-entry-contract.spec.js
// api() retries a lost connection, never an answer — see ./reconnecting-request.
const { api } = require('./reconnecting-request')

test.describe('FR-046 production-shaped entry boundary', () => {
  test.beforeEach(async ({ context }) => {
    await context.clearCookies()
  })

  test('fails closed without a session and enters through the owner session', async ({ page }) => {
    const unauthenticated = await api(page.request).get('/api/entry')
    expect(unauthenticated.status()).toBe(401)
    await expect(unauthenticated.json()).resolves.toEqual({ error: 'AUTH_REQUIRED' })

    await page.goto('/businesses')
    await expect(page).toHaveURL(/\/login$/)

    const entryRequests = []
    page.on('request', (request) => entryRequests.push(new URL(request.url()).pathname))
    await loginAsOwner(page)
    await expect(page).toHaveURL(/\/businesses$/)
    await expect(page.getByRole('heading', { name: 'Choose a Business' })).toBeVisible()

    expect(entryRequests).toContain('/api/entry')
    expect(entryRequests).not.toContain('/api/viewer')
    expect(entryRequests).not.toContain('/api/scope')

    const authenticated = await api(page.request).get('/api/entry')
    expect(authenticated.status()).toBe(200)
    const body = await authenticated.json()
    expect(body.viewer).not.toHaveProperty('visibleBusinessIds')
    expect(body.businesses.length).toBeGreaterThan(0)
  })
})
