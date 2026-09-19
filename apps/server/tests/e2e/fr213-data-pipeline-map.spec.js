const { test, expect } = require('@playwright/test')
const { randomUUID } = require('node:crypto')
const { loginAsOwner, E2E_PASSWORD } = require('./e2e-auth')

// @req FR-213 — a Business owner opens Knowledge (GKS) → Data Pipeline Map,
//   follows one chain end to end and reads the same rows in the list view; a
//   browser without a session or without the slot never receives the projection.
// @req FR-214 — the slot is reachable from the domain bar's route.
// @spec ADR-085 D4, D6
// @tested tests/e2e/fr213-data-pipeline-map.spec.js

// A marker that appears only in the rendered projection.
const PROJECTION_MARKER = 'pipeline-node-in.line-webhook'

async function enterBusiness(page) {
  await loginAsOwner(page)
  await page.getByRole('button', { name: /Open Business Business 01/ }).click()
  await expect(page).toHaveURL(/overview/)
}

test.describe('FR-213 Data Pipeline Map', () => {
  test('an owner follows a chain and reads it again in the list view', async ({ page }) => {
    await enterBusiness(page)
    await page.goto('/knowledge')
    await expect(page.getByTestId('knowledge-dashboard')).toBeVisible()
    await page.getByRole('link', { name: 'เปิดแผนที่' }).click()
    await expect(page).toHaveURL(/\/knowledge\/data-pipeline$/)

    const map = page.getByTestId('data-pipeline-map')
    await expect(map.getByRole('heading', { level: 1, name: 'แผนที่ data pipeline' })).toBeVisible()
    await expect(map.getByTestId(PROJECTION_MARKER)).toBeVisible()

    await map.getByTestId('pipeline-chain-CH-01').click()
    await expect(map.getByTestId('pipeline-chain-CH-01')).toHaveAttribute('aria-pressed', 'true')
    const detail = map.getByTestId('pipeline-detail-CH-01')
    await expect(detail).toContainText('LINE turn')
    await expect(detail).toContainText('line-oa-studio')

    // A node on the chain stays lit; keyboard selection opens its detail.
    const webhook = map.getByTestId('pipeline-node-in.line-webhook')
    await expect(webhook).toHaveAttribute('data-dim', 'false')
    await webhook.focus()
    await page.keyboard.press('Enter')
    await expect(webhook).toBeFocused()
    await expect(map.getByTestId('pipeline-detail-in.line-webhook')).toContainText('/api/line-oa/accounts/[id]/webhook')

    // Space activates the same focused node after the previous selection is cleared,
    // and its default page-scroll action is suppressed.
    await map.getByRole('button', { name: 'ล้างตัวกรอง' }).click()
    await expect(webhook).toHaveAttribute('data-selected', 'false')
    await webhook.focus()
    await expect(webhook).toBeFocused()
    const scrollBeforeSpace = await page.evaluate(() => document.scrollingElement.scrollTop)
    await page.keyboard.press('Space')
    await expect(webhook).toBeFocused()
    await expect(webhook).toHaveAttribute('data-selected', 'true')
    await expect(map.getByTestId('pipeline-detail-in.line-webhook')).toContainText('/api/line-oa/accounts/[id]/webhook')
    await expect.poll(() => page.evaluate(() => document.scrollingElement.scrollTop)).toBe(scrollBeforeSpace)

    await map.getByRole('tab', { name: 'รายการ' }).click()
    const list = map.getByTestId('data-pipeline-map-list')
    await expect(list.getByRole('table', { name: 'Chains' })).toContainText('CH-01')
    await expect(list.getByRole('table', { name: 'Nodes' })).toContainText('in.line-webhook')

    // The chain also opens straight from the URL.
    await page.goto('/knowledge/data-pipeline?chain=CH-11')
    await expect(page.getByTestId('pipeline-detail-CH-11')).toBeVisible()
  })

  test('does not send the projection to a browser with no session', async ({ page }) => {
    await page.context().clearCookies()
    const response = await page.goto('/knowledge/data-pipeline')
    const html = await response.text()
    expect(html).not.toContain(PROJECTION_MARKER)
    await expect(page).toHaveURL(/\/login/)
  })

  test('does not render the projection for a signed-in person without the slot', async ({ page }) => {
    const signup = await page.request.post('/api/auth/signup', { data: {
      email: `fr213-${randomUUID()}@example.test`, displayName: 'FR-213 outsider', password: E2E_PASSWORD,
    } })
    expect(signup.status()).toBe(201)
    await page.goto('/knowledge/data-pipeline')
    // Not a status assertion: the (pm) shell streams before notFound() (see the FR-124 spec).
    const body = await page.locator('body').innerText()
    expect(body).not.toContain('แผนที่ data pipeline')
    await expect(page.getByTestId('data-pipeline-map')).toHaveCount(0)
  })
})
