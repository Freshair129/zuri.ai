// @req FR-060 — Business Home Dashboard rendered in a real browser.
// @spec SDD-033 — reserved domains must never render a number.
// @tested tests/e2e/fr060-business-home.spec.js
const { test, expect } = require('@playwright/test')
const { loginAsOwner } = require('./e2e-auth')

// @req FR-060 / FR-133 — the domain count and reserved count the page renders
// are derived from the same registry the page reads (src/config/domains.js),
// not hardcoded here, so this spec never drifts when DOMAINS gains or loses
// an entry. Filtering matches business-home-read-model.js: business-home is
// excluded (it is the shell slot the coverage line is measured against, not
// one of the domains it covers) and `soon` marks a reserved slot.
async function loadDomainCounts() {
  const { DOMAINS } = await import('../../src/config/domains.js')
  const operational = DOMAINS.filter((domain) => domain.key !== 'business-home')
  return {
    total: operational.length,
    reserved: operational.filter((domain) => domain.soon).length,
  }
}

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

    // The composite must say what it covers rather than implying it covers all.
    // The coverage phrase appears in the caption, the score line and the briefing —
    // all three are deliberate, so assert presence rather than uniqueness.
    const { total } = await loadDomainCounts()
    await expect(page.getByText(new RegExp(`of ${total} domains`)).first()).toBeVisible()

    await page.screenshot({ path: 'output/playwright/fr060-business-home.png', fullPage: true })
  })

  test('renders reserved domains as reserved, never as a zero', async ({ page }) => {
    await openBusinessHome(page)

    for (const label of ['Commerce', 'CRM', 'Marketing', 'Operations']) {
      await expect(page.getByText(label, { exact: true }).first()).toBeVisible()
    }
    // Every reserved slot says so in words. If any of them ever renders a score,
    // this count changes and the test fails — which is the point.
    //
    // @req FR-091 — CRM shipped pages and left the reserved set (2026-08-20); it
    // is still listed above because the row must remain on Business Home, what
    // changed is which sentence it carries. The expected count is derived from
    // `soon` in src/config/domains.js so a future reserved slot (or one going
    // live) does not need this test edited by hand.
    const { reserved } = await loadDomainCounts()
    await expect(page.getByText('Reserved — no module yet')).toHaveCount(reserved)

    // And CRM's new sentence is a stated absence, not a zero — the distinction
    // this whole test exists to hold. Business Home does not yet read the crm
    // domain for a signal, and says so rather than implying a measured nothing.
    const crmRow = page.locator('li, div').filter({ hasText: /^CRM/ }).first()
    await expect(crmRow).not.toContainText('Reserved — no module yet')
  })

  test('Development is a separate slot that roots at its own resource list', async ({ page }) => {
    await openBusinessHome(page)

    const development = page.getByRole('navigation', { name: 'Domains' }).getByRole('link', { name: 'Development' })
    await expect(development).toHaveAttribute('href', '/projects')
    await development.click()
    await expect(page).toHaveURL(/\/projects$/)
    // Development's sidebar must not offer the cross-domain page as its own.
    await expect(page.locator('aside').getByRole('link', { name: 'Overview' })).toHaveCount(0)
  })
})
