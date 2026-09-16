// @req FR-250 — execution children retain their Project parent, Inventory
// drilldowns remain usable, and missing Project scope cannot render navigation.
// @spec ADR-096, SDD-019
// @tested tests/e2e/fr250-navigation.spec.js
const { test, expect } = require('@playwright/test')
const { loginAsOwner } = require('./e2e-auth')
const { api } = require('./reconnecting-request')

async function openProject(page) {
  await loginAsOwner(page)
  await page.getByRole('button', { name: /Open Business Business 01/ }).click()
  await expect(page).toHaveURL(/\/overview$/)
  const response = await api(page.request).get('/api/resolve?type=PROJECT&code=PRJ-B01-TRANSFORM')
  expect(response.ok()).toBe(true)
  const { id } = await response.json()
  await page.goto(`/projects/${id}`)
  await expect(page.getByRole('navigation', { name: 'Project Management project sections' })).toBeVisible()
  return id
}

test.describe('FR-250 navigation boundaries', () => {
  for (const mode of ['sprint', 'migration', 'b2b-sales', 'b2c-campaign', 'product-launch', 'operations', 'expansion']) {
    test(`execution ${mode} keeps its Project Overview parent and return link`, async ({ page }) => {
      const id = await openProject(page)
      await page.locator(`a[href="/projects/${id}/execution/${mode}"]`).click()
      await expect(page).toHaveURL(new RegExp(`/projects/${id}/execution/${mode}$`))
      const sections = page.getByRole('navigation', { name: 'Project Management project sections' })
      await expect(sections.getByRole('link', { name: 'Project Overview', exact: true })).toHaveAttribute('aria-current', 'page')
      await expect(page.getByRole('navigation', { name: 'Project work views' })).toHaveCount(0)
      await expect(page.locator('[data-action-id="pm.import"]')).toHaveCount(1)
      const back = page.getByRole('link', { name: /Back to project .*workstreams/ })
      await expect(back).toHaveAttribute('href', `/projects/${id}`)
      await back.click()
      await expect(page).toHaveURL(new RegExp(`/projects/${id}$`))
    })
  }

  test('Inventory links directly to the same Project repositories', async ({ page }) => {
    const id = await openProject(page)
    await page.getByRole('link', { name: 'Inventory (read only)', exact: true }).click()
    await expect(page).toHaveURL(new RegExp(`/projects/${id}/inventory$`))
    const repositories = page.getByRole('link', { name: 'Open repositories →', exact: true })
    await expect(repositories).toHaveAttribute('href', `/projects/${id}/repositories`)
    await repositories.click()
    await expect(page).toHaveURL(new RegExp(`/projects/${id}/repositories$`))
    await expect(page.getByRole('navigation', { name: 'Projects & Work modules' }).getByRole('link', { name: 'Resource Coordination', exact: true })).toHaveAttribute('aria-current', 'page')
  })

  test('unknown Project scope fails before the PM shell mounts', async ({ page }) => {
    await openProject(page)
    await page.goto('/projects/00000000-0000-4000-8000-000000000247/structure')
    await expect(page.getByText('Project not found', { exact: true })).toBeVisible()
    await expect(page.getByRole('navigation', { name: 'Projects & Work modules' })).toHaveCount(0)
    await expect(page.locator('[data-action-id="pm.import"]')).toHaveCount(0)
  })

  test('Project content and Import stay usable below the compact mobile menu', async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 390, height: 844 })
    const id = await openProject(page)
    const toggle = page.getByRole('button', { name: 'Toggle Projects & Work navigation' })
    await toggle.click()
    await page.getByRole('button', { name: /Delivery Design/ }).press('Enter')
    await expect(page.getByRole('group', { name: 'Delivery Design planned capabilities' })).toBeVisible()
    await page.getByRole('navigation', { name: 'Projects & Work modules' }).getByRole('link', { name: 'Work Management', exact: true }).click()
    await expect(page).toHaveURL(new RegExp(`/projects/${id}/structure$`))
    await expect(toggle).toHaveAttribute('aria-expanded', 'false')
    await expect(page.locator('[data-module-id="module.delivery-design"]')).toHaveAttribute('aria-expanded', 'false')
    await expect(page.getByRole('navigation', { name: 'Project work views' })).toBeInViewport()
    const importAction = page.locator('[data-action-id="pm.import"]')
    await expect(importAction).toBeInViewport()
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1)
    await page.screenshot({ path: testInfo.outputPath('mobile-project-work.png'), fullPage: true })
    await importAction.click()
    await expect(page).toHaveURL(new RegExp(`/projects/${id}/import$`))
    await expect(page.getByRole('link', { name: 'Return to Project overview' })).toBeVisible()
  })
})
