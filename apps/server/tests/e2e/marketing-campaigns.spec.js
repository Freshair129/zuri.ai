// @req FR-160 — browser coverage for the native Campaign create flow,
// receipt-bound PM projection and persisted lifecycle controls.
// @spec SDD-087
// @tested tests/e2e/marketing-campaigns.spec.js

const { test, expect } = require('@playwright/test')
const { loginAsOwner } = require('./e2e-auth')

const CAMPAIGN_BRIEF = {
  startDate: '2026-09-10',
  endDate: '2026-09-30',
  offer: 'Corporate gifting consultation',
  conditions: 'Business customers only',
}

const PLAN_FIELDS = {
  objective: 'Increase qualified enquiries',
  situation: 'The offer page is under-reached',
  audience: 'Thai SME owners',
  successMetric: 'Qualified enquiries observed in PM KPI records',
  actions: [{ title: 'Publish campaign landing page' }],
}

function unwrapCampaign(value) {
  return value?.campaign || value?.initiative || value
}

function unwrapPlan(value) {
  return value?.plan || value
}

async function scopeFor(page) {
  const response = await page.request.get('/api/scope')
  expect(response.ok()).toBeTruthy()
  return response.json()
}

async function selectBusiness(page) {
  await loginAsOwner(page)
  await expect(page).toHaveURL(/\/businesses/, { timeout: 15000 })
  await page.goto('/businesses')
  const businessButton = page.getByRole('button', { name: /Open Business Business 01/i }).first()
  await expect(businessButton).toBeVisible()
  await businessButton.click()
  await page.goto('/growth/campaigns')
  const scope = await scopeFor(page)
  const business = scope.businesses.find((item) => item.name === 'Business 01') || scope.businesses[0]
  const workspace = scope.workspaces.find((item) => item.businessId === business.id)
  expect(business?.id).toBeTruthy()
  expect(workspace?.id).toBeTruthy()
  return { business, workspace }
}

async function loginAs(page, email, password) {
  await page.goto('/login')
  await page.getByLabel('Email or account code').fill(email)
  await page.getByLabel('Password', { exact: true }).fill(password)
  await page.getByRole('button', { name: 'Sign in', exact: true }).click()
  await expect(page).toHaveURL(/\/businesses/, { timeout: 15000 })
}

async function selectBusinessForSignedInUser(page) {
  await page.goto('/businesses')
  const businessButton = page.getByRole('button', { name: /Open Business Business 01/i }).first()
  await expect(businessButton).toBeVisible()
  await businessButton.click()
}

async function createCampaignViaUi(page, title) {
  await page.goto('/growth/campaigns/new')
  await expect(page.getByLabel('Campaign name', { exact: true })).toBeVisible()
  await page.getByLabel('Campaign name', { exact: true }).fill(title)
  await page.getByLabel('Objective', { exact: true }).fill(PLAN_FIELDS.objective)
  await page.getByLabel('Situation', { exact: true }).fill(PLAN_FIELDS.situation)
  await page.getByLabel('Audience', { exact: true }).fill(PLAN_FIELDS.audience)
  await page.getByLabel('Success metric intent').fill(PLAN_FIELDS.successMetric)
  await page.getByLabel('Meta Ads', { exact: true }).check()
  await page.getByLabel('Budget').fill('12000')
  await page.getByLabel('Currency').fill('THB')
  await page.getByLabel('Start date', { exact: true }).fill(CAMPAIGN_BRIEF.startDate)
  await page.getByLabel('End date', { exact: true }).fill(CAMPAIGN_BRIEF.endDate)
  await page.getByLabel('Offer', { exact: true }).fill(CAMPAIGN_BRIEF.offer)
  await page.getByLabel('Conditions', { exact: true }).fill(CAMPAIGN_BRIEF.conditions)
  await page.getByLabel('Action 1', { exact: true }).fill(PLAN_FIELDS.actions[0].title)
  const createPost = page.waitForResponse((response) => response.url().endsWith('/api/growth/campaigns') && response.request().method() === 'POST')
  await page.getByRole('button', { name: 'Save campaign', exact: true }).click()
  expect((await createPost).ok()).toBeTruthy()
  await expect(page).toHaveURL(/\/growth\/campaigns\/[^?]+\?tab=brief/)
  await expect(page.getByTestId('marketing-campaign-brief')).toContainText(CAMPAIGN_BRIEF.offer)
}

async function getCampaign(page, businessId, initiativeId) {
  const response = await page.request.get(`/api/growth/campaigns/${initiativeId}?businessId=${businessId}`)
  expect(response.ok()).toBeTruthy()
  return unwrapCampaign(await response.json())
}

