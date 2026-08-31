// @req FR-130 — the /platform/integrations catalog rendered a "GitHub
//   Repositories" tile hardcoded `status: 'CONNECTED'` while nothing in this
//   repository connects to GitHub. This spec asserts what the browser is shown,
//   not what the array holds: a unit test over the same catalog module would
//   move with any future literal put back into it.
// @spec docs/domains/integration/features/FR-130-github-repository-projection.md
// @tested tests/e2e/fr130-connector-catalog.spec.js
const { test, expect } = require('@playwright/test')
const { loginAsOwner } = require('./e2e-auth')

// @req FR-044 — protected routes require the explicit Business Routing step.
async function openCatalog(page, name = 'Business 01') {
  await loginAsOwner(page)
  await page.getByRole('button', { name: new RegExp(`Open Business ${name}`) }).click()
  await expect(page).toHaveURL(/overview/)
  await page.goto('/platform/integrations')
  await expect(page.getByRole('heading', { level: 1, name: 'Connectors' })).toBeVisible()
}

const githubRow = (page) => page.locator('[data-connector="github"]')

test.describe('FR-130 connectors catalog states the truth about GitHub', () => {
  test('renders the GitHub tile as not connected, with the reason and no Connect control', async ({ page }) => {
    await openCatalog(page)

    const row = githubRow(page)
    await expect(row).toBeVisible()
    await expect(row.getByText('GitHub Repositories')).toBeVisible()

    // The status cell itself. `exact` matters: "Not connected" contains the old
    // word, so a substring assertion would pass against the very defect.
    await expect(row.getByText('Not connected', { exact: true })).toBeVisible()
    await expect(row.getByText('Connected', { exact: true })).toHaveCount(0)

    // Why, in the surface rather than only in a reason code.
    await expect(row.getByText('ยังไม่มีตัวเชื่อมต่อในระบบ', { exact: false })).toBeVisible()

    // A "Connect" button that does nothing would be the same false claim moved
    // one element to the right, so the row offers no control at all.
    await expect(row.getByRole('button')).toHaveCount(0)
  })

  test('claims nothing is connected while the read model returns no connections', async ({ page }) => {
    await openCatalog(page)

    // The evidence side of the same assertion: read what the page read. If this
    // list is empty and any tile still says Connected, the tile is asserting
    // rather than deriving — which is exactly the defect.
    const response = await page.request.get('/api/platform/integrations')
    expect(response.ok()).toBe(true)
    // Asserted rather than skipped on. A `test.skip` here would disarm the
    // assertion below the moment the seed gained a connection, and go on
    // reporting green — which is the shape of defect this whole spec is about.
    // If this line ever fails, rewrite the assertion to compare against the
    // connections that exist; do not relax it.
    expect(await response.json()).toEqual([])

    await expect(page.locator('[data-connector-state="CONNECTED"]')).toHaveCount(0)
    await expect(page.locator('[data-connector]').first()).toBeVisible()

    // And the Connected filter agrees, rather than the tabs and the rows
    // disagreeing about the same word.
    await page.getByRole('button', { name: 'Connected', exact: true }).click()
    await expect(page.locator('[data-connector]')).toHaveCount(0)

    await page.getByRole('button', { name: 'Not connected', exact: true }).click()
    await expect(githubRow(page)).toBeVisible()
  })
})
