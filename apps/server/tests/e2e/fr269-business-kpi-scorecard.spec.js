// @req FR-269 — Business KPI scorecard rendering and OWNER-only UI mutations.
// @spec SDD-033 — status is supplied by the strategy DTO; the page does not
// calculate KPI results or fold them into composite health.
const { test, expect } = require('@playwright/test')
const { loginAsOwner } = require('./e2e-auth')

const PERSPECTIVES = ['FINANCIAL', 'CUSTOMER', 'INTERNAL_PROCESS', 'LEARNING_GROWTH']

function emptyGroups() {
  return PERSPECTIVES.map((perspective) => ({ perspective, kpis: [] }))
}

function uniqueSuffix() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

async function mockKpiApi(page, initialGroups = emptyGroups()) {
  const groups = initialGroups.map((group) => ({ ...group, kpis: [...(group.kpis || [])] }))
  const kpisById = new Map(groups.flatMap((group) => group.kpis).map((kpi) => [kpi.id, kpi]))
  const writes = []

  await page.route('**/api/business/strategy?*', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        business: { id: 'business-e2e', code: 'BUS-E2E', name: 'Business 01' },
        roadmaps: [],
        goals: [],
        kpis: groups,
        activeRoadmapId: null,
        summary: { roadmapCount: 0, horizonCount: 0, goalCount: 0, averageProgress: 0 },
      }),
    })
  })

  // Use a regex so the same contract covers both the collection route and
  // nested /{id}/observations paths; Playwright globs here only caught the
  // collection request on Windows.
  await page.route(/\/api\/business\/kpis(?:\/|$)/, async (route) => {
    const request = route.request()
    const url = new URL(request.url())
    const method = request.method()
    const pathname = url.pathname
    if (method === 'GET') {
      await route.fulfill({ status: 404, json: { error: 'KPI reads use the strategy projection' } })
      return
    }

    const body = request.postDataJSON()
    writes.push({ method, pathname, body })

    if (method === 'POST' && pathname === '/api/business/kpis') {
      const kpi = { id: 'kpi-e2e-created', ...body, resultStatus: 'NO_SIGNAL', latestObservation: null }
      groups.find((group) => group.perspective === kpi.perspective)?.kpis.push(kpi)
      kpisById.set(kpi.id, kpi)
      await route.fulfill({ status: 201, json: { kpi } })
      return
    }

    const observationMatch = pathname.match(/^\/api\/business\/kpis\/([^/]+)\/observations$/)
    if (method === 'POST' && observationMatch) {
      const kpi = kpisById.get(decodeURIComponent(observationMatch[1]))
      if (!kpi) {
        await route.fulfill({ status: 404, json: { error: 'KPI not found' } })
        return
      }
      kpi.latestObservation = body
      kpi.resultStatus = 'OK'
      await route.fulfill({ status: 201, json: { observation: body } })
      return
    }

    const updateMatch = pathname.match(/^\/api\/business\/kpis\/([^/]+)$/)
    if (method === 'PATCH' && updateMatch) {
      const kpi = kpisById.get(decodeURIComponent(updateMatch[1]))
      if (!kpi) {
        await route.fulfill({ status: 404, json: { error: 'KPI not found' } })
        return
      }
      Object.assign(kpi, body)
      if (body.status === 'ARCHIVED') {
        for (const group of groups) group.kpis = group.kpis.filter((item) => item.id !== kpi.id)
      }
      await route.fulfill({ status: 200, json: { kpi } })
      return
    }

    await route.fulfill({ status: 405, json: { error: `Unexpected KPI request: ${method} ${pathname}` } })
  })

  return { groups, writes }
}

async function openBusinessHome(page) {
  await loginAsOwner(page)
  await page.getByRole('button', { name: /Open Business Business 01/i }).click()
  await expect(page).toHaveURL(/\/overview$/)
  await expect(page.getByTestId('business-kpi-scorecard')).toBeVisible()
}

