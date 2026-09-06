// @req FR-153, FR-154 — browser smoke for URL state, plan CRUD controls, and
// the reviewed revision handoff surface once the Marketing API is enabled.
// @spec SDD-086
// @tested tests/e2e/marketing-strategy.spec.js

const { test, expect } = require('@playwright/test')
const { loginAsOwner } = require('./e2e-auth')

const PLAN_PAYLOAD = {
  objective: 'Increase qualified enquiries',
  situation: 'The offer page is under-reached',
  audience: 'Thai SME owners',
  channels: ['META_ADS'],
  budget: 12000,
  currency: 'THB',
  successMetric: 'Qualified enquiries observed in PM KPI records',
  actions: [{ title: 'Publish campaign landing page' }],
}

async function scopeFor(page) {
  const response = await page.request.get('/api/scope')
  expect(response.ok()).toBeTruthy()
  return response.json()
}

async function createPlanViaApi(page, businessId, title) {
  const response = await page.request.post('/api/growth/plans', { data: { businessId, title, payload: PLAN_PAYLOAD } })
  expect(response.ok()).toBeTruthy()
  const body = await response.json()
  const plan = body.plan || body
  expect(plan.id).toBeTruthy()
  return plan
}

async function selectBusiness(page) {
  await loginAsOwner(page)
  await page.goto('/businesses')
  const business = page.getByRole('button', { name: /Open Business Business 01/i }).first()
  await expect(business).toBeVisible()
  await business.click()
  await page.goto('/growth/strategy?tab=plans')
  const scope = await scopeFor(page)
  const selected = scope.businesses.find((item) => item.name === 'Business 01') || scope.businesses[0]
  const workspace = scope.workspaces.find((item) => item.businessId === selected.id)
  expect(selected?.id).toBeTruthy()
  expect(workspace?.id).toBeTruthy()
  return { business: selected, workspace }
}

async function loginAs(page, email, password) {
  await page.goto('/login')
  await page.getByLabel('Email or account code').fill(email)
  await page.getByLabel('Password', { exact: true }).fill(password)
  await page.getByRole('button', { name: 'Sign in', exact: true }).click()
}

async function selectBusinessForSignedInUser(page) {
  await page.goto('/businesses')
  const business = page.getByRole('button', { name: /Open Business Business 01/i }).first()
  await expect(business).toBeVisible()
  await business.click()
}

