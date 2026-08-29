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

const WORK_VIEWS = ['Execution Roadmap', 'Structure Plan', 'Board', 'Schedule', 'Milestones', 'Dependency Map']

async function chooseBusiness(page, name = 'Business 01') {
  await loginAsOwner(page)
  await page.getByRole('button', { name: new RegExp(`Open Business ${name}`) }).click()
  await expect(page).toHaveURL(/overview/)
}

async function projectId(page) {
  const resolved = await (await api(page.request).get('/api/resolve?type=PROJECT&code=PRJ-B01-TRANSFORM')).json()
  return resolved.id
}

// Scoped to the landmark on purpose: the Development sidebar is on screen at
// the same time, and an unscoped link name would silently match the wrong one.
const workViews = (page) => page.getByRole('navigation', { name: 'Project work views' })
const projectTabs = (page) => page.getByRole('navigation', { name: 'Project sections' })

test.describe('navigation reachability', () => {
  test('reaches Plan Import by clicking, not by typing the URL', async ({ page }) => {
    await chooseBusiness(page)
    const id = await projectId(page)
    await page.goto(`/projects/${id}`)

    await projectTabs(page).getByRole('link', { name: 'Import' }).click()

    await expect(page).toHaveURL(new RegExp(`/projects/${id}/import$`))
    await expect(page.getByRole('heading', { name: 'Import Plan Envelope' })).toBeVisible()
    // The tab that brought the user here reads as current once they arrive.
    await expect(projectTabs(page).getByRole('link', { name: 'Import' })).toHaveAttribute('aria-current', 'page')
  })

  // A Work sub-view whose page does not itself render the tab bar is a one-way
  // door. Land on each one and prove every sibling is still offered.
  //
  // `fr040-project-work.spec.js` lands on `/structure` alone. The other five
  // routes are only covered here, and a tab bar can go missing on one route
  // while rendering on its neighbour.
  for (const [label, suffix] of [
    ['Execution Roadmap', 'roadmap'],
    ['Structure Plan', 'structure'],
    ['Board', 'board'],
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

  test('reaches the Space list by browsing and by search', async ({ page }) => {
    await chooseBusiness(page)

    // Browse: from the resource list whose rows already carry a Space column.
    await page.goto('/projects')
    await page.getByRole('link', { name: 'Spaces' }).click()
    await expect(page).toHaveURL(/\/workspaces$/)
    await expect(page.getByRole('heading', { name: 'Spaces' })).toBeVisible()

    // Search: the palette indexes it as a resource, not as a sidebar capability.
    await page.goto('/overview')
    await page.getByRole('button', { name: /Open command palette/i }).click()
    await page.getByLabel('Command palette search').fill('Spaces')
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
  test('search never offers a reserved domain that has no page', async ({ page }) => {
    await chooseBusiness(page)
    await page.goto('/overview')
    await page.getByRole('button', { name: /Open command palette/i }).click()
    const input = page.getByLabel('Command palette search')
    for (const reserved of ['Commerce', 'Campaigns']) {
      await input.fill(reserved)
      await expect(page.getByText(/No matches for/i)).toBeVisible()
    }
  })
})

// Dropped from the recovered file rather than carried forward, because each is
// already pinned elsewhere and a second copy only doubles the maintenance:
//
//   'does not reuse a sidebar link name for a different project route'
//     → fr040-project-work.spec.js 'names its Work sub-views apart from the
//       Development sidebar', which asserts the same six-label uniqueness and
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