test.describe('FR-269 Business KPI scorecard', () => {
  test('shows all four perspectives, honest NO_SIGNAL, and backend KPI attention rows', async ({ page }) => {
    await mockKpiApi(page, [
      {
        perspective: 'FINANCIAL',
        kpis: [{
          id: 'kpi-no-signal',
          name: 'Monthly recurring revenue e2e',
          unit: 'USD',
          target: 1000,
          warningThreshold: 800,
          direction: 'UP',
          cadence: 'MONTHLY',
          resultStatus: 'NO_SIGNAL',
          latestObservation: null,
        }],
      },
      {
        perspective: 'CUSTOMER',
        kpis: [{
          id: 'kpi-attention',
          name: 'Customer churn e2e',
          unit: '%',
          target: 2,
          warningThreshold: 3,
          direction: 'DOWN',
          cadence: 'MONTHLY',
          resultStatus: 'BAD',
          latestObservation: { value: 5, observedAt: '2026-10-12T03:00:00.000Z' },
        }],
      },
      { perspective: 'INTERNAL_PROCESS', kpis: [] },
      { perspective: 'LEARNING_GROWTH', kpis: [] },
    ])
    await openBusinessHome(page)

    for (const label of ['Financial', 'Customer', 'Internal Process', 'Learning & Growth']) {
      await expect(page.getByRole('heading', { name: label, exact: true })).toBeVisible()
    }
    await expect(page.locator('[data-testid="business-kpi-scorecard"] section[aria-labelledby^="business-kpi-group-"]')).toHaveCount(4)

    const noSignalRow = page.getByTestId('business-kpi-kpi-no-signal')
    await expect(noSignalRow.getByText('NO SIGNAL', { exact: true })).toBeVisible()
    await expect(noSignalRow.getByText('No observation yet')).toBeVisible()
    await expect(noSignalRow.getByText('—', { exact: true })).toBeVisible()

    const attentionQueue = page.getByTestId('business-attention-queue')
    await expect(attentionQueue.getByText('Customer churn e2e')).toBeVisible()
    const kpiAttention = attentionQueue.getByRole('link', { name: /KPI off track/ })
    await expect(kpiAttention.getByText('HIGH', { exact: true })).toBeVisible()
  })

  test('OWNER creates, updates, observes, then archives a KPI through the API', async ({ page }) => {
    const { writes } = await mockKpiApi(page)
    await openBusinessHome(page)
    const name = `Revenue e2e ${uniqueSuffix()}`

    await page.getByRole('button', { name: 'Add KPI' }).click()
    const createDialog = page.getByRole('dialog', { name: 'Create Business KPI' })
    await createDialog.getByLabel('KPI name').fill(name)
    await createDialog.getByLabel('Perspective').selectOption('FINANCIAL')
    await createDialog.getByLabel('Unit').fill('USD')
    await createDialog.getByLabel('Target', { exact: true }).fill('100')
    await createDialog.getByLabel('Warning threshold', { exact: true }).fill('80')
    await createDialog.getByLabel('Direction').selectOption('UP')
    await createDialog.getByLabel('Cadence').selectOption('MONTHLY')
    await createDialog.getByRole('button', { name: 'Save KPI' }).click()

    const row = page.getByTestId('business-kpi-kpi-e2e-created')
    await expect(row).toBeVisible()
    await expect(row.getByText('NO SIGNAL', { exact: true })).toBeVisible()

    await row.getByRole('button', { name: 'Record observation for ' + name }).click()
    const observationDialog = page.getByRole('dialog', { name: `Record observation · ${name}` })
    await observationDialog.getByLabel(/Observed value/).fill('95')
    await observationDialog.getByRole('button', { name: 'Record observation' }).click()
    await expect(row.getByText('95 USD')).toBeVisible()
    await expect(row.getByText('OK', { exact: true })).toBeVisible()
    expect(writes[1].body).toEqual({ value: 95 })

    await row.getByRole('button', { name: `Edit ${name}` }).click()
    const editDialog = page.getByRole('dialog', { name: `Edit KPI · ${name}` })
    const nameInput = editDialog.getByLabel('KPI name')
    const targetInput = editDialog.getByLabel('Target', { exact: true })
    await targetInput.fill('120')
    await expect(targetInput).toHaveValue('120')
    await expect(nameInput).toHaveValue(name)
    await editDialog.getByRole('button', { name: 'Save KPI' }).click()
    await expect(row.getByText('120 USD')).toBeVisible()
    expect(writes.at(-1).body).toMatchObject({ name, target: 120 })

    page.once('dialog', (dialog) => dialog.accept())
    await row.getByRole('button', { name: `Archive ${name}` }).click()
    await expect(row).toHaveCount(0)

    expect(writes.map(({ method, pathname }) => [method, pathname])).toEqual([
      ['POST', '/api/business/kpis'],
      ['POST', '/api/business/kpis/kpi-e2e-created/observations'],
      ['PATCH', '/api/business/kpis/kpi-e2e-created'],
      ['PATCH', '/api/business/kpis/kpi-e2e-created'],
    ])
    expect(writes[3].body).toEqual({ status: 'ARCHIVED' })
  })
})
