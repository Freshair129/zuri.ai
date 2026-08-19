const { test, expect } = require('@playwright/test')

// E2E smoke: every major route renders with seeded data (npm run db:seed first).

// @req FR-044 — protected routes require the explicit Business Routing step.
// @spec ADR-015, SDD-022
// @tested tests/e2e/smoke.spec.js
async function enterBusiness(page, name = 'Business 01') {
  await page.goto('/login')
  await page.getByRole('button', { name: /demo login/i }).click()
  await page.getByRole('button', { name: new RegExp(`Open Business ${name}`) }).click()
  await expect(page).toHaveURL(/overview/)
}

test.describe('universal routes', () => {
  test.beforeEach(async ({ page }) => enterBusiness(page))
  // The seed has four businesses, so the landing is the group roll-up (FR-020).
  test.skip('overview renders the group roll-up with a card per business (superseded by FR-041)', async ({ page }) => {
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
    const projectLink = page.getByRole('link', { name: /Business 01.*Transformation Program/ }).first()
    await expect(projectLink).toBeVisible()
    await projectLink.click()
    await expect(page.getByRole('heading', { name: /Transformation Program/ })).toBeVisible()
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
    // @req FR-014 — this test asserted only the heading, so an audit table
    // rendering zero rows passed it: the same "empty is indistinguishable from
    // broken" failure the page itself was reviewed for, sitting in its own test.
    // `/api/audit` now returns { events, limit, truncated }, and a page still
    // reading the old array shape would render the empty state below.
    //
    // It writes its own event first. The seed populates the database with raw
    // upserts rather than through the services, so a fresh e2e database holds NO
    // AuditEvent rows — asserting on rows without creating one made the result
    // depend on which tests had already run.
    const scope = await (await page.request.get('/api/scope')).json()
    const workspace = (scope.workspaces || []).find((w) => w.code === 'WS-B01-MIG')
    expect(workspace, 'seeded Business workspace').toBeTruthy()
    const created = await page.request.post('/api/projects', {
      data: { workspaceId: workspace.id, name: 'Audit probe', businessId: workspace.businessId },
    })
    expect(created.ok()).toBe(true)

    await page.goto('/audit')
    await expect(page.getByRole('heading', { name: 'Audit Log' })).toBeVisible()
    await expect(page.getByText('No audit events')).toHaveCount(0)
    await expect(page.locator('tbody tr').first()).toBeVisible()
  })

  test('backup page has export and import preview', async ({ page }) => {
    await page.goto('/backup')
    await expect(page.getByRole('button', { name: /Download snapshot/i })).toBeVisible()
    await expect(page.getByRole('button', { name: /Preview/i })).toBeVisible()
  })

  test('command palette opens with Ctrl+K and navigates', async ({ page }) => {
    await page.goto('/overview')
    await page.getByRole('button', { name: /Open command palette/i }).click()
    const input = page.getByLabel('Command palette search')
    await expect(input).toBeVisible()
    // "Overview" matching nothing is not an accident of the fixture — it is
    // FR-060 and ADR-036 D1 holding: the word belongs to `/overview`, whose
    // palette entry reads "Business Home · Dashboard", so no label contains it.
    await input.fill('Overview')
    await expect(page.getByText(/No matches for/i)).toBeVisible()
    // Queries the domain, not the page. Development's first entry was relabelled
    // `Dashboard` on 2026-08-19 (ADR-036 D1), so "Projects" no longer appears in
    // any palette label — the palette builds them as `${domain} · ${item}`.
    // "Dashboard" would be the wrong query too: every domain now has one and
    // Business Home sorts first, so Enter would land on `/overview`.
    await input.fill('Development')
    await page.keyboard.press('Enter')
    await expect(page).toHaveURL(/projects/)
  })
})

