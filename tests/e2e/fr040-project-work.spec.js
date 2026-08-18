// @req FR-040, FR-068 — Project Work views expose Structure Plan, Dependency
// Map and the Human-visible Execution Roadmap.
// @spec SDD-019, ADR-012, ADR-028

const { test, expect } = require('@playwright/test')

async function chooseBusiness(page, name = 'Business 01') {
  await page.goto('/login')
  await page.getByRole('button', { name: /demo login/i }).click()
  await page.getByRole('button', { name: new RegExp(`Open Business ${name}`) }).click()
  await expect(page).toHaveURL(/overview/)
}

test.describe('FR-040 Project Work views', () => {
  test('keeps WBS and Dependency Map inside one canonical Project tab shell', async ({ page }) => {
    await chooseBusiness(page)
    const resolved = await (await page.request.get('/api/resolve?type=PROJECT&code=PRJ-B01-TRANSFORM')).json()
    const projectId = resolved.id

    await page.goto(`/projects/${projectId}/structure`)
    await expect(page.getByRole('navigation', { name: 'Project sections' })).toBeVisible()
    await expect(page.getByRole('link', { name: 'Dependency Map' })).toBeVisible()
    await expect(page.getByRole('navigation', { name: 'Project views' })).toHaveCount(0)
    await expect(page.getByRole('tree', { name: /work breakdown structure/i })).toBeVisible()

    await page.getByRole('link', { name: 'Dependency Map' }).click()
    await expect(page).toHaveURL(new RegExp(`/projects/${projectId}/dependencies$`))
    await expect(page.getByRole('heading', { name: 'Dependency Map' })).toBeVisible()
    await expect(page.getByRole('region', { name: 'Dependency edge list' })).toBeVisible()
    await expect(page.getByRole('navigation', { name: 'Project sections' })).toBeVisible()
  })

  // @req FR-006 — the Work sub-view bar and the Development sidebar render
  // together on every project Work route. Neither may offer the same link name
  // for a different route: the project-scoped tab is "Milestones", the
  // Business-wide sidebar entry is "Milestones & Gates". A duplicate is
  // ambiguous to a reader and to a screen reader, and `getByRole(...).click()`
  // fails outright on one — which is how the collision was found.
  // @spec SDD-019, ADR-012
  test('names its Work sub-views apart from the Development sidebar', async ({ page }) => {
    await chooseBusiness(page)
    const resolved = await (await page.request.get('/api/resolve?type=PROJECT&code=PRJ-B01-TRANSFORM')).json()

    await page.goto(`/projects/${resolved.id}/structure`)

    // The bar is a named landmark, so its links are addressable as a group
    // rather than by hoping the labels stay unique.
    const workViews = page.getByRole('navigation', { name: 'Project work views' })
    await expect(workViews).toBeVisible()

    for (const label of ['Execution Roadmap', 'Structure Plan', 'Board', 'Schedule', 'Milestones', 'Dependency Map']) {
      await expect(workViews.getByRole('link', { name: label, exact: true })).toBeVisible()
      // Unscoped: exactly one link on the whole page answers to this name.
      await expect(page.getByRole('link', { name: label, exact: true })).toHaveCount(1)
    }

    // The sidebar keeps its own name for the Business-wide route.
    await expect(page.getByRole('link', { name: 'Milestones & Gates', exact: true })).toHaveAttribute('href', '/milestones')

    await workViews.getByRole('link', { name: 'Milestones' }).click()
    await expect(page).toHaveURL(new RegExp(`/projects/${resolved.id}/milestones$`))
    await expect(page.getByRole('heading', { name: 'Milestones & Gates' })).toBeVisible()
  })

  test('renders the read-only Execution Roadmap over the same Project graph', async ({ page }) => {
    await chooseBusiness(page)
    const resolved = await (await page.request.get('/api/resolve?type=PROJECT&code=PRJ-B01-TRANSFORM')).json()

    await page.goto(`/projects/${resolved.id}/roadmap`)
    await expect(page.getByRole('heading', { name: 'Project outcome' })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Business Goals' })).toBeVisible()
    await expect(page.getByText('Execution Plans')).toBeVisible()
    await expect(page.getByText('Dependencies and blockers')).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Closure' })).toBeVisible()
    await expect(page.getByRole('link', { name: 'Execution Roadmap' })).toBeVisible()
  })

  test('keeps the graph inside a scrollable canvas on a narrow viewport', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await chooseBusiness(page)
    const resolved = await (await page.request.get('/api/resolve?type=PROJECT&code=PRJ-B01-TRANSFORM')).json()

    await page.goto(`/projects/${resolved.id}/dependencies`)
    await page.waitForLoadState('networkidle')

    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
    expect(overflow).toBeLessThanOrEqual(1)
    await expect(page.locator('[class*=graphViewport]')).toHaveCount(1)
    await expect(page.getByRole('region', { name: 'Dependency edge list' })).toBeVisible()
  })
})
