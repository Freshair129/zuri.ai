const { test, expect } = require('@playwright/test')

// @req FR-041, FR-042 - Business-first Overview plus HR / People peer domain.
// @spec ADR-013, PLAN-FR-041-BUSINESS-FIRST-STRATEGY-AND-HR
// @tested tests/e2e/fr041-business-first.spec.js
// api() retries a lost connection, never an answer — see ./reconnecting-request.
const { api } = require('./reconnecting-request')

async function chooseBusiness(page, name = 'Business 01') {
  await page.goto('/login')
  await page.getByRole('button', { name: /demo login/i }).click()
  await page.getByRole('button', { name: new RegExp(`Open Business ${name}`) }).click()
  await expect(page).toHaveURL(/overview/)
}

test.describe('FR-041/042 Business-first shell', () => {
  test('Business Overview shows strategy and Business-owned Projects, not Group cards', async ({ page }) => {
    await chooseBusiness(page)
    await expect(page.getByRole('heading', { name: 'Business 01 — Command Center' })).toBeVisible()
    await expect(page.getByTestId('business-strategy')).toBeVisible()
    await expect(page.getByTestId('strategy-horizon-short')).toBeVisible()
    await expect(page.getByTestId('strategy-horizon-medium')).toBeVisible()
    await expect(page.getByTestId('strategy-horizon-long')).toBeVisible()
    await expect(page.getByText(/Business 01.*Transformation Program/)).toBeVisible()
    await expect(page.getByRole('heading', { name: /ภาพรวมทั้งเครือ|Group Overview/i })).toHaveCount(0)
    await expect(page.getByText('BUS-004')).toHaveCount(0)
  })

  test('HR / People is a peer domain with a separate People Directory', async ({ page }) => {
    await chooseBusiness(page)
    await page.getByRole('link', { name: 'HR / People' }).first().click()
    await expect(page).toHaveURL(/\/people$/)
    await expect(page.getByRole('heading', { name: 'Business 01 People' })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'People Directory' })).toBeVisible()
    await expect(page.getByText('Local Owner')).toBeVisible()
    await expect(page.getByText(/Project Team is a separate Project-local view/)).toBeVisible()
    const developmentLink = page.getByRole('link', { name: 'Development' }).first()
    await expect(developmentLink).toBeVisible()
    // FR-060 — Development roots at its own resource list; `/overview` became
    // the Business Home Dashboard.
    await expect(developmentLink).toHaveAttribute('href', '/projects')
  })

  test('strategy and people API contracts stay Business-scoped', async ({ request }) => {
    await api(request).post('/api/session/demo', { maxRedirects: 0 })
    const scope = await (await api(request).get('/api/scope')).json()
    const business = scope.businesses.find((item) => item.code === 'BUS-001')
    const strategy = await api(request).get(`/api/business/strategy?businessId=${business.id}`)
    expect(strategy.status()).toBe(200)
    const strategyBody = await strategy.json()
    expect(strategyBody.roadmaps[0].horizons).toHaveLength(3)
    const people = await api(request).get(`/api/people?businessId=${business.id}`)
    expect(people.status()).toBe(200)
    expect((await people.json()).business.code).toBe('BUS-001')
  })
})
