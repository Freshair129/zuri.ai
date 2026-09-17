const { test, expect } = require('@playwright/test')
const { randomUUID } = require('node:crypto')
const { E2E_PASSWORD } = require('./e2e-auth')

// @req FR-241 — a signed-in person with no operator grant reads the programme plan
//   and the Domain map at /roadmap, without the Agent devices tab, while
//   /control/roadmap still refuses them.
// @spec ADR-092 D1–D3; ADR-048 D2
// @tested tests/e2e/fr241-roadmap-member-view.spec.js

test('a signed-in non-operator reads the roadmap preview and still cannot open the control board', async ({ page }, testInfo) => {
  const anonymous = await page.request.get('/roadmap', { maxRedirects: 0 })
  expect([307, 308]).toContain(anonymous.status())
  expect(anonymous.headers().location).toContain('/login')

  const signup = await page.request.post('/api/auth/signup', { data: {
    email: `fr241-${randomUUID()}@example.test`, displayName: 'FR-241 member', password: E2E_PASSWORD,
  } })
  expect(signup.status()).toBe(201)

  await page.goto('/roadmap')
  await expect(page.getByRole('heading', { name: 'Phases, sprints and tasks' })).toBeVisible()
  await expect(page.getByTestId('member-view-window')).toContainText('ไม่แสดงยอดการใช้งานแยกตามคนหรือเครื่อง')
  await expect(page.getByTestId('phase-metrics-PHASE-ZAI-01')).toContainText('sprint')
  await expect(page.getByRole('tab', { name: 'Domain map & inventory' })).toBeVisible()
  await expect(page.getByRole('tab', { name: 'Agent devices' })).toHaveCount(0)
  await expect(page.locator('[data-testid^="phase-people-"]')).toHaveCount(0)

  await page.goto('/roadmap?view=devices')
  await expect(page.getByRole('heading', { name: 'Phases, sprints and tasks' })).toBeVisible()
  await expect(page.getByRole('tab', { name: 'Agent devices' })).toHaveCount(0)

  await page.getByRole('tab', { name: 'Domain map & inventory' }).click()
  await expect(page).toHaveURL(/view=domains/)

  await testInfo.attach('roadmap-member-view', { body: await page.screenshot({ fullPage: false }), contentType: 'image/png' })

  const control = await page.goto('/control/roadmap')
  expect(control.status()).toBe(404)
})
