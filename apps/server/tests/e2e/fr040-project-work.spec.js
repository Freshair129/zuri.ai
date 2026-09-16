// @req FR-040, FR-068 — Project Work views expose Structure Plan, Dependency
// Map and the Human-visible Execution Roadmap.
// @spec SDD-019, ADR-012, ADR-028
// Regression check for the doc-graph drift-self-invalidation fix (see
// .brain/rca/2026-09-07-monorepo-graph-stale-on-fresh-checkout.md): editing
// this comment changes this file's hash, which used to bake a non-empty
// drift.changed entry into the committed docs/.doc-graph.json.

const { test, expect } = require('@playwright/test')
const { loginAsOwner } = require('./e2e-auth')
// api() retries a lost connection, never an answer — see ./reconnecting-request.
const { api } = require('./reconnecting-request')

async function chooseBusiness(page, name = 'Business 01') {
  await loginAsOwner(page)
  await page.getByRole('button', { name: new RegExp(`Open Business ${name}`) }).click()
  await expect(page).toHaveURL(/overview/)
}

test.describe('FR-040 Project Work views', () => {
  test('keeps WBS and Dependency Map inside the Work Management module shell', async ({ page }) => {
    await chooseBusiness(page)
    const resolved = await (await api(page.request).get('/api/resolve?type=PROJECT&code=PRJ-B01-TRANSFORM')).json()
    const projectId = resolved.id

    await page.goto(`/projects/${projectId}/structure`)
    await expect(page.getByRole('navigation', { name: 'Projects & Work modules' })).toBeVisible()
    await expect(page.getByRole('link', { name: 'Work Management', exact: true })).toHaveAttribute('aria-current', 'page')
    await expect(page.getByRole('navigation', { name: 'Project work views' })).toBeVisible()
    await expect(page.getByRole('navigation', { name: 'Project Management project sections' })).toHaveCount(0)
    await expect(page.getByRole('navigation', { name: 'Resource Coordination project sections' })).toHaveCount(0)
    await expect(page.getByRole('navigation', { name: 'Project views' })).toHaveCount(0)
    await expect(page.getByRole('tree', { name: /work breakdown structure/i })).toBeVisible()

    await page.getByRole('navigation', { name: 'Project work views' }).getByRole('link', { name: 'Dependency Map' }).click()
    await expect(page).toHaveURL(new RegExp(`/projects/${projectId}/dependencies$`))
    await expect(page.getByRole('heading', { name: 'Dependency Map' })).toBeVisible()
    await expect(page.getByRole('region', { name: 'Dependency edge list' })).toBeVisible()
    await expect(page.getByRole('navigation', { name: 'Project work views' })).toBeVisible()
  })

  // @req FR-006, FR-250 — the Work sub-view bar and the six-module sidebar
  // render together on every project Work route. Only the selected module's
  // local views are shown, and the retired full Project row is absent.
  // @spec SDD-019, ADR-012
  test('names its Work sub-views inside Work Management without the retired Project row', async ({ page }) => {
    await chooseBusiness(page)
    const resolved = await (await api(page.request).get('/api/resolve?type=PROJECT&code=PRJ-B01-TRANSFORM')).json()

    await page.goto(`/projects/${resolved.id}/structure`)

    // The bar is a named landmark, so its links are addressable as a group.
    const workViews = page.getByRole('navigation', { name: 'Project work views' })
    await expect(workViews).toBeVisible()

    for (const label of ['Execution Roadmap', 'Structure Plan', 'Board', 'Work Items', 'Schedule', 'Milestones', 'Dependency Map']) {
      await expect(workViews.getByRole('link', { name: label, exact: true })).toBeVisible()
      // Unscoped: exactly one link on the whole page answers to this name.
      await expect(page.getByRole('link', { name: label, exact: true })).toHaveCount(1)
    }

    await expect(page.getByRole('navigation', { name: 'Project sections' })).toHaveCount(0)
    await expect(page.getByRole('link', { name: 'Milestones & Gates', exact: true })).toHaveCount(0)

    await workViews.getByRole('link', { name: 'Milestones' }).click()
    await expect(page).toHaveURL(new RegExp(`/projects/${resolved.id}/milestones$`))
    await expect(page.getByRole('heading', { name: 'Milestones & Gates' })).toBeVisible()
  })

  test('renders the read-only Execution Roadmap over the same Project graph', async ({ page }) => {
    await chooseBusiness(page)
    const resolved = await (await api(page.request).get('/api/resolve?type=PROJECT&code=PRJ-B01-TRANSFORM')).json()

    await page.goto(`/projects/${resolved.id}/roadmap`)
    await expect(page.getByRole('heading', { name: 'Project outcome' })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Business Goals' })).toBeVisible()
    await expect(page.getByText('Execution Plans')).toBeVisible()
    await expect(page.getByText('Dependencies and blockers')).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Closure' })).toBeVisible()
    await expect(page.getByRole('link', { name: 'Execution Roadmap' })).toBeVisible()
  })

  test('clicks every Work view and keeps one current destination', async ({ page }) => {
    await chooseBusiness(page)
    const resolved = await (await api(page.request).get('/api/resolve?type=PROJECT&code=PRJ-B01-TRANSFORM')).json()
    const projectId = resolved.id
    const views = [
      ['Execution Roadmap', 'roadmap'],
      ['Structure Plan', 'structure'],
      ['Board', 'board'],
      ['Work Items', 'all-work'],
      ['Schedule', 'timeline'],
      ['Milestones', 'milestones'],
      ['Dependency Map', 'dependencies'],
    ]

    await page.goto(`/projects/${projectId}/structure`)
    for (const [label, suffix] of views) {
      const bar = page.getByRole('navigation', { name: 'Project work views' })
      await bar.getByRole('link', { name: label, exact: true }).click()
      await expect(page).toHaveURL(new RegExp(`/projects/${projectId}/${suffix}$`))
      await expect(page.getByRole('navigation', { name: 'Project work views' }).getByRole('link', { name: label, exact: true })).toHaveAttribute('aria-current', 'page')
    }
  })

  test('keeps the graph inside a scrollable canvas on a narrow viewport', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await chooseBusiness(page)
    const resolved = await (await api(page.request).get('/api/resolve?type=PROJECT&code=PRJ-B01-TRANSFORM')).json()

    await page.goto(`/projects/${resolved.id}/dependencies`)
    await page.waitForLoadState('networkidle')

    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
    expect(overflow).toBeLessThanOrEqual(1)
    await expect(page.locator('[class*=graphViewport]')).toHaveCount(1)
    await expect(page.getByRole('region', { name: 'Dependency edge list' })).toBeVisible()
  })
})
