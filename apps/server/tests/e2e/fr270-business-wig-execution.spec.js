// @req FR-270 — OWNER can operate WIG setup, weekly measures, commitments and
// the report/scoreboard/plan session from Business Overview.
// @spec ADR-101 D1/D5/D6, BR-001, BR-043
const { test, expect } = require('@playwright/test')
const { loginAsOwner } = require('./e2e-auth')

const CURRENT_WEEK = '2026-10-11T17:00:00.000Z'
const NEXT_WEEK = '2026-10-18T17:00:00.000Z'

async function mockWigApi(page) {
  const writes = []
  const state = { businessId: null, writes, strategy: null }
  await page.route('**/api/business/strategy?*', async (route) => {
    state.businessId = new URL(route.request().url()).searchParams.get('businessId')
    state.strategy ||= {
      business: { id: state.businessId, code: 'BUS-E2E', name: 'Business 01' },
      roadmaps: [],
      goals: [{
        id: 'goal-e2e', code: 'G1', title: 'Grow retention', status: 'ACTIVE', isWig: true,
        progress: 20, projects: [],
        keyResults: [{ id: 'kr-e2e', code: 'KR1', title: 'Renew 20 accounts', unit: 'accounts', isLagMeasure: true, status: 'ACTIVE' }],
      }],
      kpis: [],
      wigExecution: {
        currentWeekStartAt: CURRENT_WEEK,
        nextWeekStartAt: NEXT_WEEK,
        weeks: [
          '2026-09-14T17:00:00.000Z', '2026-09-21T17:00:00.000Z', '2026-09-28T17:00:00.000Z',
          '2026-10-05T17:00:00.000Z', CURRENT_WEEK,
        ],
        wigs: [{
          goalId: 'goal-e2e', code: 'G1', title: 'Grow retention', status: 'ACTIVE',
          lagKeyResult: { id: 'kr-e2e', code: 'KR1', title: 'Renew 20 accounts', isLagMeasure: true },
          configurationError: null,
          leadMeasures: [{
            id: 'measure-e2e', goalId: 'goal-e2e', name: 'Buyer calls', unit: 'calls',
            weeklyTarget: 10, direction: 'UP', status: 'ACTIVE',
            weeklyBars: [
              { weekStartAt: '2026-09-14T17:00:00.000Z', value: null },
              { weekStartAt: '2026-09-21T17:00:00.000Z', value: 4 },
              { weekStartAt: '2026-09-28T17:00:00.000Z', value: 7 },
              { weekStartAt: '2026-10-05T17:00:00.000Z', value: null },
              { weekStartAt: CURRENT_WEEK, value: null },
            ],
          }],
        }],
        commitmentPeople: [{ id: 'person-e2e', code: 'PER-E2E', displayName: 'Avery Member' }],
        commitments: {
          current: [{
            id: 'commitment-e2e', weekStartAt: CURRENT_WEEK, ownerPersonId: 'person-e2e',
            owner: { id: 'person-e2e', code: 'PER-E2E', displayName: 'Avery Member' },
            leadMeasure: { id: 'measure-e2e', name: 'Buyer calls', goalId: 'goal-e2e' },
            title: 'Complete buyer interviews', done: false,
          }],
          next: [],
        },
        currentSession: {
          id: null, weekStartAt: CURRENT_WEEK, reportCompletedAt: null,
          scoreboardCompletedAt: null, planCompletedAt: null, complete: false,
        },
        overdueSessions: [],
      },
      activeRoadmapId: null,
      summary: { roadmapCount: 0, horizonCount: 0, goalCount: 1, averageProgress: 20 },
    }
    await route.fulfill({ status: 200, json: state.strategy })
  })

  await page.route(/\/api\/business\/(?:goals\/[^/]+\/(?:wig|lead-measures)|lead-measures\/[^/]+(?:\/values)?|weekly-commitments(?:\/[^/]+)?|wig-sessions\/steps)$/, async (route) => {
    const request = route.request()
    const pathname = new URL(request.url()).pathname
    const body = request.postDataJSON()
    writes.push({ method: request.method(), pathname, body })

    // Model persistence so the next strategy read after onSaved() reflects
    // each successful operation just like the real API.
    const execution = state.strategy?.wigExecution
    if (execution && request.method() === 'POST' && pathname.endsWith('/values')) {
      const measureId = pathname.split('/')[4]
      const measure = execution.wigs.flatMap((wig) => wig.leadMeasures).find((row) => row.id === measureId)
      const bar = measure?.weeklyBars.find((row) => row.weekStartAt === body.weekStartAt)
      if (bar) bar.value = body.value
    }
    if (execution && request.method() === 'PATCH' && pathname.startsWith('/api/business/weekly-commitments/')) {
      const commitmentId = pathname.split('/').at(-1)
      for (const rows of Object.values(execution.commitments)) {
        const row = rows.find((item) => item.id === commitmentId)
        if (row) row.done = body.done
      }
    }
    if (execution && request.method() === 'POST' && pathname === '/api/business/weekly-commitments') {
      const week = body.weekStartAt === execution.nextWeekStartAt ? 'next' : 'current'
      const person = execution.commitmentPeople.find((row) => row.id === body.ownerPersonId)
      const measure = execution.wigs.flatMap((wig) => wig.leadMeasures).find((row) => row.id === body.leadMeasureId)
      execution.commitments[week].push({
        id: 'commitment-created', weekStartAt: body.weekStartAt, ownerPersonId: body.ownerPersonId,
        owner: person, leadMeasure: measure && { id: measure.id, name: measure.name, goalId: measure.goalId },
        title: body.title, done: false,
      })
    }
    if (execution && request.method() === 'PUT' && pathname === '/api/business/wig-sessions/steps') {
      const field = `${body.step}CompletedAt`
      execution.currentSession[field] = body.completed ? '2026-10-12T00:00:00.000Z' : null
      execution.currentSession.complete = ['report', 'scoreboard', 'plan']
        .every((step) => Boolean(execution.currentSession[`${step}CompletedAt`]))
    }
    await route.fulfill({ status: 200, json: { ok: true } })
  })
  return state
}