test.describe('seven execution views', () => {
  test.beforeEach(async ({ page }) => enterBusiness(page))
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
      await expect(page.getByRole('heading', { name: label, exact: true })).toBeVisible()
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
  test.beforeEach(async ({ page }) => enterBusiness(page))
  test('human form builds PlanEnvelope JSON and sends it through dry-run', async ({ page }) => {
    const resolved = await (await page.request.get('/api/resolve?type=PROJECT&code=PRJ-B01-TRANSFORM')).json()
    await page.goto(`/projects/${resolved.id}/import`)
    await page.getByRole('button', { name: /สร้างแผนด้วยฟอร์ม/i }).first().click()

    const dialog = page.getByRole('dialog', { name: 'Create plan from UI' })
    await expect(dialog).toBeVisible()
    await dialog.getByLabel('ชื่อหรือเป้าหมายโปรเจกต์').fill('E2E Human Plan Builder')
    await dialog.getByLabel('รายละเอียดแผน').fill('สร้างจาก popup แล้วส่งเข้า shared PlanEnvelope pipeline')
    await dialog.getByLabel('ชื่อสายงานที่ 1').fill('เตรียมเปิดสาขา')
    await dialog.getByLabel('ลักษณะงานของสายงานที่ 1').selectOption('BUSINESS_EXPANSION')
    await dialog.getByLabel('งานเริ่มต้นของสายงานที่ 1').fill('สำรวจทำเล\nสรุปข้อเสนอ')
    await dialog.getByRole('button', { name: 'สร้าง Plan และตรวจสอบ' }).click()

    await expect(dialog).not.toBeVisible()
    await expect(page.getByLabel('Plan envelope JSON')).toHaveValue(/zuri-v2 UI plan builder/)
    await expect(page.getByLabel('Plan envelope JSON')).toHaveValue(/เตรียมเปิดสาขา/)
    await expect(page.getByText('Dry-run preview')).toBeVisible()
    await page.getByRole('button', { name: 'Confirm import' }).click()
    await expect(page.getByText('Imported ✓')).toBeVisible()
    await expect(page.getByText('E2E Human Plan Builder')).toBeVisible()
  })

  test('dry run previews and rejects bad plans', async ({ page }) => {
    const resolved = await (await page.request.get('/api/resolve?type=PROJECT&code=PRJ-B01-TRANSFORM')).json()
    await page.goto(`/projects/${resolved.id}/import`)
    const textarea = page.getByLabel('Plan envelope JSON')
    await textarea.fill(JSON.stringify({ schemaVersion: '1.0', project: { code: 'X', name: 'X' }, workstreams: [{ code: 'W', name: 'W', executionMode: 'NOT_A_MODE', progressStrategy: 'TASK_WEIGHT' }] }))
    await page.getByRole('button', { name: /Validate \+ dry run/i }).click()
    await expect(page.getByText(/Validation errors/i)).toBeVisible()
  })
})

