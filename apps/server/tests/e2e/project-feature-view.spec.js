// @req FR-252 — the authorized Project surface exposes explicit Feature
// authority, relationships and evidence as a read-only list/detail view.
// @spec ADR-097, SDD-019, docs/architecture/project-manager-system/24-PHASE-B-FEATURE-IMPLEMENTATION-PLAN.md
// @tested tests/e2e/project-feature-view.spec.js

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

function workLink({ id, workItemId = '00000000-0000-4000-8000-000000000401' }) {
  return {
    id,
    version: 1,
    workItemId,
    allocationBps: null,
    allocationState: 'UNALLOCATED',
    workItem: { code: 'WI-FEATURE-001', title: 'Shared Feature WorkItem' },
  }
}

function featureRecord(projectId, {
  id = '00000000-0000-4000-8000-000000000301',
  code = 'FEAT-LOCAL-001',
  title = 'Local Feature authority',
  lifecycle = 'DRAFT',
  primaryDomain = { domainId: 'DOM-CRM', label: 'Customer', mappingState: 'MAPPED' },
  contributions = [],
  workLinks = [workLink({ id: '00000000-0000-4000-8000-000000000411' })],
} = {}) {
  return {
    id,
    version: 1,
    projectId,
    code,
    title,
    problem: 'A bounded Project problem.',
    outcome: 'A measurable Project outcome.',
    primaryDomain,
    contributions,
    workLinks,
    requirementBindings: [],
    canonicalFeatureKey: null,
    governanceSnapshotId: null,
    lifecycle,
    uniqueWorkCount: workLinks.length > 0 ? 1 : 0,
    evidence: [],
    evidenceState: 'UNAVAILABLE',
  }
}

function featureView(projectId, features = []) {
  return {
    schemaVersion: '1.0',
    projectId,
    snapshotId: null,
    snapshotState: 'UNAVAILABLE',
    observedAt: '2026-09-17T00:00:00.000Z',
    uniqueWorkCount: features.length > 0 ? 1 : 0,
    features,
  }
}

async function stubFeatureView(page, projectId, bodyOrResponse) {
  await page.route(`**/api/projects/${projectId}/feature-view`, async (route) => {
    const response = typeof bodyOrResponse === 'function' ? await bodyOrResponse() : bodyOrResponse
    await route.fulfill({
      status: response.status || 200,
      contentType: 'application/json',
      body: JSON.stringify(response.body || response),
    })
  })
}

async function stubFeatureDetail(page, projectId, featureId, bodyOrResponse) {
  await page.route(`**/api/projects/${projectId}/features/${featureId}`, async (route) => {
    const response = typeof bodyOrResponse === 'function' ? await bodyOrResponse() : bodyOrResponse
    await route.fulfill({
      status: response.status || 200,
      contentType: 'application/json',
      body: JSON.stringify(response.body || response),
    })
  })
}

async function openFeatureRoute(page, project, features) {
  await stubFeatureView(page, project.id, featureView(project.id, features))
  await page.goto(`/projects/${project.id}/feature-view`)
  await expect(page.getByTestId('project-feature-view')).toHaveAttribute('data-view-state', features.length ? 'ready' : 'empty')
}

