// @req FR-077 — Project Inventory covers happy, empty, error, partial, and unauthorized boundaries.
// @spec SDD-045, ADR-034, ADR-017
// @tested tests/e2e/fr077-project-inventory.spec.js
const { test, expect } = require('@playwright/test')
// A lost connection is not a result. See the header of this module for the run
// that turned one into a red `main`, and for why only the connection is retried.
const { api } = require('./reconnecting-request')

async function chooseBusiness(page, name = 'Business 01') {
  await page.goto('/login')
  await page.getByRole('button', { name: /demo login/i }).click()
  await page.getByRole('button', { name: new RegExp(`Open Business ${name}`) }).click()
  await expect(page).toHaveURL(/overview/)
}

test.describe('FR-077 Project Inventory', () => {
  test('happy path renders the additive Inventory entry and operational sections', async ({ page }) => {
    await chooseBusiness(page)
    const resolved = await (await api(page.request).get('/api/resolve?type=PROJECT&code=PRJ-B01-TRANSFORM')).json()

    await page.goto(`/projects/${resolved.id}/inventory`)

    await expect(page.getByRole('heading', { name: resolved.name || /Transformation Program/ })).toBeVisible()
    await expect(page.getByRole('link', { name: 'Inventory' })).toHaveAttribute('aria-current', 'page')
    await expect(page.getByText('Progress evidence')).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Workstreams' })).toBeVisible()
    await expect(page.getByText('Recent activity')).toBeVisible()
  })

  test('empty Project shows an empty section without treating it as an error', async ({ page }) => {
    await chooseBusiness(page)
    const scope = await (await api(page.request).get('/api/scope')).json()
    const workspace = scope.workspaces.find((item) => item.code === 'WS-B01-MIG')
    const created = await api(page.request).post('/api/projects', {
      data: { workspaceId: workspace.id, businessId: workspace.businessId, name: `Inventory empty ${Date.now()}` },
    })
    expect(created.ok()).toBe(true)
    const project = await created.json()

    await page.goto(`/projects/${project.id}/inventory`)
    await expect(page.getByText('No workstreams recorded.')).toBeVisible()
    await expect(page.getByText('No files recorded.')).toBeVisible()
  })

  test('missing Project shows a recoverable error state', async ({ page }) => {
    await chooseBusiness(page)
    await page.goto('/projects/does-not-exist/inventory')
    const errorAlert = page.locator('div[role="alert"]').filter({ hasText: 'Project not found' })
    await expect(errorAlert).toContainText('Project not found')
    await expect(errorAlert).toContainText('not present in the current scope')
  })

  test('limit=1 exposes partial/truncated metadata instead of silently shortening the response', async ({ page }) => {
    await chooseBusiness(page)
    const resolved = await (await api(page.request).get('/api/resolve?type=PROJECT&code=PRJ-B01-TRANSFORM')).json()

    const response = await api(page.request).get(`/api/projects/${resolved.id}/inventory?limit=1`)
    expect(response.ok()).toBe(true)
    const body = await response.json()
    expect(body.sections.work.workstreams.status).toBe('PARTIAL')
    expect(body.sections.work.workstreams.truncated).toBe(true)
  })

  test('unauthenticated Inventory reads fail closed', async ({ request }) => {
    const response = await api(request).get('/api/projects/00000000-0000-0000-0000-000000000000/inventory')
    expect(response.status()).toBe(401)
  })
})
