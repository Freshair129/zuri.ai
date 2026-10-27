// @req FR-107, FR-120 — real first-operator login and signup without granted authority.
// @req FR-003, FR-004, FR-009, FR-074 — actual scoped Business/PM writes and seven execution views.
// @spec ADR-115 — packaged app on disposable PostgreSQL, isolated HTTPS and no auth bypass.
// @tested tests/e2e/compact-core.spec.js
const { test, expect } = require('@playwright/test')
const { readFile } = require('node:fs/promises')
const { createHash } = require('node:crypto')
const path = require('node:path')

test('fresh Compact operator, signup, Business/PM scope, seven views and restart persistence', async ({ playwright }) => {
  const api = await import('../helpers/compact-core-target.mjs')
  expect(typeof api.startCompactCoreTarget, 'Task3 actual isolated core fixture is missing').toBe('function')
  const f = await api.startCompactCoreTarget()
  let browser
  const request = (page, method, url, data) => page.evaluate(async input => {
    const response = await fetch(input.url, { method: input.method, credentials: 'same-origin', redirect: 'error',
      ...(input.data === undefined ? {} : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(input.data) }) })
    return { status: response.status, ok: response.ok, url: input.url, body: await response.json().catch(() => null) }
  }, { method, url, data })
  const checked = async response => {
    const error = response.body?.error
    const code = typeof error === 'string' && /^(?:[A-Z][A-Z0-9_]{1,95}|Business not found|Tenant not found|Workspace not found)$/.test(error) ? error : response.body === null ? 'NON_JSON' : 'UNCLASSIFIED'
    if (!response.ok) await f.recordEvidence({ coreFlows: false, failure: { url: response.url, status: response.status, code } })
    expect(response.ok, `HTTP ${response.status} ${response.url} ${code}`).toBe(true)
    return response.body
  }
  try {
    expect(f.candidate?.status).toBe('ARTIFACT_INSPECTED_NOT_QUALIFIED')
    if (process.env.COMPACT_PACKAGE_DIRECTORY) expect(f.candidate.packageInventorySha256).toBe(createHash('sha256').update(await readFile(path.join(process.env.COMPACT_PACKAGE_DIRECTORY, 'SHA256SUMS'))).digest('hex'))
    expect(typeof f.recreateWeb).toBe('function')
    expect(f.providerChecks).toEqual({ versioning: true, conditionalWrite: true, exactRead: true, exactErase: true })
    expect(f.bootstrapResult.status).toBe('BOOTSTRAPPED')
    expect('initialPassword' in f.bootstrapResult).toBe(false)
    await expect(f.repeatBootstrap()).rejects.toMatchObject({ code: 'COMPACT_BOOTSTRAP_REFUSED' })
    browser = await playwright.chromium.launch({ headless: true, ...(f.executablePath ? { executablePath: f.executablePath } : {}), args: [`--ignore-certificate-errors-spki-list=${f.spkiPin}`] })
    const context = await browser.newContext({ baseURL: f.baseURL, ignoreHTTPSErrors: false })
    context.setDefaultTimeout(15000); context.setDefaultNavigationTimeout(30000)
    const operatorPage = await context.newPage()
    await operatorPage.goto('/login')
    await operatorPage.getByLabel('Email or account code').fill(f.operator.email)
    await operatorPage.getByLabel('Password', { exact: true }).fill(f.initialPassword)
    await operatorPage.getByRole('button', { name: 'Sign in', exact: true }).click()
    await operatorPage.waitForURL(url => !url.pathname.endsWith('/login'))
    const session = (await context.cookies()).find(c => c.name === 'zuri_session')
    expect(Boolean(session?.secure && session?.httpOnly)).toBe(true)
    await checked(await request(operatorPage, 'POST', '/api/onboarding/profile', { firstName: 'Compact', lastName: 'Operator', phone: '0000000000' }))
    // Platform authority deliberately has no Tenant/Business ownership. Use an
    // ordinary account's real self-provisioning grant for the domain success path.
    const ownerContext = await browser.newContext({ baseURL: f.baseURL, ignoreHTTPSErrors: false })
    ownerContext.setDefaultTimeout(15000); ownerContext.setDefaultNavigationTimeout(30000)
    const page = await ownerContext.newPage(); await page.goto('/signup')
    const ownerSignup = await request(page, 'POST', '/api/auth/signup', { displayName: 'Compact Owner', email: f.ownerEmail, password: f.ownerPassword })
    expect(ownerSignup.status).toBe(201)
    expect(await f.authorityCounts(ownerSignup.body.user.id)).toEqual({ grants: 0, memberships: 0 })
    await checked(await request(page, 'POST', '/api/onboarding/profile', { firstName: 'Compact', lastName: 'Owner', phone: '0000000000' }))
    const a = await checked(await request(page, 'POST', '/api/scope', { entity: 'businessInGroup', data: { name: 'Compact Business A' } }))
    expect(await f.authorityCounts(ownerSignup.body.user.id)).toEqual({ grants: 0, memberships: 1 })
    await checked(await request(page, 'PATCH', '/api/scope', { entity: 'business', id: a.business.id, expectedVersion: a.business.version, data: { name: 'Compact Business Updated' } }))
    const project = await checked(await request(page, 'POST', '/api/projects', { workspaceId: a.workspace.id, name: 'Compact durable project' }))
    await checked(await request(page, 'PATCH', `/api/projects/${project.id}`, { name: 'Compact updated project', version: project.version }))
    const modes = [
      ['SOFTWARE_SPRINT', 'sprint', 'Software Sprint'], ['DATA_MIGRATION', 'migration', 'Data Migration'],
      ['B2B_SALES', 'b2b-sales', 'B2B Sales'], ['B2C_CAMPAIGN', 'b2c-campaign', 'B2C Campaign'],
      ['PRODUCT_LAUNCH', 'product-launch', 'Product Launch'], ['OPERATIONS', 'operations', 'Operations'], ['BUSINESS_EXPANSION', 'expansion', 'Business Expansion'],
    ]
    for (const [mode] of modes) await checked(await request(page, 'POST', '/api/workstreams', { projectId: project.id, name: mode, code: `COMPACT-${mode}`, executionMode: mode }))
    await page.goto('/businesses')
    await page.getByRole('button', { name: /Open Business Compact Business Updated/ }).click()
    for (const [mode, slug, label] of modes) {
      await page.goto(`/execution/${slug}`)
      await expect(page.getByRole('heading', { name: label, exact: true })).toBeVisible()
      await expect(page.getByText(`COMPACT-${mode}`, { exact: false }).first()).toBeVisible()
      await expect(page.getByRole('button', { name: /Explain/i }).first()).toBeVisible()
    }
    const stranger = await browser.newContext({ baseURL: f.baseURL, ignoreHTTPSErrors: false })
    stranger.setDefaultTimeout(15000); stranger.setDefaultNavigationTimeout(30000)
    const strangerPage = await stranger.newPage(); await strangerPage.goto('/signup')
    const created = await request(strangerPage, 'POST', '/api/auth/signup', { displayName: 'Compact Stranger', email: f.signupEmail, password: f.signupPassword })
    expect(created.status).toBe(201)
    const signup = created.body
    const emptyScope = await checked(await request(strangerPage, 'GET', '/api/scope'))
    expect(emptyScope.businesses ?? []).toHaveLength(0)
    expect(await f.authorityCounts(signup.user.id)).toEqual({ grants: 0, memberships: 0 })
    await checked(await request(strangerPage, 'POST', '/api/onboarding/profile', { firstName: 'Compact', lastName: 'Stranger', phone: '0000000000' }))
    await checked(await request(strangerPage, 'POST', '/api/scope', { entity: 'businessInGroup', data: { name: 'Compact Business B' } }))
    expect((await request(strangerPage, 'GET', `/api/projects/${project.id}`)).status).toBe(404)
    expect((await request(strangerPage, 'PATCH', `/api/projects/${project.id}`, { name: 'Foreign change' })).status).toBe(404)
    await f.restartWeb()
    await f.recreateWeb()
    const retained = await checked(await request(page, 'GET', `/api/projects/${project.id}`))
    expect(retained.name).toBe('Compact updated project')
    expect(retained.workstreams).toHaveLength(7)
    expect(await f.operatorCount()).toBe(1)
    const modelTables = await f.modelTableCount(); expect(modelTables).toBe(210)
    expect(await f.retryInstalled()).toMatchObject({ status: 'INSTALLED', initialized: false })
    const evidence = await f.recordEvidence({ coreFlows: true, httpsLogin: true, signupUnprivileged: true, crossBusinessDenied: true, sevenExecutionViews: true, restartPersistence: true, appRecreationPersistence: true, installedRetrySafe: true, modelTables })
    expect(evidence.runtimeEnvelope.samples).toHaveLength(3)
    expect(evidence.runtimeEnvelope.volumes.database.allocatedBytes).toBeGreaterThan(0)
  } finally { await browser?.close(); await f.close() }
})