test.describe('FR-017 project wizard', () => {
  test.beforeEach(async ({ page }) => enterBusiness(page))
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
  test.beforeEach(async ({ page }) => enterBusiness(page))
  test('download template, fill, upload through UI, confirm import', async ({ page }) => {
    const ExcelJS = require('exceljs')
    const xlsxProjectCode = `PRJ-E2E-XLSX-${Date.now()}`

    // Template endpoint serves a real workbook.
    const res = await page.request.get('/api/import/template')
    expect(res.status()).toBe(200)
    expect(res.headers()['content-type']).toContain('spreadsheetml')

    // Fill it: Project row + one workstream + one item (column order per SHEETS spec).
    const wb = new ExcelJS.Workbook()
    await wb.xlsx.load(await res.body())
    wb.getWorksheet('Project').getRow(3).values = [xlsxProjectCode, 'E2E Excel Import']
    wb.getWorksheet('Workstreams').getRow(3).values = ['WST-E2E-XLSX', 'งานจากไฟล์', 'OPERATIONS']
    wb.getWorksheet('Items').getRow(3).values = ['WI-E2E-XLSX', 'WST-E2E-XLSX', '', 'CHECKLIST_ITEM', 'เช็คลิสต์จาก Excel', 'DONE']
    const buffer = Buffer.from(await wb.xlsx.writeBuffer())

    // Upload via the Import page inside a project context (direct URL —
    // the projects list reorders by updatedAt, so click-chaining races).
    const resolved = await (await page.request.get('/api/resolve?type=PROJECT&code=PRJ-B01-TRANSFORM')).json()
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
  test.skip('many businesses: switcher scopes the shell and the choice survives a reload (superseded by FR-041)', async ({ page }) => {
    await page.goto('/overview')
    const switcher = page.getByRole('button', { name: 'สลับธุรกิจ' })
    await expect(switcher).toBeVisible()

    await switcher.click()
    await page.getByRole('menuitem', { name: 'Business 01' }).click()

    // Landing becomes that business's work, and the shell narrows with it.
    await expect(page.getByRole('heading', { name: 'Business 01 — Command Center' })).toBeVisible()
    const workspaceSelect = page.getByLabel('Workspace', { exact: true })
    await expect(workspaceSelect.locator('option')).toHaveCount(3) // all + own + group-level
    await expect(workspaceSelect.locator('option', { hasText: 'WS-B02-MIG' })).toHaveCount(0)

    // B2 — the shell remembers the business across a full page load.
    await page.reload()
    await expect(page.getByRole('heading', { name: 'Business 01 — Command Center' })).toBeVisible()

    // "ทุกธุรกิจ" returns to the read-only group roll-up.
    await switcher.click()
    await page.getByRole('menuitem', { name: 'ทุกธุรกิจ' }).click()
    await expect(page.getByRole('heading', { name: 'ภาพรวมทั้งเครือ' })).toBeVisible()
  })

  // Superseded by FR-044: a single Business still passes through explicit Routing,
  // and the approved context bar keeps ancestry labels visible in the shell.
  test.skip('single business: no switcher, no structure vocabulary, straight to the work', async ({ page }) => {
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
    // FR-044 keeps the routing boundary observable even for one Business.
    await expect(page).toHaveURL(/\/businesses$/)
    await page.getByRole('button', { name: new RegExp(`Open Business ${sole.name}`) }).click()
    // A1/A3 — after explicit selection, identity is static text, no switcher.
    await expect(page.getByRole('heading', { name: `${sole.name} — Command Center` })).toBeVisible()
    await expect(page.getByRole('button', { name: 'สลับธุรกิจ' })).toHaveCount(0)
    await expect(page.locator('header').getByText(sole.name)).toBeVisible()

    // Only one workspace to choose from → the selector stays out of the way.
    await expect(page.getByLabel('Workspace', { exact: true })).toHaveCount(0)
    // Structure vocabulary never reaches this owner.
    await expect(page.locator('header')).not.toContainText(/portfolio|tenant/i)
  })

  // Superseded by FR-044/ADR-015: Business selection is outside BusinessShell;
  // the old in-shell switcher is no longer the entry contract.
  test.skip('adding a business is offered in settings and from the switcher', async ({ page }) => {
    // The creation path itself (tenant + starter workspace + isolation) is
    // covered by tests/integration/adaptive-shell.test.js — E2E stops at the
    // affordance so the demo database stays clean across runs.
    await enterBusiness(page)
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

test.describe('FR-019 enterprise API', () => {
  // Backend-first surface: no UI, so this exercises it the way an integrator
  // would — HTTP only, against the running server.
  //
  // @req FR-065 — two changes here, and they are different in kind:
  //
  //   * The integrator now authenticates. An unauthenticated import was never a
  //     declared capability of FR-019; it was the absence of a guard, and
  //     SEC-008 says identity fails closed.
  //   * The target moved from `WS-PLATFORM` to `WS-B01-MIG`. WS-PLATFORM is
  //     PORTFOLIO-scoped, and FR-065 refuses a target above Business because no
  //     principal in this system can hold authority there. This test was the
  //     live proof that the path was reachable, so it had to move — what it is
  //     actually about (upsert by customer core id, then resolve it back) is
  //     unchanged and still asserted.
  const plan = (overrides = {}, workspaceCode = 'WS-B01-MIG') => ({
    schemaVersion: '1.1',
    generatedBy: 'e2e-erp',
    scope: { workspaceCode },
    project: {
      code: 'PRJ-E2E-ENTERPRISE',
      name: 'E2E enterprise rollout',
      status: 'ACTIVE',
      externalRefs: [{ system: 'E2E_SAP', id: 'PS-E2E-88421' }],
      ...overrides,
    },
    workstreams: [
      {
        code: 'WST-E2E-ENTERPRISE',
        name: 'Rollout',
        executionMode: 'OPERATIONS',
        progressStrategy: 'SLA_SCORE',
        items: [{ code: 'WI-E2E-ENTERPRISE', subtype: 'CHECKLIST_ITEM', title: 'Install POS', status: 'PLANNED' }],
      },
    ],
  })

  test('publishes an OpenAPI contract generated from the live schema', async ({ request }) => {
    const res = await request.get('/api/docs')
    expect(res.status()).toBe(200)
    const doc = await res.json()
    expect(doc.openapi).toMatch(/^3\./)
    expect(doc.paths['/api/import/commit']).toBeTruthy()
    expect(doc.components.schemas.PlanEnvelope.properties.project.properties.externalRefs).toBeTruthy()
  })

  // @req FR-065 — the route-level half of the change, over real HTTP. The
  // pipeline is pinned in tests/integration/import-target-authorization.test.js;
  // what only an end-to-end request can prove is that the handler resolves a
  // viewer at all, rather than reading `workspaceId` out of the body and going.
  test('refuses an unauthenticated import instead of writing', async ({ request }) => {
    const dry = await request.post('/api/import/dry-run', { data: { plan: plan() } })
    expect(dry.status()).toBe(401)

    const commit = await request.post('/api/import/commit', { data: { plan: plan() } })
    expect(commit.status()).toBe(401)

    // The upload surface is the third route into the same pipeline, and it had
    // its own catch-all that would have reported a 401 as a 500.
    const xlsx = await request.post('/api/import/xlsx', { multipart: { workspaceId: 'x' } })
    expect(xlsx.status()).toBe(401)
  })

  test('refuses an import above Business, naming the authority that does not exist', async ({ request }) => {
    await request.post('/api/session/demo', { maxRedirects: 0 })
    // WS-PLATFORM is PORTFOLIO-scoped. No principal can hold authority there, so
    // this is refused for everyone — and says so, rather than denying silently.
    const res = await request.post('/api/import/dry-run', {
      data: { plan: plan({}, 'WS-PLATFORM') },
    })
    const body = await res.json()
    expect(body.valid).toBe(false)
    expect(body.errors.join(' ')).toContain('no authority above Business')
  })

  test('upserts by the customer core id and resolves it back', async ({ request }) => {
    await request.post('/api/session/demo', { maxRedirects: 0 })
    const dry = await (await request.post('/api/import/dry-run', { data: { plan: plan() } })).json()
    expect(dry.valid).toBe(true)

    const commit = await (await request.post('/api/import/commit', { data: { plan: plan() } })).json()
    expect(commit.committed).toBe(true)

    // The customer asks with its own id and gets our internal id back.
    const resolved = await (await request.get('/api/resolve?system=E2E_SAP&value=PS-E2E-88421')).json()
    expect(resolved.type).toBe('PROJECT')
    expect(resolved.id).toBe(commit.projectId)
    expect(resolved.code).toBe('PRJ-E2E-ENTERPRISE')

    // Re-sending under a different code of theirs updates the same record.
    const renamed = plan({ code: 'PRJ-E2E-THEIR-CODE', name: 'E2E enterprise rollout v2' })
    const second = await (await request.post('/api/import/commit', { data: { plan: renamed } })).json()
    expect(second.committed).toBe(true)
    expect(second.projectId).toBe(commit.projectId)
    expect(second.projectCode).toBe('PRJ-E2E-ENTERPRISE') // our namespace is untouched
  })

  test('rejects an unmapped external id instead of inventing one', async ({ request }) => {
    await request.post('/api/session/demo', { maxRedirects: 0 })
    const res = await request.get('/api/resolve?system=E2E_SAP&value=DOES-NOT-EXIST')
    expect(res.status()).toBe(404)
    expect((await res.json()).error).toMatch(/not mapped/)

    // Half a lookup key is a client error, not a silent guess.
    const partial = await request.get('/api/resolve?system=E2E_SAP')
    expect(partial.status()).toBe(400)
  })
})

test.describe('responsive smoke', () => {
  test.beforeEach(async ({ page }) => enterBusiness(page))
  test('no horizontal page overflow at mobile viewport', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 })
    await page.goto('/overview')
    await page.waitForLoadState('networkidle')
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
    expect(overflow).toBeLessThanOrEqual(1)
  })
})
