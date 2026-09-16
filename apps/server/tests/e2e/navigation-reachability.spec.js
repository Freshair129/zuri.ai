// @req FR-001, FR-006, FR-012, FR-015, FR-044 — every delivered surface has a
// navigation path a user can actually follow, and no in-shell control leaves
// the shell to reach an in-shell destination.
// @spec SDD-019, SDD-034, ADR-008 §D6, ADR-012
//
// Three routes shipped with zero inbound links from anywhere in the
// application — `/workspaces`, `/projects/{id}/milestones` and
// `/projects/{id}/import` — and were reachable only by typing the URL. The unit
// tests pin the wiring; this file walks the result the way a user does, because
// wiring that renders behind a permission gate, or a tab that resolves to a
// page with no way back, is still a broken path.
//
// The distinction this file owns, and the reason it is not redundant with
// `smoke.spec.js`: smoke proves each page *renders* when you `goto` its URL.
// Nothing there proves a user could have *arrived*. `smoke.spec.js:225` says so
// in its own words — it reaches the Import page by "direct URL" on purpose.
// Rendering is not reachability, and only reachability is testable from the
// outside by clicking.
//
// Recovered on 2026-08-29 from a `git stash` where it had sat untracked since
// 2026-08-19, so no guard could see it: preflight, doc-graph and CI all read
// tracked files, and an untracked file in a stash is invisible to every one of
// them. It was written against the pre-`e2e-auth.js` login flow and three of its
// cases have since been covered elsewhere; those are dropped and named below
// rather than duplicated.

const { test, expect } = require('@playwright/test')
const { loginAsOwner } = require('./e2e-auth')
// api() retries a lost connection, never an answer — see ./reconnecting-request.
const { api } = require('./reconnecting-request')

// Order mirrors WorkViewTabs.jsx, so a reader can diff the two by eye. All
// SEVEN, deliberately: the first version of this list held six and omitted
// 'Work Items', which joined the bar in ab7fb03 on the same day this spec was
// written. Nothing caught it, because a list that names what it checks cannot
// report the one it never named.
const WORK_VIEWS = [
  'Execution Roadmap', 'Structure Plan', 'Board', 'Work Items',
  'Schedule', 'Milestones', 'Dependency Map',
]

async function chooseBusiness(page, name = 'Business 01') {
  await loginAsOwner(page)
  await page.getByRole('button', { name: new RegExp(`Open Business ${name}`) }).click()
  await expect(page).toHaveURL(/overview/)
}

async function projectId(page) {
  const resolved = await (await api(page.request).get('/api/resolve?type=PROJECT&code=PRJ-B01-TRANSFORM')).json()
  return resolved.id
}

// Scoped to the landmark on purpose: the Projects & Work module sidebar is on
// screen at the same time as the module-local rows.
const workViews = (page) => page.getByRole('navigation', { name: 'Project work views' })
const projectModules = (page) => page.getByRole('navigation', { name: 'Projects & Work modules' })
const projectSections = (page, moduleLabel) => page.getByRole('navigation', { name: `${moduleLabel} project sections` })
const importAction = (page) => page.locator('[data-action-id="pm.import"]')

