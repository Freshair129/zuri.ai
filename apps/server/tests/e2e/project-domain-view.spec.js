// @req FR-251 — the authorized Project surface exposes the read-only Execution
// Domains projection with honest binding states, context retention and mobile
// keyboard access.
// @spec ADR-096, SDD-019, docs/architecture/project-manager-system/23-PROJECT-DOMAIN-FEATURE-IMPLEMENTATION-BASELINE.md
// @tested tests/e2e/project-domain-view.spec.js

const { test, expect } = require('@playwright/test')
const { loginAsOwner } = require('./e2e-auth')
const { api } = require('./reconnecting-request')

async function openProject(page) {
  await loginAsOwner(page)
  await page.getByRole('button', { name: /Open Business Business 01/ }).click()
  await expect(page).toHaveURL(/\/overview$/)
  const response = await api(page.request).get('/api/resolve?type=PROJECT&code=PRJ-B01-TRANSFORM')
  expect(response.ok(), `Project fixture resolution returned HTTP ${response.status()}`).toBe(true)
  const project = await response.json()
  await page.goto(`/projects/${project.id}`)
  await expect(page.getByRole('navigation', { name: 'Project Management project sections' })).toBeVisible()
  return project
}

function domainView(projectId, domains = []) {
  return {
    schemaVersion: '1.0',
    projectId,
    snapshotId: null,
    snapshotState: 'UNAVAILABLE',
    observedAt: '2026-09-16T00:00:00.000Z',
    totalUniqueWorkCount: 5,
    unboundWorkstreamCount: 2,
    domains,
  }
}

function domainRow({ domainId, label, mappingState = 'MAPPED', technicalOwnerIds = ['TD-E2E-OWNER'] }) {
  return {
    domainId,
    label,
    mappingState,
    ownership: {
      primaryWorkstreamCount: 2,
      supportingWorkstreamCount: 1,
      technicalOwnerIds,
    },
    work: { uniqueWorkCount: 3, workstreamCount: 2 },
    featureIds: [],
    featureState: 'NOT_BOUND',
    blockerState: 'UNAVAILABLE',
    blockerCount: null,
    contractState: 'UNAVAILABLE',
    gapState: 'UNAVAILABLE',
    evidence: [],
  }
}

async function stubDomainView(page, projectId, bodyOrResponse) {
  await page.route(`**/api/projects/${projectId}/domain-view`, async (route) => {
    const response = typeof bodyOrResponse === 'function' ? bodyOrResponse() : bodyOrResponse
    await route.fulfill({
      status: response.status || 200,
      contentType: 'application/json',
      body: JSON.stringify(response.body || response),
    })
  })
}