test.describe('Marketing Strategy first functional slice', () => {
  test('keeps Strategy sections addressable and presents explicit unavailable provider metrics', async ({ page }) => {
    await selectBusiness(page)
    await expect(page).toHaveURL(/\/growth\/strategy\?tab=plans/)
    await expect(page.getByRole('tablist', { name: 'Marketing strategy sections' })).toBeVisible()
    await expect(page.getByRole('tab', { name: 'Situation' })).toBeVisible()
    await expect(page.getByRole('tab', { name: 'Objectives' })).toBeVisible()
    await expect(page.getByRole('tab', { name: 'Scenarios' })).toBeVisible()
    await page.getByRole('tab', { name: 'Situation' }).click()
    await expect(page).toHaveURL(/tab=situation/)
    await page.goto('/growth')
    await expect(page.getByText(/Provider metrics are unavailable/i)).toBeVisible()
  })

  test('creates a plan through the native form when the real API is enabled', async ({ page }) => {
    await selectBusiness(page)
    await page.getByRole('link', { name: /New plan/i }).click()
    await expect(page).toHaveURL(/tab=plans&new=1/)
    await page.getByLabel('Plan title').fill(`Browser Marketing plan ${Date.now()}`)
    await page.getByLabel('Objective').fill('Increase qualified enquiries')
    await page.getByLabel('Situation').fill('The offer page is under-reached')
    await page.getByLabel('Audience').fill('Thai SME owners')
    await page.getByLabel('Success metric intent').fill('Qualified enquiries observed in PM KPI records')
    await page.getByLabel('Meta Ads').check()
    await page.getByLabel('Budget').fill('12000')
    await page.getByLabel('Currency').fill('THB')
    await page.getByLabel('Action 1').fill('Publish campaign landing page')
    await page.getByRole('button', { name: 'Create plan' }).click()
    await expect(page).toHaveURL(/\/growth\/strategy\?tab=plans&plan=/)
    await expect(page.getByTestId('marketing-plan-versions')).toBeVisible()
    await expect(page.getByText(/Independent review requires another real user/i)).toBeVisible()
    await page.getByLabel('Plan title').fill(`Revised browser Marketing plan ${Date.now()}`)
    await page.getByRole('button', { name: 'Save revision' }).click()
    await expect(page.getByText(/Revision 2/i)).toBeVisible()
    await expect(page.getByTestId('marketing-plan-handoff')).toBeVisible()
    await expect(page.getByText(/KPI progress needs PM metric targets and observations/i)).toBeVisible()
  })

  test('keeps a selected plan addressable after reload and exposes PM KPI guardrail', async ({ page }) => {
    const { business } = await selectBusiness(page)
    const plan = await createPlanViaApi(page, business.id, `Reload Marketing plan ${Date.now()}`)
    const secondPlan = await createPlanViaApi(page, business.id, `Second Marketing plan ${Date.now()}`)
    await page.goto(`/growth/strategy?tab=plans&plan=${plan.id}`)
    await expect(page.getByTestId('marketing-plan-versions')).toBeVisible()
    await expect(page.getByLabel('Plan title')).toHaveValue(plan.title)
    await page.goto(`/growth/strategy?tab=plans&plan=${secondPlan.id}`)
    await expect(page.getByLabel('Plan title')).toHaveValue(secondPlan.title)
    await page.reload()
    await expect(page).toHaveURL(new RegExp(`tab=plans&plan=${secondPlan.id}`))
    await expect(page.getByText(/KPI progress needs PM metric targets and observations/i)).toBeVisible()
    await page.getByRole('link', { name: /Back to plans/i }).click()
    await expect(page).toHaveURL(/\/growth\/strategy\?tab=plans$/)
    await expect(page.getByTestId('marketing-plan-list')).toContainText(secondPlan.title)
  })

  test('runs create, independent review, approval, PM preview, and commit with persisted evidence', async ({ page, browser }, testInfo) => {
    const { business, workspace } = await selectBusiness(page)
    const plan = await createPlanViaApi(page, business.id, `Fullflow Marketing plan ${Date.now()}`)
    await page.goto(`/growth/strategy?tab=plans&plan=${plan.id}`)

    const secondaryEmail = `marketing-reviewer-${testInfo.workerIndex}-${testInfo.retry}-${Date.now()}@example.com`
    const secondaryPassword = 'e2e-marketing-Passw0rd'
    const origin = new URL(page.url()).origin
    const secondaryContext = await browser.newContext({ baseURL: origin })
    try {
      const signup = await secondaryContext.request.post('/api/auth/signup', { data: { displayName: 'Marketing reviewer', email: secondaryEmail, password: secondaryPassword } })
      expect(signup.status()).toBe(201)
      const membershipResponse = await page.request.post('/api/platform/users/memberships', { data: { businessId: business.id, identifier: secondaryEmail, domainKeys: ['growth'] } })
      expect(membershipResponse.status()).toBe(200)
      const membership = await membershipResponse.json()
      const promote = await page.request.patch('/api/platform/users', { data: { membershipId: membership.id, role: 'OWNER', domainKeys: ['growth'] } })
      expect(promote.status()).toBe(200)

      const secondaryPage = await secondaryContext.newPage()
      await loginAs(secondaryPage, secondaryEmail, secondaryPassword)
      await selectBusinessForSignedInUser(secondaryPage)
      await secondaryPage.goto(`/growth/strategy?tab=plans&plan=${plan.id}`)
      const reviewForm = secondaryPage.getByTestId('marketing-independent-review')
      await reviewForm.getByLabel('Rationale').fill('Independent reviewer confirms the saved intent and scope.')
      const reviewPatch = secondaryPage.waitForResponse((response) => response.url().includes(`/api/growth/plans/${plan.id}`) && response.request().method() === 'PATCH')
      await reviewForm.getByRole('button', { name: 'Record review' }).click()
      expect((await reviewPatch).ok()).toBeTruthy()
      const reviewedPlanResponse = await secondaryPage.request.get(`/api/growth/plans/${plan.id}?businessId=${business.id}`)
      expect(reviewedPlanResponse.ok()).toBeTruthy()
      const reviewedPlan = await reviewedPlanResponse.json()
      expect(reviewedPlan.reviews || reviewedPlan.plan?.reviews || []).toEqual(expect.arrayContaining([expect.objectContaining({ verdict: 'PASS' })]))

      await page.reload()
      const decisionForm = page.getByTestId('marketing-human-decision')
      await decisionForm.getByLabel('Decision').selectOption('APPROVE')
      await decisionForm.getByLabel('Rationale').fill('Approved for this Business and revision.')
      await decisionForm.getByLabel('Approval expires').fill('2030-01-01T00:00')
      const decisionPatch = page.waitForResponse((response) => response.url().includes(`/api/growth/plans/${plan.id}`) && response.request().method() === 'PATCH')
      await decisionForm.getByRole('button', { name: 'Record decision' }).click()
      expect((await decisionPatch).ok()).toBeTruthy()
      const decidedPlanResponse = await page.request.get(`/api/growth/plans/${plan.id}?businessId=${business.id}`)
      expect(decidedPlanResponse.ok()).toBeTruthy()
      const decidedPlan = await decidedPlanResponse.json()
      expect(decidedPlan.decisions || decidedPlan.plan?.decisions || []).toEqual(expect.arrayContaining([expect.objectContaining({ verdict: 'APPROVE' })]))

      await page.reload()
      await page.getByLabel('Target Workspace').selectOption(workspace.id)
      const previewPost = page.waitForResponse((response) => response.url().includes(`/api/growth/plans/${plan.id}/handoff`) && response.request().method() === 'POST')
      await page.getByRole('button', { name: 'Preview PM handoff' }).click()
      expect((await previewPost).ok()).toBeTruthy()
      await expect(page.getByTestId('marketing-handoff-preview')).toBeVisible()
      await expect(page.getByText('Inserts')).toBeVisible()
      await expect(page.getByRole('button', { name: 'Commit verified handoff' })).toBeEnabled()
      const commitPost = page.waitForResponse((response) => response.url().includes(`/api/growth/plans/${plan.id}/handoff`) && response.request().method() === 'POST')
      await page.getByRole('button', { name: 'Commit verified handoff' }).click()
      expect((await commitPost).ok()).toBeTruthy()
      const receipt = page.getByTestId('marketing-handoff-receipt')
      await expect(receipt).toBeVisible()
      await expect(receipt.getByRole('link', { name: 'Open PM Project' })).toBeVisible()

      const detailResponse = await page.request.get(`/api/growth/plans/${plan.id}?businessId=${business.id}`)
      expect(detailResponse.ok()).toBeTruthy()
      const detail = await detailResponse.json()
      expect(detail.handoffs || detail.plan?.handoffs || []).not.toHaveLength(0)
    } finally {
      await secondaryContext.close()
    }
  })
})
