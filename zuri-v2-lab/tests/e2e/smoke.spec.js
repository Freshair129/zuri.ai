const { test, expect } = require('@playwright/test')

// E2E smoke: every major route renders with seeded data (npm run db:seed first).

test.describe('universal routes', () => {
  test('overview renders portfolio KPIs and project list', async ({ page }) => {
    await page.goto('/overview')
    await expect(page.getByRole('heading', { name: /Overview/i })).toBeVisible()
    await expect(page.locator('main').getByText('PRJ-B01-TRANSFORM', { exact: false }).first()).toBeVisible()
  })

  test('workspaces list shows seeded workspaces', async ({ page }) => {
    await page.goto('/workspaces')
    await expect(page.locator('main').getByText('WS-PLATFORM', { exact: false }).first()).toBeVisible()
    await expect(page.locator('main').getByText('WS-B01-MIG', { exact: false }).first()).toBeVisible()
  })

  test('projects list + project detail with workstreams', async ({ page }) => {
    await page.goto('/projects')
    await expect(page.getByRole('link', { name: 'Business 01 Transformation Program' })).toBeVisible()
    await page.getByRole('link', { name: 'Business 01 Transformation Program' }).click()
    await expect(page.getByRole('heading', { name: 'Business 01 Transformation Program' })).toBeVisible()
    await expect(page.getByText('Project progress')).toBeVisible()
    await expect(page.getByText('WST-DATA', { exact: false }).first()).toBeVisible()
  })

  test('all work view with filters', async ({ page }) => {
    await page.goto('/work')
    await expect(page.getByLabel('Search work items')).toBeVisible()
    await expect(page.getByText('DATA-CUSTOMER', { exact: false }).first()).toBeVisible()
    // Filter by mode narrows the table.
    await page.getByLabel('Filter by execution mode').selectOption('DATA_MIGRATION')
    await expect(page.getByText('ZURI-421', { exact: false })).toHaveCount(0)
  })

  test('dependencies view renders edges', async ({ page }) => {
    await page.goto('/dependencies')
    await expect(page.getByText('GATE-DATA-ID', { exact: false }).first()).toBeVisible()
    await expect(page.getByText('BLOCKS', { exact: false }).first()).toBeVisible()
  })

  test('milestones & gates view', async ({ page }) => {
    await page.goto('/milestones')
    await expect(page.getByText('Milestones').first()).toBeVisible()
    await expect(page.getByText('GATE-REL-12', { exact: false }).first()).toBeVisible()
  })

  test('timeline renders dated bars', async ({ page }) => {
    await page.goto('/timeline')
    await expect(page.locator('main').getByText('PRJ-B01-TRANSFORM', { exact: false }).first()).toBeVisible()
  })

  test('audit log shows events', async ({ page }) => {
    await page.goto('/audit')
    await expect(page.getByRole('heading', { name: 'Audit Log' })).toBeVisible()
  })

  test('backup page has export and import preview', async ({ page }) => {
    await page.goto('/backup')
    await expect(page.getByRole('button', { name: /Download snapshot/i })).toBeVisible()
    await expect(page.getByRole('button', { name: /Preview/i })).toBeVisible()
  })

  test('command palette opens with Ctrl+K and navigates', async ({ page }) => {
    await page.goto('/overview')
    await page.keyboard.press('Control+k')
    const input = page.getByLabel('Command palette search')
    await expect(input).toBeVisible()
    await input.fill('Backup')
    await page.keyboard.press('Enter')
    await expect(page).toHaveURL(/backup/)
  })
})

test.describe('seven execution views', () => {
  const cases = [
    ['sprint', 'Software Sprint', 'WST-ZURI-DEV'],
    ['migration', 'Data Migration', 'WST-DATA'],
    ['b2b-sales', 'B2B Sales', 'WST-B2B'],
    ['b2c-campaign', 'B2C Campaign', 'WST-B2C'],
    ['product-launch', 'Product Launch', 'WST-LAUNCH'],
    ['operations', 'Operations', 'WST-OPS'],
    ['expansion', 'Business Expansion', 'WST-EXPAND'],
  ]
  for (const [slug, label, wsCode] of cases) {
    test(`${label} view renders seeded workstream`, async ({ page }) => {
      await page.goto(`/execution/${slug}`)
      await expect(page.getByRole('heading', { name: label })).toBeVisible()
      await expect(page.getByText(wsCode, { exact: false }).first()).toBeVisible()
      // Strategy-based progress with explanation affordance.
      await expect(page.getByRole('button', { name: /Explain/i }).first()).toBeVisible()
    })
  }

  test('progress explanation reveals evidence', async ({ page }) => {
    await page.goto('/execution/migration')
    await page.getByRole('button', { name: /Explain/i }).first().click()
    await expect(page.getByText(/validated \/ recordsTotal/i)).toBeVisible()
  })
})

test.describe('plan import', () => {
  test('dry run previews and rejects bad plans', async ({ page }) => {
    await page.goto('/projects')
    const first = page.getByRole('link', { name: 'Business 01 Transformation Program' })
    await first.click()
    await page.getByRole('link', { name: 'Import' }).click()
    const textarea = page.getByLabel('Plan envelope JSON')
    await textarea.fill(JSON.stringify({ schemaVersion: '1.0', project: { code: 'X', name: 'X' }, workstreams: [{ code: 'W', name: 'W', executionMode: 'NOT_A_MODE', progressStrategy: 'TASK_WEIGHT' }] }))
    await page.getByRole('button', { name: /Validate \+ dry run/i }).click()
    await expect(page.getByText(/Validation errors/i)).toBeVisible()
  })
})

test.describe('responsive smoke', () => {
  test('no horizontal page overflow at mobile viewport', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 })
    await page.goto('/overview')
    await page.waitForLoadState('networkidle')
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
    expect(overflow).toBeLessThanOrEqual(1)
  })
})
