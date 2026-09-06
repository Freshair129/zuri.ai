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

      await page.goto(`/growth/content/briefs/${briefId}`)
      const revokeForm = page.getByTestId('marketing-content-decision')
      await revokeForm.getByLabel('Decision').selectOption('REVOKE')
      await revokeForm.getByLabel('Rationale').fill('Revoke the approval for this browser lifecycle check.')
      const revokePatch = page.waitForResponse((response) => response.url().includes(`/api/growth/content/briefs/${briefId}`) && response.request().method() === 'PATCH')
      await revokeForm.getByRole('button', { name: 'Record decision', exact: true }).click()
      expect((await revokePatch).ok()).toBeTruthy()
      const revoked = await getBrief(page, business.id, briefId)
      expect(revoked.approval?.valid).toBe(false)
      await page.goto('/growth/content?tab=library')
      await expect(page.getByText('No approved creative is usable', { exact: true })).toBeVisible()
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

  test('creates through scoped source and PM controls, then exposes production and revision history', async ({ page }, testInfo) => {
    const pageErrors = []
    page.on('pageerror', (error) => pageErrors.push(error.message))
    const { business } = await selectBusiness(page)
    const sourceFile = await ensureActiveFile(page, business.id)
    await page.setViewportSize({ width: 390, height: 844 })
    const referencesLoad = page.waitForResponse((response) => response.url().includes(`/api/growth/content/references?businessId=${business.id}`) && response.request().method() === 'GET')
    await page.goto('/growth/content/new')
    const form = page.getByTestId('marketing-content-brief-form')
    await expect(form).toBeVisible()
    const references = await (await referencesLoad).json()
    expect(references.files.some((file) => file.id === sourceFile.id && file.state === 'ACTIVE')).toBe(true)
    expect(references.projects.length).toBeGreaterThan(0)
    const project = references.projects[0]

    await form.getByLabel('Brief title').fill(`Mobile Content ${Date.now()}`)
    await form.getByLabel('Objective').fill('Validate that creative intent reaches the PM production projection.')
    await form.getByLabel('Audience').fill('Business owners reviewing production readiness.')
    await form.getByLabel('Primary message').fill('The saved brief remains linked to its real production task.')
    await form.getByLabel('Claims to verify').fill('The source file and PM task remain owner-authorized references.')
    await form.getByLabel('Shot list or content outline').fill('Opening, proof, production handoff.')
    await form.getByLabel('Acceptance criteria').fill('Reviewer can inspect the source, rights and PM task.')
    await form.getByLabel('Evidence reference').fill('e2e://content-scoped-controls')
    await form.getByRole('checkbox', { name: 'Meta Ads', exact: true }).check()
    await form.getByLabel('Source file (optional)').selectOption(sourceFile.id)
    await form.getByLabel('Rights holder').fill('E2E Brand team')
    await form.getByLabel('License').fill('Owned creative')
    await form.getByLabel('Valid from').fill('2026-09-01T00:00')
    await form.getByLabel('Valid until').fill('2030-01-01T00:00')
    await form.getByLabel('Rights proof reference').fill('e2e://mobile-rights-proof')

    const projectReferencesLoad = page.waitForResponse((response) => response.url().includes(`/api/growth/content/references?businessId=${business.id}&projectId=${project.id}`) && response.request().method() === 'GET')
    await form.getByLabel('Production Project (optional)').selectOption(project.id)
    const projectReferencesResponse = await projectReferencesLoad
    expect(projectReferencesResponse.ok()).toBeTruthy()
    const projectReferences = await projectReferencesResponse.json()
    const workItem = projectReferences.workItems.find((item) => item.projectId === project.id)
    expect(workItem?.id).toBeTruthy()
    await expect(form.getByLabel('Production task (optional)').locator(`option[value="${workItem.id}"]`)).toHaveCount(1)
    await form.getByLabel('Production task (optional)').selectOption(workItem.id)

    const createResponse = page.waitForResponse((response) => response.url().endsWith('/api/growth/content') && response.request().method() === 'POST')
    await form.getByRole('button', { name: 'Save draft & preview', exact: true }).click()
    expect((await createResponse).ok()).toBeTruthy()
    await expect(page).toHaveURL(/\/growth\/content\/briefs\/[^?]+$/)
    const briefId = new URL(page.url()).pathname.split('/').pop()
    await expect(page.getByTestId('marketing-content-brief')).toContainText(project.name)
    await expect(page.getByTestId('marketing-content-brief')).toContainText(workItem.title)

    const detailForm = page.getByTestId('marketing-content-brief-form')
    await detailForm.getByLabel('Primary message').fill('The revised brief remains linked to the same PM task.')
    const reviseResponse = page.waitForResponse((response) => response.url().includes(`/api/growth/content/briefs/${briefId}`) && response.request().method() === 'PATCH')
    await detailForm.getByRole('button', { name: 'Save new revision', exact: true }).click()
    expect((await reviseResponse).ok()).toBeTruthy()
    await expect(page.getByTestId('marketing-content-versions')).toContainText(/Revision 2/i)
    await expect(page.getByTestId('marketing-content-versions')).toContainText(/Before:/i)

    await page.goto('/growth/content?tab=production')
    const production = page.getByTestId('marketing-content-production-board')
    await expect(production).toContainText(workItem.title)
    const productionLink = production.getByRole('link').first()
    await expect(productionLink).toHaveAttribute('href', `/growth/content/briefs/${briefId}`)
    await productionLink.click()
    await expect(page).toHaveURL(new RegExp(`/growth/content/briefs/${briefId}$`))
    await expect(page.getByTestId('marketing-content-brief')).toContainText('The revised brief remains linked to the same PM task.')

    await expect(page.getByTestId('marketing-content-references')).toBeVisible()
    await page.screenshot({ path: testInfo.outputPath('content-new-mobile.png'), fullPage: true })
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
    expect(pageErrors).toEqual([])
  })
})
