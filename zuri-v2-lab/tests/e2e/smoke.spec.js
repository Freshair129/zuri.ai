const { test, expect } = require('@playwright/test')

// E2E smoke: every major route renders with seeded data (npm run db:seed first).

test.describe('universal routes', () => {
  // The seed has four businesses, so the landing is the group roll-up (FR-020).
  test('overview renders the group roll-up with a card per business', async ({ page }) => {
    await page.goto('/overview')
    await expect(page.getByRole('heading', { name: 'ภาพรวมทั้งเครือ' })).toBeVisible()
    await expect(page.locator('main').getByText('ความคืบหน้ารวม')).toBeVisible()
    await expect(page.locator('main').getByText('BUS-001')).toBeVisible()
    await expect(page.locator('main').getByText('BUS-004')).toBeVisible()
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
  test('dry run previews and rejects bad plans', async ({ page, request }) => {
    const resolved = await (await request.get('/api/resolve?type=PROJECT&code=PRJ-B01-TRANSFORM')).json()
    await page.goto(`/projects/${resolved.id}/import`)
    const textarea = page.getByLabel('Plan envelope JSON')
    await textarea.fill(JSON.stringify({ schemaVersion: '1.0', project: { code: 'X', name: 'X' }, workstreams: [{ code: 'W', name: 'W', executionMode: 'NOT_A_MODE', progressStrategy: 'TASK_WEIGHT' }] }))
    await page.getByRole('button', { name: /Validate \+ dry run/i }).click()
    await expect(page.getByText(/Validation errors/i)).toBeVisible()
  })
})

test.describe('FR-017 project wizard', () => {
  test('start-from-objective wizard creates a project through the pipeline', async ({ page }) => {
    await page.goto('/projects/new')
    await expect(page.getByRole('heading', { name: 'สร้างโปรเจกต์ใหม่' })).toBeVisible()

    // Step 1: objective only — no template picker anywhere.
    await page.getByLabel('เป้าหมายโปรเจกต์').fill('E2E เปิดร้านสาขาทดสอบ')
    // Next stays disabled until the scope (workspaces) loads.
    await expect(page.getByRole('button', { name: 'ถัดไป' })).toBeEnabled({ timeout: 30000 })
    await page.getByRole('button', { name: 'ถัดไป' }).click()

    // Step 2: decompose into workstreams; mode belongs to the stream.
    await page.getByLabel('ชื่อสายงานที่ 1').fill('หาทำเลและสัญญา')
    await page.getByLabel('ลักษณะงานของสายงานที่ 1').selectOption('BUSINESS_EXPANSION')
    await page.getByPlaceholder('ดูทำเลนิมมาน\nต่อรองสัญญาเช่า').fill('ดูทำเล 3 จุด\nเซ็นสัญญาเช่า')
    await page.getByRole('button', { name: 'ตรวจสอบ + พรีวิว' }).click()

    // Step 3: dry-run preview then confirm.
    await expect(page.getByText('พรีวิวสิ่งที่จะถูกสร้าง')).toBeVisible()
    await expect(page.getByText('Business Expansion · 2 งานเริ่มต้น')).toBeVisible()
    await page.getByRole('button', { name: 'ยืนยัน สร้างโปรเจกต์' }).click()

    await expect(page).toHaveURL(/\/projects\/[0-9a-f-]{36}$/)
    await expect(page.getByRole('heading', { name: 'E2E เปิดร้านสาขาทดสอบ' })).toBeVisible()
    await expect(page.locator('main').getByText('หาทำเลและสัญญา')).toBeVisible()
  })
})

test.describe('FR-018 excel intake', () => {
  test('download template, fill, upload through UI, confirm import', async ({ page, request }) => {
    const ExcelJS = require('exceljs')

    // Template endpoint serves a real workbook.
    const res = await request.get('/api/import/template')
    expect(res.status()).toBe(200)
    expect(res.headers()['content-type']).toContain('spreadsheetml')

    // Fill it: Project row + one workstream + one item (column order per SHEETS spec).
    const wb = new ExcelJS.Workbook()
    await wb.xlsx.load(await res.body())
    wb.getWorksheet('Project').getRow(3).values = ['PRJ-E2E-XLSX', 'E2E Excel Import']
    wb.getWorksheet('Workstreams').getRow(3).values = ['WST-E2E-XLSX', 'งานจากไฟล์', 'OPERATIONS']
    wb.getWorksheet('Items').getRow(3).values = ['WI-E2E-XLSX', 'WST-E2E-XLSX', '', 'CHECKLIST_ITEM', 'เช็คลิสต์จาก Excel', 'DONE']
    const buffer = Buffer.from(await wb.xlsx.writeBuffer())

    // Upload via the Import page inside a project context (direct URL —
    // the projects list reorders by updatedAt, so click-chaining races).
    const resolved = await (await request.get('/api/resolve?type=PROJECT&code=PRJ-B01-TRANSFORM')).json()
    await page.goto(`/projects/${resolved.id}/import`)
    await expect(page.getByText('Excel template')).toBeVisible()
    await page.getByLabel('อัปโหลดไฟล์ Excel ที่กรอกแล้ว').setInputFiles({
      name: 'filled.xlsx',
      mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      buffer,
    })
    await expect(page.getByText('Dry-run preview')).toBeVisible()
    await page.getByRole('button', { name: 'Confirm import' }).click()
    await expect(page.getByText('Imported ✓')).toBeVisible()
    await expect(page.getByText('committed transactionally')).toBeVisible()
    await expect(page.getByRole('link', { name: 'Open project' })).toBeVisible()
  })
})

test.describe('FR-020 adaptive shell', () => {
  test('many businesses: switcher scopes the shell and the choice survives a reload', async ({ page }) => {
    await page.goto('/overview')
    const switcher = page.getByRole('button', { name: 'สลับธุรกิจ' })
    await expect(switcher).toBeVisible()

    await switcher.click()
    await page.getByRole('menuitem', { name: 'Business 01' }).click()

    // Landing becomes that business's work, and the shell narrows with it.
    await expect(page.getByRole('heading', { name: 'Business 01 — Overview' })).toBeVisible()
    const workspaceSelect = page.getByLabel('Workspace', { exact: true })
    await expect(workspaceSelect.locator('option')).toHaveCount(3) // all + own + group-level
    await expect(workspaceSelect.locator('option', { hasText: 'WS-B02-MIG' })).toHaveCount(0)

    // B2 — the shell remembers the business across a full page load.
    await page.reload()
    await expect(page.getByRole('heading', { name: 'Business 01 — Overview' })).toBeVisible()

    // "ทุกธุรกิจ" returns to the read-only group roll-up.
    await switcher.click()
    await page.getByRole('menuitem', { name: 'ทุกธุรกิจ' }).click()
    await expect(page.getByRole('heading', { name: 'ภาพรวมทั้งเครือ' })).toBeVisible()
  })

  test('single business: no switcher, no structure vocabulary, straight to the work', async ({ page }) => {
    // Same app, one-business dataset: the shell is inferred from the data, so
    // the fixture is the scope payload itself (route-level, no DB mutation).
    const full = await (await page.request.get('/api/scope')).json()
    const sole = full.businesses[0]
    await page.route('**/api/scope', async (route) => {
      await route.fulfill({
        json: {
          ...full,
          businesses: [sole],
          tenants: full.tenants.filter((t) => t.id === sole.tenantId),
          workspaces: full.workspaces.filter((w) => w.businessId === sole.id),
        },
      })
    })

    await page.goto('/overview')
    // A1/A3 — lands in the business, identity is static text, no switcher.
    await expect(page.getByRole('heading', { name: `${sole.name} — Overview` })).toBeVisible()
    await expect(page.getByRole('button', { name: 'สลับธุรกิจ' })).toHaveCount(0)
    await expect(page.locator('header').getByText(sole.name)).toBeVisible()

    // Only one workspace to choose from → the selector stays out of the way.
    await expect(page.getByLabel('Workspace', { exact: true })).toHaveCount(0)
    // Structure vocabulary never reaches this owner.
    await expect(page.locator('header')).not.toContainText(/portfolio|tenant/i)
  })

  test('adding a business is offered in settings and from the switcher', async ({ page }) => {
    // The creation path itself (tenant + starter workspace + isolation) is
    // covered by tests/integration/adaptive-shell.test.js — E2E stops at the
    // affordance so the demo database stays clean across runs.
    await page.goto('/overview')
    await page.getByRole('button', { name: 'สลับธุรกิจ' }).click()
    await page.getByRole('menuitem', { name: 'เพิ่มธุรกิจ' }).click()
    // Cold-route compile on a first dev-server hit can outrun the default wait.
    await expect(page).toHaveURL(/settings/, { timeout: 30000 })

    await expect(page.getByText('เพิ่มธุรกิจใหม่ในเครือของคุณ')).toBeVisible()
    const submit = page.getByRole('button', { name: 'เพิ่มธุรกิจ' })
    await expect(submit).toBeDisabled()
    await page.getByLabel('ชื่อธุรกิจใหม่').fill('ครัวกลาง')
    await expect(submit).toBeEnabled()
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