test.describe('navigation reachability', () => {
  test('reaches the shared Import plan action by clicking from each live Project module', async ({ page }) => {
    await chooseBusiness(page)
    const id = await projectId(page)
    const liveModules = [
      ['Project Management', `/projects/${id}`, 'Project Management'],
      ['Work Management', `/projects/${id}/structure`, null],
      ['Resource Coordination', `/projects/${id}/team`, 'Resource Coordination'],
    ]

    for (const [moduleLabel, expectedModulePath, localLabel] of liveModules) {
      await page.goto(`/projects/${id}`)
      await projectModules(page).getByRole('link', { name: moduleLabel, exact: true }).click()
      await expect(page).toHaveURL(new RegExp(`${expectedModulePath.replaceAll('/', '\\/')}$`))
      if (localLabel) await expect(projectSections(page, localLabel)).toBeVisible()
      else await expect(workViews(page)).toBeVisible()

      await importAction(page).click()
      await expect(page).toHaveURL(new RegExp(`/projects/${id}/import$`))
      await expect(page.getByRole('heading', { name: 'Import Plan Envelope' })).toBeVisible()
      // Import is one shared Project action. It reads as current on its route
      // and exposes an explicit return path to the Project overview.
      await expect(importAction(page)).toHaveAttribute('aria-current', 'page')
      await expect(page.getByRole('link', { name: 'Return to Project overview' })).toHaveAttribute('href', `/projects/${id}`)
      await page.getByRole('link', { name: 'Return to Project overview' }).click()
      await expect(page).toHaveURL(new RegExp(`/projects/${id}$`))
    }
  })

  test('discloses named planned modules without hrefs and returns focus on Escape', async ({ page }) => {
    await chooseBusiness(page)
    await page.goto('/projects')
    const modules = projectModules(page)
    for (const label of ['Delivery Design', 'Delivery Governance', 'Agent Delivery']) {
      const trigger = modules.getByRole('button', { name: new RegExp(label) })
      await trigger.click()
      const panel = page.getByRole('group', { name: `${label} planned capabilities` })
      await expect(panel).toBeVisible()
      await expect(panel).toContainText('Planned — not available yet')
      await expect(panel.getByRole('link')).toHaveCount(0)
      await page.keyboard.press('Escape')
      await expect(panel).toBeHidden()
      await expect(trigger).toBeFocused()
    }
  })

  test('keeps the six-module sidebar usable at 390px when collapsed and expanded', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await chooseBusiness(page)
    await page.goto('/projects')

    const modules = projectModules(page)
    const toggle = page.getByRole('button', { name: 'Toggle Projects & Work navigation' })
    await expect(toggle).toBeVisible()
    await expect(modules).toBeHidden()

    await toggle.click()
    await expect(modules).toBeVisible()
    await expect(modules.getByRole('link')).toHaveCount(3)
    await expect(modules.getByRole('button')).toHaveCount(3)

    const plannedTrigger = modules.getByRole('button', { name: /Delivery Design/ })
    await plannedTrigger.click()
    const plannedPanel = page.getByRole('group', { name: 'Delivery Design planned capabilities' })
    await expect(plannedPanel).toBeVisible()
    await expect(plannedPanel).toContainText('Requirements')
    await expect(plannedPanel.getByRole('link')).toHaveCount(0)
    await page.keyboard.press('Escape')
    await expect(plannedPanel).toBeHidden()
    await expect(plannedTrigger).toBeFocused()

    await toggle.click()
    await expect(modules).toBeHidden()
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
    expect(overflow).toBeLessThanOrEqual(1)
  })

  test('clicks all eight Business destinations through their selected module', async ({ page }) => {
    await chooseBusiness(page)
    const destinations = [
      ['Project Management', 'Project Management Business sections', 'Projects', /\/projects$/],
      ['Work Management', 'Work Management Business sections', 'All Work', /\/work$/],
      ['Work Management', 'Work Management Business sections', 'Execution', /\/execution$/],
      ['Work Management', 'Work Management Business sections', 'Timeline', /\/timeline$/],
      ['Work Management', 'Work Management Business sections', 'Dependencies', /\/dependencies$/],
      ['Work Management', 'Work Management Business sections', 'Milestones & Gates', /\/milestones$/],
      ['Resource Coordination', 'Resource Coordination Business sections', 'Files', /\/files$/],
      ['Resource Coordination', 'Resource Coordination Business sections', 'Repositories', /\/repositories$/],
    ]
    for (const [moduleLabel, navLabel, destinationLabel, expectedUrl] of destinations) {
      await page.goto('/projects')
      await projectModules(page).getByRole('link', { name: moduleLabel, exact: true }).click()
      await page.getByRole('navigation', { name: navLabel }).getByRole('link', { name: destinationLabel, exact: true }).click()
      await expect(page).toHaveURL(expectedUrl)
      await expect(page.getByRole('navigation', { name: navLabel })).toBeVisible()
    }
  })

  test('clicks Project, read-only Inventory, Team, Files, and Repositories in their owning modules', async ({ page }) => {
    await chooseBusiness(page)
    const id = await projectId(page)
    await page.goto(`/projects/${id}`)

    const projectSections = page.getByRole('navigation', { name: 'Project Management project sections' })
    await projectSections.getByRole('link', { name: 'Inventory', exact: false }).click()
    await expect(page).toHaveURL(new RegExp(`/projects/${id}/inventory$`))
    await expect(page.getByRole('navigation', { name: 'Project Management project sections' }).getByRole('link', { name: /Inventory/ })).toHaveAttribute('aria-current', 'page')

    await projectModules(page).getByRole('link', { name: 'Resource Coordination', exact: true }).click()
    await expect(page).toHaveURL(new RegExp(`/projects/${id}/team$`))
    const resourceSections = page.getByRole('navigation', { name: 'Resource Coordination project sections' })
    await resourceSections.getByRole('link', { name: 'Files', exact: true }).click()
    await expect(page).toHaveURL(new RegExp(`/projects/${id}/files$`))
    await resourceSections.getByRole('link', { name: 'Repositories', exact: true }).click()
    await expect(page).toHaveURL(new RegExp(`/projects/${id}/repositories$`))
    await resourceSections.getByRole('link', { name: 'Team', exact: true }).click()
    await expect(page).toHaveURL(new RegExp(`/projects/${id}/team$`))
  })

  test('keeps planned Resources discoverable in Resource Coordination without a fake link', async ({ page }) => {
    await chooseBusiness(page)
    const id = await projectId(page)
    await page.goto(`/projects/${id}/team`)
    const planned = page.getByRole('group', { name: 'Resource Coordination planned capabilities' })
    await expect(planned).toBeVisible()
    await expect(planned).toContainText('Resources')
    await expect(planned.getByRole('link')).toHaveCount(0)
  })

  test('retains Project context across live module changes and clears it through All projects', async ({ page }) => {
    await chooseBusiness(page)
    const id = await projectId(page)
    await page.goto(`/projects/${id}`)

    await projectModules(page).getByRole('link', { name: 'Work Management', exact: true }).click()
    await expect(page).toHaveURL(new RegExp(`/projects/${id}/structure$`))
    await expect(page.locator(`[data-project-id="${id}"]`)).toBeVisible()

    await page.goBack()
    await expect(page).toHaveURL(new RegExp(`/projects/${id}$`))
    await expect(page.locator(`[data-project-id="${id}"]`)).toBeVisible()

    await page.getByRole('link', { name: 'All projects', exact: true }).click()
    await expect(page).toHaveURL(/\/projects$/)
    await expect(page.locator(`[data-project-id="${id}"]`)).toHaveCount(0)
    await expect(page.getByRole('navigation', { name: 'Project Management Business sections' })).toBeVisible()
  })

  // A Work sub-view whose page does not itself render the tab bar is a one-way
  // door. Land on each one and prove every sibling is still offered.
  //
  // `fr040-project-work.spec.js` lands on `/structure` alone. The other six
  // routes are only covered here, and a tab bar can go missing on one route
  // while rendering on its neighbour.
  //
  // Both loops must stay in step with WorkViewTabs.jsx: this one decides which
  // routes are landed on, WORK_VIEWS decides which siblings are demanded once
  // there. A view missing from the pairs is never visited; missing from
  // WORK_VIEWS, it can be dropped from the bar with the suite still green.
  for (const [label, suffix] of [
    ['Execution Roadmap', 'roadmap'],
    ['Structure Plan', 'structure'],
    ['Board', 'board'],
    ['Work Items', 'all-work'],
    ['Schedule', 'timeline'],
    ['Milestones', 'milestones'],
    ['Dependency Map', 'dependencies'],
  ]) {
    test(`keeps the Work sub-views reachable from ${label}`, async ({ page }) => {
      await chooseBusiness(page)
      const id = await projectId(page)
      await page.goto(`/projects/${id}/${suffix}`)

      const bar = workViews(page)
      await expect(bar).toBeVisible()
      for (const sibling of WORK_VIEWS) {
        await expect(bar.getByRole('link', { name: sibling, exact: true })).toBeVisible()
      }
    })
  }

  test('reaches the Workspace list by browsing and by search', async ({ page }) => {
    await chooseBusiness(page)

    // Browse: from the resource list whose rows already carry a Workspace column.
    await page.goto('/projects')
    await page.getByRole('link', { name: 'Workspaces' }).click()
    await expect(page).toHaveURL(/\/workspaces$/)
    await expect(page.getByRole('heading', { name: 'Workspaces' })).toBeVisible()

    // Search: the palette indexes it as a resource, not as a sidebar capability.
    await page.goto('/overview')
    await page.getByRole('button', { name: /Open command palette/i }).click()
    await page.getByLabel('Command palette search').fill('Workspaces')
    await page.keyboard.press('Enter')
    await expect(page).toHaveURL(/\/workspaces$/)
  })

  test('search covers Platform, which it previously could not reach at all', async ({ page }) => {
    await chooseBusiness(page)
    await page.goto('/overview')
    await page.getByRole('button', { name: /Open command palette/i }).click()
    await page.getByLabel('Command palette search').fill('Audit')
    await page.keyboard.press('Enter')
    await expect(page).toHaveURL(/\/audit$/)
    await expect(page.getByRole('heading', { name: 'Audit Log' })).toBeVisible()
  })

  // `soon` domains are reserved slots with no page behind them. The palette
  // navigates with router.push, and this app has no 404 screen to land on.
  //
  // Distinct from `smoke.spec.js:93`, which proves one *label* ("Overview")
  // matches nothing. This proves a reserved *domain* is never offered — a
  // different way for the palette to strand a user.
  //
  // @req FR-166 — this probe used to type "Commerce" and expect no match; the
  // Commerce slot is delivered now, so the palette must find it instead.
  test('search never offers a reserved domain that has no page, and finds the delivered ones', async ({ page }) => {
    await chooseBusiness(page)
    await page.goto('/overview')
    await page.getByRole('button', { name: /Open command palette/i }).click()
    const input = page.getByLabel('Command palette search')
    // "Operations" also names an execution view, so the word finds a result;
    // the proof is that the reserved slot's own entry is never among them.
    await input.fill('Operations')
    await expect(page.getByRole('button', { name: /Operations view/ })).toBeVisible()
    await expect(page.getByRole('button', { name: /Operations · Dashboard/ })).toHaveCount(0)
    // @req FR-160 — Campaigns is delivered (Marketing) and must be reachable by search.
    await input.fill('Campaigns')
    await page.keyboard.press('Enter')
    await expect(page).toHaveURL(/\/growth\/campaigns$/)
    await expect(page.getByRole('heading', { name: 'Campaigns', exact: true })).toBeVisible()
    // The delivered Order Management slot (the Commerce lane, relabelled by
    // ADR-069) is offered and opens too.
    await page.goto('/overview')
    await page.getByRole('button', { name: /Open command palette/i }).click()
    await input.fill('Order Management · Orders')
    await page.keyboard.press('Enter')
    await expect(page).toHaveURL(/\/commerce\/orders$/)
    await expect(page.getByRole('heading', { name: 'ออเดอร์ (Orders)', exact: true })).toBeVisible()
  })
})

// Dropped from the recovered file rather than carried forward, because each is
// already pinned elsewhere and a second copy only doubles the maintenance:
//
//   'does not reuse a sidebar link name for a different project route'
//     → fr040-project-work.spec.js 'names its Work sub-views apart from the
//       Projects & Work module sidebar', which asserts the same uniqueness and
//       additionally pins the sidebar's own `Milestones & Gates` href.
//
//   'reaches project Milestones from the Work sub-view tabs'
//     → the closing assertions of that same fr040 test.
//
//   '"Choose Business" stays inside the shell'
//     → fr044-entry-routing.spec.js. This one is not merely duplicated, it is
//       obsolete: it asserted an in-shell CTA with href `/businesses`, and
//       `business-shell-guard.js` now *redirects* on BUSINESS_REQUIRED instead
//       of rendering a link. fr044 covers the behaviour that replaced it.