async function getPlan(page, businessId, planId) {
  const response = await page.request.get(`/api/growth/plans/${planId}?businessId=${businessId}`)
  expect(response.ok()).toBeTruthy()
  return unwrapPlan(await response.json())
}

test.describe('Marketing Campaign first functional slice', () => {
  test('creates a Campaign, keeps all detail tabs addressable, and survives reload/back', async ({ page }) => {
    const { business } = await selectBusiness(page)
    const title = `Browser Campaign ${Date.now()}`
    await createCampaignViaUi(page, title)

    for (const tab of ['plan', 'timeline', 'results', 'decisions']) {
      await page.getByRole('tab', { name: tab[0].toUpperCase() + tab.slice(1), exact: true }).click()
      await expect(page).toHaveURL(new RegExp(`tab=${tab}`))
      if (tab === 'results') await expect(page.getByText(/Campaign results are unavailable/i)).toBeVisible()
    }
    await page.reload()
    await expect(page).toHaveURL(/tab=decisions/)
    await expect(page.getByTestId('marketing-campaign-decisions')).toBeVisible()
    await page.getByRole('link', { name: 'Back to campaigns', exact: true }).click()
    await expect(page).toHaveURL(/\/growth\/campaigns$/)
    await expect(page.getByTestId('marketing-campaign-list')).toContainText(title)
    const listCampaignLink = page.getByTestId('marketing-campaign-list').getByRole('link').first()
    await expect(listCampaignLink).toHaveAttribute('href', /\/growth\/campaigns\/[^?]+\?tab=brief$/)
    await listCampaignLink.click()
    await expect(page).toHaveURL(/\/growth\/campaigns\/[^?]+\?tab=brief$/)
    await expect(page.getByTestId('marketing-campaign-brief')).toBeVisible()
    await page.getByRole('link', { name: 'Back to campaigns', exact: true }).click()
    await page.getByRole('button', { name: 'Board', exact: true }).click()
    const boardCampaignLink = page.getByTestId('marketing-campaign-board').getByRole('link').first()
    await expect(boardCampaignLink).toHaveAttribute('href', /\/growth\/campaigns\/[^?]+\?tab=brief$/)
    await boardCampaignLink.click()
    await expect(page).toHaveURL(/\/growth\/campaigns\/[^?]+\?tab=brief$/)
    await expect(page.getByTestId('marketing-campaign-brief')).toBeVisible()
    await page.getByRole('link', { name: 'Back to campaigns', exact: true }).click()

    const scope = await scopeFor(page)
    expect(scope.businesses.some((item) => item.id === business.id)).toBe(true)
  })

  test('binds an approved PM receipt, reads real Plan and Timeline data, then persists closure', async ({ page, browser }, testInfo) => {
    const { business, workspace } = await selectBusiness(page)
    const title = `Receipt Campaign ${Date.now()}`
    await createCampaignViaUi(page, title)
    const initiativeId = new URL(page.url()).pathname.split('/').pop()
    const created = await getCampaign(page, business.id, initiativeId)
    const planId = created.planId || created.plan?.id
    expect(planId).toBeTruthy()

    const secondaryEmail = `campaign-reviewer-${testInfo.workerIndex}-${testInfo.retry}-${Date.now()}@example.com`
    const secondaryPassword = 'e2e-campaign-Passw0rd'
    const origin = new URL(page.url()).origin
    const secondaryContext = await browser.newContext({ baseURL: origin })
    try {
      const signup = await secondaryContext.request.post('/api/auth/signup', { data: { displayName: 'Campaign reviewer', email: secondaryEmail, password: secondaryPassword } })
      expect(signup.status()).toBe(201)
      const membershipResponse = await page.request.post('/api/platform/users/memberships', { data: { businessId: business.id, identifier: secondaryEmail, domainKeys: ['growth'] } })
      expect(membershipResponse.status()).toBe(200)
      const membership = await membershipResponse.json()
      const promote = await page.request.patch('/api/platform/users', { data: { membershipId: membership.id, role: 'OWNER', domainKeys: ['growth'] } })
      expect(promote.status()).toBe(200)

      const secondaryPage = await secondaryContext.newPage()
      await loginAs(secondaryPage, secondaryEmail, secondaryPassword)
      await selectBusinessForSignedInUser(secondaryPage)
      await secondaryPage.goto(`/growth/strategy?tab=plans&plan=${planId}`)
      const reviewForm = secondaryPage.getByTestId('marketing-independent-review')
      await reviewForm.getByLabel('Rationale', { exact: true }).fill('Independent reviewer confirms the saved campaign brief and scope.')
      const reviewPatch = secondaryPage.waitForResponse((response) => response.url().includes(`/api/growth/plans/${planId}`) && response.request().method() === 'PATCH')
      await reviewForm.getByRole('button', { name: 'Record review', exact: true }).click()
      expect((await reviewPatch).ok()).toBeTruthy()

      await page.goto(`/growth/strategy?tab=plans&plan=${planId}`)
      const decisionForm = page.getByTestId('marketing-human-decision')
      await expect(decisionForm).toBeVisible()
      await decisionForm.getByLabel('Decision').selectOption('APPROVE')
      await decisionForm.getByLabel('Rationale', { exact: true }).fill('Approved for this campaign and immutable revision.')
      await decisionForm.getByLabel('Approval expires').fill('2030-01-01T00:00')
      const decisionPatch = page.waitForResponse((response) => response.url().includes(`/api/growth/plans/${planId}`) && response.request().method() === 'PATCH')
      await decisionForm.getByRole('button', { name: 'Record decision', exact: true }).click()
      expect((await decisionPatch).ok()).toBeTruthy()

      await page.reload()
      await page.getByLabel('Target Workspace').selectOption(workspace.id)
      const previewPost = page.waitForResponse((response) => response.url().includes(`/api/growth/plans/${planId}/handoff`) && response.request().method() === 'POST')
      await page.getByRole('button', { name: 'Preview PM handoff', exact: true }).click()
      expect((await previewPost).ok()).toBeTruthy()
      await expect(page.getByTestId('marketing-handoff-inserts').getByRole('listitem')).toHaveCount(4)
      const commitPost = page.waitForResponse((response) => response.url().includes(`/api/growth/plans/${planId}/handoff`) && response.request().method() === 'POST')
      await page.getByRole('button', { name: 'Commit verified handoff', exact: true }).click()
      expect((await commitPost).ok()).toBeTruthy()

      const planAfterCommit = await getPlan(page, business.id, planId)
      const handoffs = planAfterCommit.handoffs || []
      expect(handoffs.length).toBeGreaterThan(0)
      const receipt = [...handoffs].sort((left, right) => new Date(right.createdAt || 0).getTime() - new Date(left.createdAt || 0).getTime())[0]
      expect(receipt.id).toBeTruthy()

      await page.goto(`/growth/campaigns/${initiativeId}?tab=decisions`)
      const receiptSelect = page.getByLabel('Execution receipt', { exact: true })
      await expect(receiptSelect).toBeVisible()
      await receiptSelect.selectOption(receipt.id)
      const bindPatch = page.waitForResponse((response) => response.url().includes(`/api/growth/campaigns/${initiativeId}`) && response.request().method() === 'PATCH')
      await page.getByRole('button', { name: 'Bind selected receipt', exact: true }).click()
      expect((await bindPatch).ok()).toBeTruthy()
      await expect(page.getByText(/Bound execution:/i)).toBeVisible()

      const bound = await getCampaign(page, business.id, initiativeId)
      expect(bound.handoffId).toBe(receipt.id)
      expect(bound.execution?.status).toBe('READY')
      expect(bound.execution?.roadmap).toBeTruthy()

      await page.getByRole('tab', { name: 'Plan', exact: true }).click()
      await expect(page.getByTestId('marketing-campaign-plan')).toBeVisible()
      await expect(page.getByText(/PM execution progress \(not Marketing results\)/i)).toBeVisible()
      await page.getByRole('tab', { name: 'Timeline', exact: true }).click()
      await expect(page.getByTestId('marketing-campaign-timeline')).toBeVisible()
      await page.reload()
      await expect(page).toHaveURL(/tab=timeline/)
      await expect(page.getByTestId('marketing-campaign-timeline')).toBeVisible()

      await page.getByRole('tab', { name: 'Decisions', exact: true }).click()
      await page.getByLabel('Closure reason', { exact: true }).fill('Campaign debrief recorded after PM execution review.')
      const closePatch = page.waitForResponse((response) => response.url().includes(`/api/growth/campaigns/${initiativeId}`) && response.request().method() === 'PATCH')
      await page.getByRole('button', { name: 'Close campaign', exact: true }).click()
      expect((await closePatch).ok()).toBeTruthy()
      await page.reload()
      await expect(page.getByText(/This Campaign is closed and read-only/i)).toBeVisible()
      await expect(page.getByTestId('marketing-campaign-closure-reason')).toContainText('Campaign debrief recorded after PM execution review.')
      const closed = await getCampaign(page, business.id, initiativeId)
      expect(closed.status).toBe('CLOSED')
      expect(closed.closureReason).toContain('Campaign debrief')
    } finally {
      await secondaryContext.close()
    }
  })
})
