// @req FR-060 — Business Home Dashboard rendered in a real browser.
// @spec SDD-033 — reserved domains must never render a number.
// @tested tests/e2e/fr060-business-home.spec.js
const { test, expect } = require('@playwright/test')
const { loginAsOwner } = require('./e2e-auth')

async function openBusinessHome(page) {
  await loginAsOwner(page)
  await page.getByRole('button', { name: /Open Business Business 01/i }).click()
  await expect(page).toHaveURL(/\/overview$/)
}

test.describe('FR-060 Business Home', () => {
  test('is the landing slot and renders briefing, health and attention queue', async ({ page }) => {
    await openBusinessHome(page)

    // The slot itself: first in the domain bar, and this page belongs to it.
    const bar = page.getByRole('navigation', { name: 'Domains' })
    await expect(bar.getByRole('link', { name: 'Business Home' })).toBeVisible()
    await expect(page.getByRole('heading', { name: /Business 01 — Command Center/ })).toBeVisible()

    await expect(page.getByRole('heading', { name: 'Zuri briefing' })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Business health' })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Attention queue' })).toBeVisible()

    // Match coverage to the actual rendered domain rows and numeric signals.
    // Registry-to-read-model parity is checked by Vitest, which can load the
    // ESM icon registry; Playwright must not import that UI module in CommonJS.
    const healthCard = page.locator('.card').filter({ has: page.getByRole('heading', { name: 'Business health', exact: true }) })
    const rows = healthCard.locator('.grid > div')
    const scores = await rows.locator(':scope > div > span:last-child').allTextContents()
    const total = await rows.count()
    const measured = scores.filter((score) => /^\d+$/.test(score.trim())).length
    expect(total).toBeGreaterThan(0)
    expect(measured).toBeGreaterThan(0)
    expect(measured).toBeLessThanOrEqual(total)
    await expect(page.getByText(new RegExp(`across ${measured} of ${total} domains`)).first()).toBeVisible()

    await page.screenshot({ path: 'output/playwright/fr060-business-home.png', fullPage: true })
  })

  test('renders reserved domains as reserved, never as a zero', async ({ page }) => {
    await openBusinessHome(page)

    // 'Order Management' is the Commerce lane's label since ADR-069, and
    // 'Warehouse' is the reserved SCM sibling it added. 'Customer' is the
    // customer domain's label since ADR-071 grouped it with Market
    // Intelligence under the new CRM bar slot.
    for (const label of ['Order Management', 'Customer', 'Marketing', 'Operations', 'Warehouse']) {
      await expect(page.getByText(label, { exact: true }).first()).toBeVisible()
    }
    // Each currently reserved slot says so in words. The names and count are
    // pinned together so a slot being added or shipped requires this assertion
    // to be reviewed alongside the rendered Business Home contract.
    const reservedDomainLabels = ['Operations', 'Warehouse']
    for (const label of reservedDomainLabels) {
      const row = page.locator('li, div').filter({ hasText: new RegExp(`^${label}`) }).first()
      await expect(row).toContainText('Reserved — no module yet')
    }
    await expect(page.getByText('Reserved — no module yet')).toHaveCount(reservedDomainLabels.length)

    // @req FR-091 — Customer is an available module, not a reserved slot.
    // And Customer's new sentence is a stated absence, not a zero — the
    // distinction this whole test exists to hold. Business Home does not yet
    // read the customer domain for a signal, and says so rather than implying
    // a measured nothing.
    const crmRow = page.locator('li, div').filter({ hasText: /^Customer/ }).first()
    await expect(crmRow).not.toContainText('Reserved — no module yet')
  })

  test('Projects & Work is a separate slot with six logical modules', async ({ page }) => {
    await openBusinessHome(page)

    const projectsWork = page.getByRole('navigation', { name: 'Domains' }).getByRole('link', { name: 'Projects & Work' })
    await expect(projectsWork).toHaveAttribute('href', '/projects')
    await projectsWork.click()
    await expect(page).toHaveURL(/\/projects$/)
    const modules = page.getByRole('navigation', { name: 'Projects & Work modules' })
    await expect(modules.getByRole('link', { name: 'Project Management', exact: true })).toHaveAttribute('href', '/projects')
    await expect(modules.getByRole('link', { name: 'Work Management', exact: true })).toHaveAttribute('href', '/work')
    await expect(modules.getByRole('link', { name: 'Resource Coordination', exact: true })).toHaveAttribute('href', '/files')
    await expect(modules.getByRole('button', { name: /Delivery Design/ })).toBeVisible()
    await expect(modules.getByRole('button', { name: /Delivery Governance/ })).toBeVisible()
    await expect(modules.getByRole('button', { name: /Agent Delivery/ })).toBeVisible()
    // Projects & Work must not offer the Business Home page as one of its
    // module-local destinations.
    await expect(page.locator('aside').getByRole('link', { name: 'Overview' })).toHaveCount(0)
  })
})
