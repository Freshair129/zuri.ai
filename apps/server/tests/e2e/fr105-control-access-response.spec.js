const { test, expect } = require('@playwright/test')
const { randomUUID } = require('node:crypto')
const { E2E_PASSWORD } = require('./e2e-auth')

// @req FR-105 — anonymous people go to Login; authenticated non-operators receive
//   a final, generic 403 without Platform Control content or a new grant.
// @spec ADR-048 D2, SEC-020
// @tested tests/e2e/fr105-control-access-response.spec.js

test('an anonymous control-route request opens Login', async ({ page }) => {
  const response = await page.goto('/control/roadmap')

  expect(response.status()).toBe(200)
  await expect(page).toHaveURL(/\/login$/)
  await expect(page.getByRole('heading', { name: 'Sign in to Zuri' })).toBeVisible()
})

test('a signed-in non-operator gets a private 403 and can open Login without a loop', async ({ page }) => {
  const signup = await page.request.post('/api/auth/signup', { data: {
    email: `fr105-denied-${randomUUID()}@example.test`, displayName: 'FR-105 member', password: E2E_PASSWORD,
  } })
  expect(signup.status()).toBe(201)

  const viewerResponse = await page.request.get('/api/viewer')
  expect(viewerResponse.status()).toBe(200)
  const viewer = await viewerResponse.json()
  expect(viewer).toMatchObject({ role: 'MEMBER', isPlatform: false, isOperator: false })
  expect(viewer.visibleBusinessIds).toEqual([])
  expect(viewer.ownedBusinessIds).toEqual([])

  const denied = await page.goto('/control/roadmap')
  expect(denied.status()).toBe(403)
  await expect(page).toHaveURL(/\/access-denied$/)
  expect(denied.headers()['cache-control']).toBe('private, no-store')
  expect(denied.headers()['x-robots-tag']).toBe('noindex, nofollow')
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', 'noindex, nofollow')
  await expect(page.getByRole('heading', { name: 'ไม่มีสิทธิ์เข้าถึงหน้านี้' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Phases, sprints and tasks' })).toHaveCount(0)
  await expect(page.locator('[data-testid="roadmap-evidence"]')).toHaveCount(0)

  await page.getByRole('link', { name: 'เข้าสู่ระบบด้วยบัญชีอื่น' }).click()
  await expect(page).toHaveURL(/\/login$/)
  await expect(page.getByRole('heading', { name: 'Sign in to Zuri' })).toBeVisible()
})
