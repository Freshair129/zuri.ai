// @req FR-157 — browser coverage for the six Content interfaces, immutable
// review/decision lifecycle, approved Library click-through and URL/mobile state.
// @spec ZAI:FR-157-NOTE
// @tested tests/e2e/marketing-content.spec.js

const { test, expect } = require('@playwright/test')
const { loginAsOwner } = require('./e2e-auth')

const CONTENT_PAYLOAD = {
  objective: 'Explain the delivery promise with reviewed creative intent.',
  audience: 'Approved corporate buyers',
  message: 'Make gifting easy to plan.',
  claims: 'Delivery dates are supported by the Commerce evidence reference.',
  shotList: 'Opening, product detail, delivery close.',
  acceptanceCriteria: 'Claims, brand and usage rights are reviewed.',
  evidenceReference: 'commerce://delivery-window/e2e',
  format: 'VIDEO',
  channels: ['META_ADS'],
  initiativeId: null,
  asset: null,
  rights: null,
  production: null,
}

function unwrap(value, key) {
  return value?.[key] || value
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
  await page.goto('/growth/content?tab=briefs')
  const scope = await scopeFor(page)
  const business = scope.businesses.find((item) => item.name === 'Business 01') || scope.businesses[0]
  expect(business?.id).toBeTruthy()
  return { business }
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

async function ensureActiveFile(page, businessId) {
  const referencesResponse = await page.request.get(`/api/growth/content/references?businessId=${businessId}`)
  expect(referencesResponse.ok()).toBeTruthy()
  const references = await referencesResponse.json()
  const active = (references.files || []).find((file) => file.state === 'ACTIVE')
  if (active) return active

  const createFile = await page.request.post('/api/files', { data: {
    businessId,
    storageKind: 'MANAGED_BLOB',
    blobRef: `e2e/content/${Date.now()}`,
    name: `E2E reviewed creative ${Date.now()}.png`,
    mime: 'image/png',
    size: 1,
    sha256: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  } })
  expect(createFile.ok()).toBeTruthy()
  const file = await createFile.json()
  expect(file.id).toBeTruthy()
  return file
}

async function createBrief(page, businessId) {
  const file = await ensureActiveFile(page, businessId)
  const payload = {
    ...CONTENT_PAYLOAD,
    asset: { fileId: file.id },
    rights: {
      holder: 'E2E Brand team',
      license: 'Owned creative',
      channels: ['META_ADS'],
      validFrom: '2026-09-01T00:00:00.000Z',
      validUntil: '2030-01-01T00:00:00.000Z',
      proof: 'e2e://rights-proof',
    },
  }
  const response = await page.request.post('/api/growth/content', { data: { businessId, title: `Browser Content ${Date.now()}`, payload } })
  expect(response.ok()).toBeTruthy()
  const brief = unwrap(await response.json(), 'brief')
  expect(brief.id).toBeTruthy()
  return brief
}

async function getBrief(page, businessId, briefId) {
  const response = await page.request.get(`/api/growth/content/briefs/${briefId}?businessId=${businessId}`)
  expect(response.ok()).toBeTruthy()
  return unwrap(await response.json(), 'brief')
}

test.describe('Marketing Content first functional slice', () => {
  test('keeps all six interfaces addressable and supports real review to Library asset detail', async ({ page, browser }, testInfo) => {
    const pageErrors = []
    page.on('pageerror', (error) => pageErrors.push(error.message))
    const { business } = await selectBusiness(page)
    const brief = await createBrief(page, business.id)
    const briefId = brief.id

    await page.goto('/growth/content?tab=briefs')
    await expect(page.getByRole('tablist', { name: 'Marketing content sections' })).toBeVisible()
    await expect(page.getByTestId('marketing-content-brief-list')).toContainText(brief.title)
    const listLink = page.getByTestId('marketing-content-brief-list').getByRole('link', { name: brief.title, exact: true })
    await expect(listLink).toHaveAttribute('href', `/growth/content/briefs/${briefId}`)
    await listLink.click()
    await expect(page).toHaveURL(new RegExp(`/growth/content/briefs/${briefId}$`))
    await expect(page.getByTestId('marketing-content-brief')).toContainText(CONTENT_PAYLOAD.message)

    const secondaryEmail = `content-reviewer-${testInfo.workerIndex}-${testInfo.retry}-${Date.now()}@example.com`
    const secondaryPassword = 'e2e-content-Passw0rd'
    const origin = new URL(page.url()).origin
    const secondaryContext = await browser.newContext({ baseURL: origin })
    try {
      const signup = await secondaryContext.request.post('/api/auth/signup', { data: { displayName: 'Content reviewer', email: secondaryEmail, password: secondaryPassword } })
      expect(signup.status()).toBe(201)
      const membershipResponse = await page.request.post('/api/platform/users/memberships', { data: { businessId: business.id, identifier: secondaryEmail, domainKeys: ['growth'] } })
      expect(membershipResponse.status()).toBe(200)
      const membership = await membershipResponse.json()
      const promote = await page.request.patch('/api/platform/users', { data: { membershipId: membership.id, role: 'OWNER', domainKeys: ['growth'] } })
      expect(promote.status()).toBe(200)

      const secondaryPage = await secondaryContext.newPage()
      await loginAs(secondaryPage, secondaryEmail, secondaryPassword)
      await selectBusinessForSignedInUser(secondaryPage)
      await secondaryPage.goto(`/growth/content/briefs/${briefId}`)
      const reviewForm = secondaryPage.getByTestId('marketing-content-review')
      await expect(reviewForm).toBeVisible()
      await reviewForm.getByLabel('Rationale').fill('Independent reviewer confirms the exact content revision.')
      await reviewForm.getByLabel('Rights confirmed').check()
      await reviewForm.getByLabel('Brand claims confirmed').check()
      const reviewPatch = secondaryPage.waitForResponse((response) => response.url().includes(`/api/growth/content/briefs/${briefId}`) && response.request().method() === 'PATCH')
      await reviewForm.getByRole('button', { name: 'Record review', exact: true }).click()
      expect((await reviewPatch).ok()).toBeTruthy()

      await page.goto(`/growth/content/briefs/${briefId}`)
      const decisionForm = page.getByTestId('marketing-content-decision')
      await expect(decisionForm).toBeVisible()
      await decisionForm.getByLabel('Decision').selectOption('APPROVE')
      await decisionForm.getByLabel('Matching review').selectOption({ index: 1 })
      await decisionForm.getByLabel('Rationale').fill('Approved for this Business and exact creative revision.')
      await decisionForm.getByLabel('Approval expires').fill('2029-01-01T00:00')
      const decisionPatch = page.waitForResponse((response) => response.url().includes(`/api/growth/content/briefs/${briefId}`) && response.request().method() === 'PATCH')
      await decisionForm.getByRole('button', { name: 'Record decision', exact: true }).click()
      expect((await decisionPatch).ok()).toBeTruthy()

      const approved = await getBrief(page, business.id, briefId)
      const currentVersion = approved.currentVersion || [...(approved.versions || [])].sort((left, right) => right.revision - left.revision)[0]
      expect(currentVersion?.id).toBeTruthy()

      await page.goto('/growth/content?tab=library')
      const library = page.getByTestId('marketing-content-library')
      await expect(library).toBeVisible()
      const assetLink = library.getByRole('link').first()
      await expect(assetLink).toHaveAttribute('href', `/growth/content/assets/${currentVersion.id}`)
      await assetLink.click()
      await expect(page).toHaveURL(new RegExp(`/growth/content/assets/${currentVersion.id}$`))
      await expect(page.getByTestId('marketing-content-asset-source')).toContainText(/Preview is available in Files/i)
      await expect(page.getByTestId('marketing-content-asset-reviews')).toContainText(/Independent reviewer|Pass/i)
      await page.getByRole('link', { name: 'Back to library', exact: true }).click()
      await expect(page).toHaveURL(/\/growth\/content\?tab=library/)
    } finally {
      await secondaryContext.close()
    }

    await page.goto('/growth/content?tab=production')
    await expect(page.getByRole('tab', { name: 'Production', exact: true })).toHaveAttribute('aria-current', 'page')
    await expect(page.getByText(/Project Manager/i)).toBeVisible()
    await page.setViewportSize({ width: 390, height: 844 })
    await page.getByRole('tab', { name: 'Production', exact: true }).focus()
    await page.keyboard.press('End')
    await expect(page).toHaveURL(/tab=library/)
    await expect(page.getByRole('tab', { name: 'Library', exact: true })).toBeFocused()
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
    expect(pageErrors).toEqual([])
  })

  test('shows the create form with real scoped choice controls on mobile', async ({ page }, testInfo) => {
    const pageErrors = []
    page.on('pageerror', (error) => pageErrors.push(error.message))
    const { business } = await selectBusiness(page)
    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto('/growth/content/new')
    await expect(page.getByTestId('marketing-content-brief-form')).toBeVisible()
    await expect(page.getByLabel('Brief title')).toBeVisible()
    await expect(page.getByLabel('Primary message')).toBeVisible()
    await expect(page.getByLabel('Production Project (optional)')).toBeVisible()
    await expect(page.getByTestId('marketing-content-references')).toBeVisible()
    await page.screenshot({ path: testInfo.outputPath('content-new-mobile.png'), fullPage: true })
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
    expect(business.id).toBeTruthy()
    expect(pageErrors).toEqual([])
  })
})