test.describe('FR-252 Project Features read-only view', () => {
  test('activates the Project Feature tab and preserves Import and planned peers', async ({ page }) => {
    const project = await openProject(page)
    await stubFeatureView(page, project.id, featureView(project.id, [featureRecord(project.id)]))

    await page.getByRole('link', { name: 'Delivery Design', exact: true }).click()
    await page.getByRole('navigation', { name: 'Delivery Design project sections' }).getByRole('link', { name: /Features/ }).click()
    await expect(page).toHaveURL(new RegExp(`/projects/${project.id}/feature-view$`))

    const sections = page.getByRole('navigation', { name: 'Delivery Design project sections' })
    await expect(sections.getByRole('link', { name: /Features/ })).toHaveAttribute('aria-current', 'page')
    const planned = page.getByRole('group', { name: 'Delivery Design planned capabilities' })
    await expect(planned).toBeVisible()
    for (const label of ['Requirements', 'Architecture', 'API', 'Docs & Decisions']) {
      await expect(planned).toContainText(label)
    }
    await expect(planned).not.toContainText('Features')
    await expect(planned.getByRole('link')).toHaveCount(0)
    await expect(page.getByRole('heading', { name: 'Features', exact: true })).toBeVisible()
    await expect(page.locator('[data-action-id="pm.import"]')).toHaveCount(1)
    await expect(page.getByRole('button', { name: /create|edit|delete|restore|bind/i })).toHaveCount(0)

    await page.locator('[data-action-id="pm.import"]').click()
    await expect(page).toHaveURL(new RegExp(`/projects/${project.id}/import$`))
    await expect(page.getByRole('link', { name: 'Return to Project overview' })).toHaveAttribute('href', `/projects/${project.id}`)
  })

  test('renders explicit lifecycle, Domain mapping, Work and unavailable evidence states', async ({ page }) => {
    const project = await openProject(page)
    const known = featureRecord(project.id)
    const unknown = featureRecord(project.id, {
      id: '00000000-0000-4000-8000-000000000302',
      code: 'FEAT-IMPORTED-002',
      title: 'Imported Feature authority',
      lifecycle: 'ACTIVE',
      primaryDomain: { domainId: 'DOM-IMPORTED-E2E', label: 'Unknown domain', mappingState: 'UNMAPPED' },
      workLinks: [workLink({ id: '00000000-0000-4000-8000-000000000412' })],
    })
    await openFeatureRoute(page, project, [known, unknown])

    const view = page.getByTestId('project-feature-view')
    await expect(view.locator('[data-feature-id="00000000-0000-4000-8000-000000000301"]')).toContainText('Customer')
    await expect(view.locator('[data-feature-id="00000000-0000-4000-8000-000000000302"]')).toContainText('Unknown domain')
    await expect(view.locator('[data-feature-id="00000000-0000-4000-8000-000000000302"]')).toContainText('DOM-IMPORTED-E2E')
    await expect(view).toContainText('Snapshot unavailable')
    await expect(view).toContainText('Evidence: Unavailable')
    await expect(view).toContainText('Project work')
    await expect(view).not.toContainText('Workstream progress')
    await expect(view).not.toContainText('Product readiness')
    await expect(view.getByRole('button', { name: /create|edit|delete|restore|bind/i })).toHaveCount(0)

    await page.getByRole('combobox', { name: 'Lifecycle filter' }).selectOption('RETIRED')
    await expect(view).toHaveAttribute('data-view-state', 'filtered-empty')
    await expect(view).toContainText('No Features match this lifecycle')
    await view.getByRole('button', { name: 'Clear lifecycle filter' }).click()
    await expect(view).toHaveAttribute('data-view-state', 'ready')

    await page.unroute(`**/api/projects/${project.id}/feature-view`)
    await stubFeatureView(page, project.id, featureView(project.id))
    await page.reload()
    await expect(page.getByTestId('project-feature-view')).toHaveAttribute('data-view-state', 'empty')
    await expect(page.getByTestId('project-feature-view')).toContainText('No Features in this Project')
  })

  test('clears loading and refuses wrong Project or bounded/error responses without partial rows', async ({ page }) => {
    const project = await openProject(page)
    let releaseLoading
    const loadingGate = new Promise((resolve) => { releaseLoading = resolve })
    await stubFeatureView(page, project.id, async () => {
      await loadingGate
      return featureView(project.id, [featureRecord(project.id)])
    })
    await page.goto(`/projects/${project.id}/feature-view`, { waitUntil: 'domcontentloaded' })
    await expect(page.getByTestId('project-feature-view')).toHaveAttribute('data-view-state', 'loading')
    releaseLoading()
    await expect(page.getByTestId('project-feature-view')).toHaveAttribute('data-view-state', 'ready')

    await page.unroute(`**/api/projects/${project.id}/feature-view`)
    await stubFeatureView(page, project.id, featureView('00000000-0000-4000-8000-000000000247', [featureRecord('00000000-0000-4000-8000-000000000247', { code: 'FEAT-WRONG-PROJECT' })]))
    await page.reload()
    await expect(page.getByTestId('project-feature-view')).toHaveAttribute('data-view-state', 'request-failed')
    await expect(page.locator('[data-feature-id]')).toHaveCount(0)
    await expect(page.getByText('FEAT-WRONG-PROJECT', { exact: true })).toHaveCount(0)

    for (const [status, state, title] of [
      [401, 'forbidden', 'Authentication required'],
      [404, 'not-found', 'Project not found'],
      [413, 'bounded-unavailable', 'Feature view is too large'],
      [503, 'request-failed', 'Feature view unavailable'],
    ]) {
      await page.unroute(`**/api/projects/${project.id}/feature-view`)
      await stubFeatureView(page, project.id, { status, body: { code: `E2E_${status}`, message: 'Safe refusal.' } })
      await page.reload()
      const view = page.getByTestId('project-feature-view')
      await expect(view).toHaveAttribute('data-view-state', state)
      await expect(view.getByRole('alert').getByText(title, { exact: true })).toBeVisible()
      await expect(view.locator('[data-feature-id]')).toHaveCount(0)
    }
  })

  test('masks matching detail data while the aggregate Project view is loading and refused', async ({ page }) => {
    const project = await openProject(page)
    const sensitiveTitle = 'Confidential Feature detail must stay hidden'
    const sensitiveCode = 'FEAT-CONFIDENTIAL-999'
    const sensitiveCount = '987654'
    const sensitive = featureRecord(project.id, {
      id: '00000000-0000-4000-8000-000000000381',
      code: sensitiveCode,
      title: sensitiveTitle,
      workLinks: [],
    })
    sensitive.uniqueWorkCount = Number(sensitiveCount)
    const initialView = { ...featureView(project.id, [sensitive]), uniqueWorkCount: Number(sensitiveCount) }
    await stubFeatureView(page, project.id, initialView)
    let detailRequests = 0
    await stubFeatureDetail(page, project.id, sensitive.id, () => {
      detailRequests += 1
      return sensitive
    })
    await page.goto(`/projects/${project.id}/feature-view?featureId=${sensitive.id}`)
    const detailContent = page.getByTestId('feature-detail-content')
    await expect(detailContent).toContainText(sensitiveTitle)
    await expect(detailContent.getByText(sensitiveCode, { exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Open Feature ' + sensitiveCode, exact: true }).getByText(sensitiveCount, { exact: true })).toBeVisible()

    await page.unroute(`**/api/projects/${project.id}/feature-view`)
    for (const [status, state] of [[401, 'forbidden'], [403, 'forbidden'], [404, 'not-found']]) {
      let releaseAggregate
      let aggregateStarted = false
      const detailBaseline = detailRequests
      const aggregateGate = new Promise((resolve) => { releaseAggregate = resolve })
      await page.route(`**/api/projects/${project.id}/feature-view`, async (route) => {
        aggregateStarted = true
        await aggregateGate
        await route.fulfill({
          status,
          contentType: 'application/json',
          body: JSON.stringify({ code: `E2E_${status}`, message: 'Safe refusal.', requestId: `request-${status}`, retryable: false }),
        })
      })

      await page.reload({ waitUntil: 'domcontentloaded' })
      await expect.poll(() => aggregateStarted).toBe(true)
      await expect.poll(() => detailRequests).toBeGreaterThan(detailBaseline)
      const view = page.getByTestId('project-feature-view')
      await expect(view).toHaveAttribute('data-view-state', 'loading')
      const drawer = page.getByTestId('feature-detail-drawer')
      await expect(drawer).toBeVisible()
      await expect(drawer.locator('[data-detail-view-state="loading"]')).toBeVisible()
      await expect(page.getByText(sensitiveTitle, { exact: true })).toHaveCount(0)
      await expect(page.getByText(sensitiveCode, { exact: true })).toHaveCount(0)
      await expect(page.getByText(sensitiveCount, { exact: true })).toHaveCount(0)

      releaseAggregate()
      await expect(view).toHaveAttribute('data-view-state', state)
      await expect(page.getByText(sensitiveTitle, { exact: true })).toHaveCount(0)
      await expect(page.getByText(sensitiveCode, { exact: true })).toHaveCount(0)
      await expect(page.getByText(sensitiveCount, { exact: true })).toHaveCount(0)
      await expect(page.getByTestId('feature-detail-content')).toHaveCount(0)
      await page.unroute(`**/api/projects/${project.id}/feature-view`)
    }
  })

  test('keeps the detail drawer addressable, focus-safe and usable at 390px', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    const project = await openProject(page)
    const feature = featureRecord(project.id, {
      workLinks: [workLink({ id: '00000000-0000-4000-8000-000000000413' })],
    })
    await openFeatureRoute(page, project, [feature])
    await stubFeatureDetail(page, project.id, feature.id, feature)

    const row = page.getByRole('button', { name: 'Open Feature FEAT-LOCAL-001' })
    await row.click()
    await expect(page).toHaveURL(new RegExp(`/projects/${project.id}/feature-view\\?featureId=${feature.id}$`))
    await expect(page.getByRole('dialog', { name: 'Feature detail' })).toBeVisible()
    await expect(page.getByTestId('feature-detail-content')).toContainText('A bounded Project problem.')
    await expect(page.getByRole('button', { name: 'Close feature detail' })).toBeFocused()
    await expect(page.getByRole('dialog')).toContainText('Snapshot')
    await expect(page.getByRole('button', { name: /create|edit|delete|restore|bind/i })).toHaveCount(0)

    await page.keyboard.press('Escape')
    await expect(page).toHaveURL(new RegExp(`/projects/${project.id}/feature-view$`))
    await expect(page.getByTestId('feature-detail-drawer')).toHaveCount(0)
    await expect(row).toBeFocused()

    await row.click()
    await expect(page.getByRole('dialog', { name: 'Feature detail' })).toBeVisible()
    await page.goBack()
    await expect(page).toHaveURL(new RegExp(`/projects/${project.id}/feature-view$`))
    await expect(page.getByTestId('feature-detail-drawer')).toHaveCount(0)
    await expect(row).toBeFocused()

    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
    expect(overflow).toBeLessThanOrEqual(1)
    await expect(page.getByText('FEAT-LOCAL-001', { exact: true })).toBeVisible()
  })

  test('masks prior detail data while a delayed selected-Feature response is pending', async ({ page }) => {
    const project = await openProject(page)
    const first = featureRecord(project.id, {
      id: '00000000-0000-4000-8000-000000000371',
      code: 'FEAT-TRANSITION-A',
      title: 'Initial Feature detail',
      workLinks: [workLink({ id: '00000000-0000-4000-8000-000000000471' })],
    })
    const next = featureRecord(project.id, {
      id: '00000000-0000-4000-8000-000000000372',
      code: 'FEAT-TRANSITION-B',
      title: 'Next Feature detail',
      workLinks: [workLink({ id: '00000000-0000-4000-8000-000000000472' })],
    })
    await openFeatureRoute(page, project, [first, next])
    await stubFeatureDetail(page, project.id, first.id, first)
    let releaseNext
    const nextGate = new Promise((resolve) => { releaseNext = resolve })
    await stubFeatureDetail(page, project.id, next.id, async () => {
      await nextGate
      return next
    })

    await page.goto(`/projects/${project.id}/feature-view?featureId=${first.id}`)
    const drawer = page.getByTestId('feature-detail-drawer')
    await expect(page.getByTestId('feature-detail-content')).toContainText('Initial Feature detail')

    // Native history is the same URL state transition Next uses for a query
    // deep link; keeping the drawer mounted makes the old detail state visible
    // if render-time identity is not checked before the effect clears it.
    await page.evaluate(({ projectId, featureId }) => {
      window.history.pushState(null, '', `/projects/${projectId}/feature-view?featureId=${featureId}`)
    }, { projectId: project.id, featureId: next.id })
    await expect(page).toHaveURL(new RegExp(`/projects/${project.id}/feature-view\\?featureId=${next.id}$`))
    await expect(drawer.locator('[data-detail-view-state="loading"]')).toBeVisible()
    await expect(drawer).not.toContainText('FEAT-TRANSITION-A')
    await expect(drawer).not.toContainText('Initial Feature detail')

    releaseNext()
    await expect(page.getByTestId('feature-detail-content')).toContainText('Next Feature detail')
    await expect(drawer).not.toContainText('Initial Feature detail')
  })

  test('refuses a wrong Project detail response and closes a direct deep link without leaking it', async ({ page }) => {
    const project = await openProject(page)
    const feature = featureRecord(project.id)
    await openFeatureRoute(page, project, [feature])
    await stubFeatureDetail(page, project.id, feature.id, featureRecord('00000000-0000-4000-8000-000000000247', { code: 'FEAT-FOREIGN' }))

    await page.goto(`/projects/${project.id}/feature-view?featureId=${feature.id}`)
    const drawer = page.getByTestId('feature-detail-drawer')
    await expect(drawer).toBeVisible()
    await expect(drawer.locator('[data-detail-view-state="request-failed"]')).toBeVisible()
    await expect(drawer).not.toContainText('FEAT-FOREIGN')
    await expect(drawer).not.toContainText('00000000-0000-4000-8000-000000000247')
    await page.getByRole('button', { name: 'Close feature detail' }).click()
    await expect(page).toHaveURL(new RegExp(`/projects/${project.id}/feature-view$`))
    await expect(page.getByTestId('feature-detail-drawer')).toHaveCount(0)

    await page.unroute(`**/api/projects/${project.id}/features/${feature.id}`)
    const incomplete = { ...feature }
    delete incomplete.governanceSnapshotId
    await stubFeatureDetail(page, project.id, feature.id, incomplete)
    await page.goto(`/projects/${project.id}/feature-view?featureId=${feature.id}`)
    await expect(drawer.locator('[data-detail-view-state="request-failed"]')).toBeVisible()
    await expect(drawer).not.toContainText(feature.code)
  })
})
