// @req FR-124 — an authorized BusinessShell viewer can traverse the readiness
// summary, inspect a domain lane, and see a feature use case and its evidence;
// an unauthenticated one never receives the snapshot at all.
// @spec docs/domains/project-manager/features/FR-124-product-readiness-dashboard.md
// @tested tests/e2e/fr124-product-readiness.spec.js
const { test, expect } = require('@playwright/test')
const { loginAsOwner } = require('./e2e-auth')

// @req FR-044 — protected routes require the explicit Business Routing step.
async function enterBusiness(page, name = 'Business 01') {
  await loginAsOwner(page)
  await page.getByRole('button', { name: new RegExp(`Open Business ${name}`) }).click()
  await expect(page).toHaveURL(/overview/)
}

// A marker that appears in the rendered snapshot and nowhere else on the site.
// Asserting its absence is how "the payload did not reach this browser" is
// checked, rather than trusting that a guard was called.
const SNAPSHOT_MARKER = 'ตัวอย่าง use case'

test.describe('FR-124 Product Readiness Dashboard', () => {
  test('shows six KPIs and drills into one domain with feature use cases', async ({ page }) => {
    await enterBusiness(page)
    await page.goto('/platform/product-readiness')

    // `level: 1` and `exact` on purpose: feature cards carry their own headings,
    // and one of them is FR-124's own PRD statement, which begins with these
    // very words.
    await expect(page.getByRole('heading', { level: 1, name: 'Product readiness', exact: true })).toBeVisible()
    for (const label of ['Domains', 'Features', 'Ready', 'Progress', 'Verified FRs', 'Open gaps']) {
      await expect(page.locator('main').getByText(label, { exact: true })).toBeVisible()
    }
    await expect(page.getByText('วิธีคำนวณและขอบเขตของตัวเลข')).toBeVisible()
    await expect(page.getByText(SNAPSHOT_MARKER).first()).toBeVisible()

    // The drilldown is exercised through the page's own card rather than a
    // hard-coded domain key: which lanes exist is generated, and pinning one
    // here would make an ordinary charter change look like a UI regression.
    const card = page.locator('a[href^="/platform/product-readiness/"]').first()
    const href = await card.getAttribute('href')
    await card.click()
    await expect(page).toHaveURL(new RegExp(`${href.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`))
    await expect(page.getByRole('heading', { level: 1, name: /readiness$/ })).toBeVisible()
    await expect(page.getByText(SNAPSHOT_MARKER).first()).toBeVisible()
    await expect(page.getByLabel('Filter by readiness')).toBeVisible()
    await expect(page.getByRole('link', { name: 'All domains' })).toBeVisible()
  })

  test('refuses an unknown domain key without rendering or enumerating the real ones', async ({ page }) => {
    await enterBusiness(page)
    await page.goto('/platform/product-readiness/not-a-domain')

    // Deliberately not a 404 status assertion. `(pm)/layout.jsx` is a client
    // component, so the shell has already begun streaming by the time the
    // nested page calls `notFound()`, and the status line is committed as 200
    // before anything can change it. What matters — and what is asserted — is
    // that the page component never rendered, so no snapshot and no domain key
    // reached the browser.
    const body = await page.locator('body').innerText()
    expect(body).not.toContain(SNAPSHOT_MARKER)
    expect(body).not.toContain('project-manager')
    expect(body).not.toContain('Verified FRs')
  })

  test('does not send the snapshot to a browser with no session', async ({ page }) => {
    await page.context().clearCookies()
    const response = await page.goto('/platform/product-readiness')

    // The server resolves the viewer before rendering, so the readiness payload
    // must be absent from the document itself — not merely hidden afterwards by
    // the client shell guard.
    const html = await response.text()
    expect(html).not.toContain(SNAPSHOT_MARKER)
    expect(html).not.toContain('progressMethodology')
    await expect(page).toHaveURL(/\/login/)
  })
})