test.describe('FR-251 Project Execution Domains', () => {
  test('activates Delivery Design only in Project context and keeps Import reversible', async ({ page }, testInfo) => {
    const project = await openProject(page)
    const domainResponse = page.waitForResponse((response) => {
      return response.url().endsWith(`/api/projects/${project.id}/domain-view`) && response.request().method() === 'GET'
    })

    await page.getByRole('link', { name: 'Delivery Design', exact: true }).click()
    await expect(page).toHaveURL(new RegExp(`/projects/${project.id}/domain-view$`))
    expect((await domainResponse).status()).toBe(200)

    const projectSections = page.getByRole('navigation', { name: 'Delivery Design project sections' })
    await expect(projectSections).toBeVisible()
    await expect(projectSections.getByRole('link', { name: /Execution Domains/ })).toHaveAttribute('aria-current', 'page')
    const planned = page.getByRole('group', { name: 'Delivery Design planned capabilities' })
    await expect(planned).toBeVisible()
    for (const label of ['Requirements', 'Architecture', 'API', 'Docs & Decisions']) {
      await expect(planned.locator(`[data-local-surface-id="dd.${label === 'Docs & Decisions' ? 'docs-decisions' : label.toLowerCase()}"]`)).toContainText(label)
    }
    await expect(planned.getByRole('link')).toHaveCount(0)

    await expect(page.getByRole('heading', { name: 'Execution Domains', exact: true })).toBeVisible()
    await expect(page.getByText("Domains served by this Project's workstreams", { exact: true })).toBeVisible()
    await expect(page.locator('[data-action-id="pm.import"]')).toHaveCount(1)
    await page.screenshot({ path: testInfo.outputPath('project-domain-desktop.png'), fullPage: true, animations: 'disabled' })

    await page.locator('[data-action-id="pm.import"]').click()
    await expect(page).toHaveURL(new RegExp(`/projects/${project.id}/import$`))
    await expect(page.locator('[data-action-id="pm.import"]')).toHaveAttribute('aria-current', 'page')
    await expect(page.getByRole('link', { name: 'Return to Project overview' })).toHaveAttribute('href', `/projects/${project.id}`)
    await page.getByRole('link', { name: 'Return to Project overview' }).click()
    await expect(page).toHaveURL(new RegExp(`/projects/${project.id}$`))
  })

  test('renders mapped, unknown and empty bindings with explicit unavailable values', async ({ page }) => {
    const project = await openProject(page)
    await stubDomainView(page, project.id, domainView(project.id, [
      domainRow({ domainId: 'DOM-DEVELOPMENT', label: 'Development' }),
      domainRow({ domainId: 'DOM-IMPORTED-E2E', label: 'Imported binding', mappingState: 'UNMAPPED' }),
    ]))
    await page.goto(`/projects/${project.id}/domain-view`)

    const view = page.getByTestId('project-domain-view')
    await expect(view).toHaveAttribute('data-view-state', 'ready')
    await expect(view.locator('[data-domain-id="DOM-DEVELOPMENT"]')).toContainText('Mapped')
    await expect(view.locator('[data-domain-id="DOM-IMPORTED-E2E"]')).toContainText('Unknown binding')
    await expect(view.locator('[data-domain-id="DOM-IMPORTED-E2E"]')).toContainText('no matching catalog label')
    await expect(view).toContainText('No feature bindings')
    await expect(view).toContainText('No evidence available')
    await expect(view).toContainText('Snapshot unavailable')
    await expect(view).toContainText('Work is counted once in the Project total')
    await expect(view.locator('[data-domain-id] a')).toHaveCount(0)

    await page.unroute(`**/api/projects/${project.id}/domain-view`)
    await stubDomainView(page, project.id, domainView(project.id))
    await page.reload()
    await expect(view).toHaveAttribute('data-view-state', 'empty')
    await expect(view).toContainText('No execution domains')
    await expect(view).toContainText('Unassigned workstreams')
    await expect(view).toContainText('2 active Workstreams have no primary domain binding.')
  })

  test('keeps loading and redacted failure states scoped to the requested Project', async ({ page }) => {
    const project = await openProject(page)
    let releaseLoading
    const loadingGate = new Promise((resolve) => { releaseLoading = resolve })
    await page.route(`**/api/projects/${project.id}/domain-view`, async (route) => {
      await loadingGate
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(domainView(project.id, [domainRow({ domainId: 'DOM-DEVELOPMENT', label: 'Development' })])),
      })
    })
    await page.goto(`/projects/${project.id}/domain-view`, { waitUntil: 'domcontentloaded' })
    await expect(page.getByTestId('project-domain-view')).toHaveAttribute('data-view-state', 'loading')
    releaseLoading()
    await expect(page.getByTestId('project-domain-view')).toHaveAttribute('data-view-state', 'ready')

    await page.unroute(`**/api/projects/${project.id}/domain-view`)
    await page.route(`**/api/projects/${project.id}/domain-view`, async (route) => {
      await route.fulfill({
        status: 401,
        contentType: 'application/json',
        body: JSON.stringify({ code: 'AUTH_REQUIRED', message: 'Authentication is required.' }),
      })
    })
    await page.reload()
    await expect(page.getByTestId('project-domain-view')).toHaveAttribute('data-view-state', 'forbidden')
    await expect(page.getByTestId('project-domain-view').getByRole('alert').getByText('Authentication required', { exact: true })).toBeVisible()
    await expect(page.locator('[data-domain-id]')).toHaveCount(0)

    await page.unroute(`**/api/projects/${project.id}/domain-view`)
    await page.route(`**/api/projects/${project.id}/domain-view`, async (route) => {
      await route.fulfill({
        status: 404,
        contentType: 'application/json',
        body: JSON.stringify({ code: 'RESOURCE_NOT_FOUND', message: 'Resource not found.' }),
      })
    })
    await page.reload()
    await expect(page.getByTestId('project-domain-view')).toHaveAttribute('data-view-state', 'not-found')
    await expect(page.getByTestId('project-domain-view').getByRole('alert').getByText('Project not found', { exact: true })).toBeVisible()
    await expect(page.locator('[data-domain-id]')).toHaveCount(0)

    await page.unroute(`**/api/projects/${project.id}/domain-view`)
    await page.route(`**/api/projects/${project.id}/domain-view`, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          ...domainView('00000000-0000-4000-8000-000000000247', [domainRow({ domainId: 'DOM-WRONG-PROJECT', label: 'Wrong Project' })]),
          totalUniqueWorkCount: 991,
          unboundWorkstreamCount: 992,
        }),
      })
    })
    await page.reload()
    await expect(page.getByTestId('project-domain-view')).toHaveAttribute('data-view-state', 'request-failed')
    await expect(page.getByTestId('project-domain-view').getByRole('alert').getByText('Execution Domains unavailable', { exact: true })).toBeVisible()
    await expect(page.locator('[data-domain-id]')).toHaveCount(0)
    await expect(page.getByText('991', { exact: true })).toHaveCount(0)
    await expect(page.getByText('992', { exact: true })).toHaveCount(0)

    await page.unroute(`**/api/projects/${project.id}/domain-view`)
    await page.route(`**/api/projects/${project.id}/domain-view`, async (route) => {
      await route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({ code: 'SERVICE_UNAVAILABLE', message: 'Service temporarily unavailable.', retryable: true }),
      })
    })
    await page.reload()
    await expect(page.getByTestId('project-domain-view')).toHaveAttribute('data-view-state', 'request-failed')
    await expect(page.getByTestId('project-domain-view').getByRole('alert').getByText('Execution Domains unavailable', { exact: true })).toBeVisible()
    await expect(page.locator('[data-domain-id]')).toHaveCount(0)
  })

  test('supports keyboard navigation, browser Back and 390px Project context', async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 390, height: 844 })
    const project = await openProject(page)
    await stubDomainView(page, project.id, domainView(project.id, [domainRow({
      domainId: 'DOM-DEVELOPMENT',
      label: 'Development',
      technicalOwnerIds: ['TD-OWNER-WITH-A-LONG-IDENTIFIER-FOR-MOBILE-WRAPPING-001', 'TD-SECOND-LONG-IDENTIFIER-002'],
    })]))

    const toggle = page.getByRole('button', { name: 'Toggle Projects & Work navigation' })
    await toggle.click()
    const deliveryDesign = page.getByRole('link', { name: 'Delivery Design', exact: true })
    await deliveryDesign.focus()
    await expect(deliveryDesign).toBeFocused()
    await page.keyboard.press('Enter')
    await expect(page).toHaveURL(new RegExp(`/projects/${project.id}/domain-view$`))
    await expect(page.getByRole('heading', { name: 'Execution Domains', exact: true })).toBeVisible()

    const projectSections = page.getByRole('navigation', { name: 'Delivery Design project sections' })
    const executionDomainsTab = projectSections.getByRole('link', { name: /Execution Domains/ })
    await executionDomainsTab.focus()
    await expect(executionDomainsTab).toBeFocused()
    await expect(page.getByRole('group', { name: 'Delivery Design planned capabilities' })).toBeVisible()
    await expect(page.getByTestId('project-domain-view')).toBeVisible()

    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
    expect(overflow).toBeLessThanOrEqual(1)
    await expect(page.getByText('TD-OWNER-WITH-A-LONG-IDENTIFIER-FOR-MOBILE-WRAPPING-001', { exact: false })).toBeVisible()
    await page.screenshot({ path: testInfo.outputPath('project-domain-mobile.png'), fullPage: true, animations: 'disabled' })
    await page.goBack()
    await expect(page).toHaveURL(new RegExp(`/projects/${project.id}$`))
    await expect(page.getByRole('navigation', { name: 'Project Management project sections' })).toBeVisible()
  })
})