async function openBusinessOverview(page) {
  await loginAsOwner(page)
  await page.getByRole('button', { name: /Open Business Business 01/i }).click()
  await expect(page).toHaveURL(/\/overview$/)
  await expect(page.getByTestId('business-wig-execution')).toBeVisible()
}

test.describe('FR-270 Business WIG execution', () => {
  test('records lead measure corrections, current/next commitments and explicit session steps from Overview', async ({ page }) => {
    const state = await mockWigApi(page)
    const { writes } = state
    await openBusinessOverview(page)

    await expect(page.getByText('Buyer calls', { exact: true })).toBeVisible()
    await expect(page.getByText('Complete buyer interviews')).toBeVisible()
    await page.getByLabel("This week's Buyer calls value").fill('12')
    await page.getByRole('button', { name: 'Record correction' }).click()
    await expect(page.getByText('12 calls', { exact: true })).toBeVisible()

    // The checkbox is disabled while the async save refreshes the strategy.
    // Click like a user, then wait for the server-backed checked state.
    await page.getByLabel('Commitment completed: Complete buyer interviews').click()
    await expect(page.getByLabel('Commitment completed: Complete buyer interviews')).toBeChecked()
    const commitmentForm = page.getByTestId('business-weekly-commitment-form')
    await commitmentForm.getByLabel('Person').selectOption('person-e2e')
    await commitmentForm.getByRole('combobox').nth(1).selectOption('next')
    await commitmentForm.getByLabel('Lead measure (optional)').selectOption('measure-e2e')
    await commitmentForm.getByLabel('Commitment').fill('Complete ten buyer interviews')
    await commitmentForm.getByRole('button', { name: 'Add', exact: true }).click()
    await expect(page.getByText('Complete ten buyer interviews')).toBeVisible()

    await page.getByLabel('Report on last week').click()
    await expect(page.getByLabel('Report on last week')).toBeChecked()
    await page.getByLabel('Update the scoreboard').click()
    await expect(page.getByLabel('Update the scoreboard')).toBeChecked()
    await page.getByLabel('Plan this week').click()
    await expect(page.getByLabel('Plan this week')).toBeChecked()

    expect(writes).toEqual([
      { method: 'POST', pathname: '/api/business/lead-measures/measure-e2e/values', body: { weekStartAt: CURRENT_WEEK, value: 12 } },
      { method: 'PATCH', pathname: '/api/business/weekly-commitments/commitment-e2e', body: { done: true } },
      { method: 'POST', pathname: '/api/business/weekly-commitments', body: {
        businessId: state.businessId, weekStartAt: NEXT_WEEK, ownerPersonId: 'person-e2e',
        leadMeasureId: 'measure-e2e', title: 'Complete ten buyer interviews',
      } },
      { method: 'PUT', pathname: '/api/business/wig-sessions/steps', body: { businessId: state.businessId, weekStartAt: CURRENT_WEEK, step: 'report', completed: true } },
      { method: 'PUT', pathname: '/api/business/wig-sessions/steps', body: { businessId: state.businessId, weekStartAt: CURRENT_WEEK, step: 'scoreboard', completed: true } },
      { method: 'PUT', pathname: '/api/business/wig-sessions/steps', body: { businessId: state.businessId, weekStartAt: CURRENT_WEEK, step: 'plan', completed: true } },
    ])
  })
})
