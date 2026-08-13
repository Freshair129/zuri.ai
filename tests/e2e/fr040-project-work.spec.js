// @req FR-040 — Project Work views expose Structure Plan and Dependency Map.
// @spec SDD-019, ADR-012

const { test, expect } = require('@playwright/test')

async function chooseBusiness(page, name = 'Business 01') {
  await page.goto('/login')
  await page.getByRole('button', { name: /demo login/i }).click()
  await page.getByRole('button', { name: new RegExp(`Open Business ${name}`) }).click()
  await expect(page).toHaveURL(/overview/)
}

test.describe('FR-040 Project Work views', () => {
  test('keeps WBS and Dependency Map inside one canonical Project tab shell', async ({ page, request }) => {
    const resolved = await (await request.get('/api/resolve?type=PROJECT&code=PRJ-B01-TRANSFORM')).json()
    const projectId = resolved.id

    await chooseBusiness(page)
    await page.goto(`/projects/${projectId}/structure`)
    await expect(page.getByRole('navigation', { name: 'Project sections' })).toBeVisible()
    await expect(page.getByRole('link', { name: 'Dependency Map' })).toBeVisible()
    await expect(page.getByRole('navigation', { name: 'Project views' })).toHaveCount(0)
    await expect(page.getByRole('tree', { name: /work breakdown structure/i })).toBeVisible()

    await page.getByRole('link', { name: 'Dependency Map' }).click()
    await expect(page).toHaveURL(new RegExp(`/projects/${projectId}/dependencies$`))
    await expect(page.getByRole('heading', { name: 'Dependency Map' })).toBeVisible()
    await expect(page.getByRole('region', { name: 'Dependency edge list' })).toBeVisible()
    await expect(page.getByRole('navigation', { name: 'Project sections' })).toBeVisible()
  })

  test('keeps the graph inside a scrollable canvas on a narrow viewport', async ({ page, request }) => {
    const resolved = await (await request.get('/api/resolve?type=PROJECT&code=PRJ-B01-TRANSFORM')).json()
    await page.setViewportSize({ width: 390, height: 844 })
    await chooseBusiness(page)
    await page.goto(`/projects/${resolved.id}/dependencies`)
    await page.waitForLoadState('networkidle')

    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
    expect(overflow).toBeLessThanOrEqual(1)
    await expect(page.locator('[class*=graphViewport]')).toHaveCount(1)
    await expect(page.getByRole('region', { name: 'Dependency edge list' })).toBeVisible()
  })
})
