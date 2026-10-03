// Catalogue intake (FR-208) through the real SCM commands, queries and the
// catalogue / identity writers. [legacy] tests mirror apps/server
// fr208-inventory-catalog-intake.test.js AC-208.1..AC-208.6 with the same inputs
// and expectations (AC-209.1, the Excel workbook converter, stays at the edge:
// D-26). The last describe covers the SCM-only surface: requesterOnly, by-code and
// the lock-first commit (D-27).
import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { createHarness, rejects } from '../support/harness.js'
import { BIZ, OTHER_BIZ, TENANT, idem } from '../support/fixtures.js'

const G = {
  owner: { [BIZ]: { owner: true, domains: ['inventory'], permissions: [] } },
  manager: { [BIZ]: { owner: false, domains: ['inventory'], permissions: ['inventory.catalog.write'] } },
  member: { [BIZ]: { owner: false, domains: ['inventory'], permissions: [] } },
  noDomain: { [BIZ]: { owner: true, domains: ['commerce'], permissions: [] } },
}
let h, clockAt, category, cups
let seq = 0
const envelope = (items, correlationId = `c-${++seq}`, channel = 'REST_API') => ({ schemaVersion: '1.0', businessId: BIZ, source: { channel, correlationId }, items })

before(async () => {
  clockAt = null
  h = createHarness({ products: [], clock: () => clockAt ?? new Date() })
  category = (await run('owner', 'inventory.category.create', { businessId: BIZ, code: 'CIT-CAT', nameTh: 'เครื่องดื่ม', nameEn: 'Drinkware' })).category
  cups = (await run('owner', 'inventory.product-master.create', { businessId: BIZ, code: 'CIT-CUPS', categoryId: category.id, nameTh: 'แก้ว', nameEn: 'Cups' })).master
})
after(() => h.close())
function as(who, sub = `per-${who}`) { return h.as({ sub, grants: G[who] }) }
function run(who, action, body, targetId = null) { return h.run(as(who), action, { body, targetId, idempotencyKey: idem(action) }) }
const preview = (items, correlationId, who = 'owner', channel) => run(who, 'inventory.catalog-intake.preview', envelope(items, correlationId, channel))
const commit = (intake, who = 'owner', over = {}) => run(who, 'inventory.catalog-intake.commit', { businessId: BIZ, intakeId: intake.id, planHash: intake.planHash, ...over })
const cancel = (intake, body, who = 'owner') => run(who, 'inventory.catalog-intake.action', { action: 'CANCEL', ...body }, intake.id)
const createProduct = (code, over = {}) => run('owner', 'inventory.product.create', { businessId: BIZ, code, productMasterId: cups.id, ...over }).then((r) => r.product)
const productByCode = (code) => h.store.read((sql) => sql.get('SELECT id, code, stockPolicy, safetyStock, variantKey, name FROM Product WHERE tenantId = ? AND code = ?', TENANT, code) ?? null)
const count = (sqlText, ...args) => h.store.read((sql) => Number(sql.get(sqlText, ...args).n))
/** The intake's own audit actions, as a sorted list (one clock tick may carry several). */
const intakeAudits = (id) => h.store.read((sql) => sql.all("SELECT action FROM ScmAuditEvent WHERE entityType = 'INVENTORY_CATALOG_INTAKE' AND entityId = ?", id).map((r) => r.action).sort())

describe('[legacy] FR-208 catalogue intake pipeline', () => {
  test('AC-208.1 — a preview resolves before it plans a create, persists the plan, and writes no catalogue row', async () => {
    const existing = await createProduct('CIT-CUP-BLK', { name: 'Cup black' })
    await run('owner', 'inventory.identifier.add', { businessId: BIZ, kind: 'GTIN', value: '4006381333931' }, existing.id)
    const productsBefore = await count('SELECT COUNT(*) AS n FROM Product WHERE businessId = ?', BIZ)

    const { replayed, intake } = await preview([
      { sku: { code: 'CIT-CUP-BLACK', name: 'Cup black' }, master: { code: 'CIT-CUPS' }, identifiers: [{ kind: 'BARCODE', value: '4006381333931' }, { kind: 'SUPPLIER_CODE', value: 'CIT-ACME-1' }], unitConversions: [{ unit: 'BOX12', factor: 12 }] },
      { sku: { code: 'CIT-CUP-RED', name: 'Cup red' }, master: { code: 'CIT-CUPS' }, identifiers: [{ kind: 'GTIN', value: '036000291452' }] },
      { sku: { code: 'CIT-JAR-1', name: 'Jar' }, master: { code: 'CIT-JARS', categoryCode: 'CIT-CAT', nameTh: 'โหล', nameEn: 'Jars', variantAxes: ['size'] }, identifiers: [] },
    ], 'ac-1', 'manager')

    assert.equal(replayed, false)
    assert.deepEqual([intake.status, intake.committable, intake.itemCount, intake.sourceChannel, intake.sourceCorrelationId], ['PREVIEWED', false, 3, 'REST_API', 'ac-1'])
    assert.match(intake.code, /^CIT-[0-9A-F]{8}$/)
    assert.match(intake.planHash, /^[a-f0-9]{64}$/)
    assert.deepEqual(intake.plan.items.map((i) => i.decision), ['MATCH', 'CREATE', 'INVALID'])
    assert.deepEqual([intake.plan.items[0].matchedBy, intake.plan.items[0].product.id, intake.plan.items[0].product.code], ['IDENTIFIER', existing.id, 'CIT-CUP-BLK'])
    assert.deepEqual(intake.plan.items[2].issues.map((i) => i.code), ['INVENTORY_VARIANT_AXES_INCOMPLETE'])
    assert.equal(await count('SELECT COUNT(*) AS n FROM Product WHERE businessId = ?', BIZ), productsBefore)
    assert.equal(await count("SELECT COUNT(*) AS n FROM ProductMaster WHERE code = 'CIT-JARS'"), 0)
    assert.deepEqual(await intakeAudits(intake.id), ['INVENTORY_CATALOG_INTAKE_PREVIEWED'])

    // Not committable: nothing is applied.
    const refused = await rejects(commit(intake), { status: 409, code: 'INVENTORY_CATALOG_INTAKE_NOT_COMMITTABLE' })
    assert.deepEqual(refused.details, [{ ref: '3', decision: 'INVALID', codes: ['INVENTORY_VARIANT_AXES_INCOMPLETE'] }])
  })

  test('AC-208.2 — a commit applies exactly the plan in one unit of work: new master, new SKU, additions to the matched SKU', async () => {
    const items = [
      { sku: { code: 'CIT-CUP-BLACK', name: 'Cup black' }, master: { code: 'CIT-CUPS' }, identifiers: [{ kind: 'GTIN', value: '4006381333931' }, { kind: 'SUPPLIER_CODE', value: 'CIT-ACME-1', unit: 'BOX12' }], unitConversions: [{ unit: 'BOX12', factor: 12 }] },
      { sku: { code: 'CIT-CUP-RED', name: 'Cup red' }, master: { code: 'CIT-CUPS' }, identifiers: [{ kind: 'GTIN', value: '036000291452' }], unitConversions: [{ unit: 'BOX6', factor: 6 }] },
      { sku: { code: 'CIT-JAR-S', name: 'Jar S', variant: { size: 'S' } }, master: { code: 'CIT-JARS', categoryCode: 'CIT-CAT', nameTh: 'โหล', nameEn: 'Jars', variantAxes: ['size'] } },
      { sku: { code: 'CIT-JAR-L', name: 'Jar L', variant: { size: 'L' } }, master: { code: 'CIT-JARS' } },
      { sku: { code: 'CIT-ENGRAVE' }, master: { code: 'CIT-SVC', categoryCode: 'CIT-CAT', nameTh: 'สลักชื่อ', nameEn: 'Engraving', nature: 'SERVICE' } },
    ]
    const { intake } = await preview(items, 'ac-2', 'manager')
    assert.equal(intake.committable, true)
    assert.deepEqual([intake.plan.counts.total, intake.plan.counts.create, intake.plan.counts.match, intake.plan.counts.createMasters], [5, 4, 1, 2])

    await rejects(commit(intake, 'owner', { planHash: 'f'.repeat(64) }), { status: 409, code: 'INVENTORY_CATALOG_INTAKE_PLAN_STALE' })
    await rejects(commit(intake, 'member'), { status: 404 })

    const { intake: committed, replayed } = await commit(intake, 'manager')
    assert.deepEqual([replayed, committed.status, committed.version], [false, 'COMMITTED', intake.version + 1])
    assert.ok(committed.committedAt)
    assert.deepEqual(committed.result.created.map((r) => r.code), ['CIT-CUP-RED', 'CIT-JAR-S', 'CIT-JAR-L', 'CIT-ENGRAVE'])
    assert.deepEqual(committed.result.matched.map((r) => [r.code, r.productCode, r.matchedBy, r.additions]), [['CIT-CUP-BLACK', 'CIT-CUP-BLK', 'IDENTIFIER', 2]])
    assert.deepEqual(committed.result.mastersCreated.map((m) => m.code), ['CIT-JARS', 'CIT-SVC'])

    const black = await productByCode('CIT-CUP-BLK')
    assert.equal(await productByCode('CIT-CUP-BLACK'), null)
    const identifiers = (await h.bus.queries.identifiers(as('member'), black.id, {})).identifiers
    assert.deepEqual(identifiers.map((i) => [i.kind, i.value, i.unit]), [['GTIN', '4006381333931', null], ['SUPPLIER_CODE', 'CIT-ACME-1', 'BOX12']])
    assert.deepEqual((await h.bus.queries.unitConversions(as('member'), black.id, {})).conversions.map((c) => [c.unit, c.factor]), [['BOX12', 12]])
    const red = await productByCode('CIT-CUP-RED')
    assert.deepEqual([red.stockPolicy, red.name], ['TRACKED', 'Cup red'])
    assert.equal((await productByCode('CIT-JAR-L')).variantKey, 'size=l')
    const engrave = await productByCode('CIT-ENGRAVE')
    assert.deepEqual([engrave.stockPolicy, Number(engrave.safetyStock)], ['SERVICE', 0])
    // Each writer kept its own audit row, and the intake has its own.
    const createdIds = committed.result.created.map((r) => r.productId)
    assert.equal(await count(`SELECT COUNT(*) AS n FROM ScmAuditEvent WHERE entityType = 'PRODUCT' AND action = 'PRODUCT_CREATED' AND entityId IN (${createdIds.map(() => '?').join(',')})`, ...createdIds), 4)
    assert.deepEqual(await intakeAudits(intake.id), ['INVENTORY_CATALOG_INTAKE_COMMITTED', 'INVENTORY_CATALOG_INTAKE_PREVIEWED'])

    // Replays: commit again and preview again return the committed row, write nothing.
    const productsNow = await count('SELECT COUNT(*) AS n FROM Product')
    const again = await commit(intake)
    assert.deepEqual([again.replayed, again.intake.status], [true, 'COMMITTED'])
    const previewAgain = await preview(items, 'ac-2')
    assert.deepEqual([previewAgain.replayed, previewAgain.intake.id, previewAgain.intake.status], [true, intake.id, 'COMMITTED'])
    assert.equal(await count('SELECT COUNT(*) AS n FROM Product'), productsNow)
    await rejects(preview([{ sku: { code: 'CIT-DIFF' }, master: { code: 'CIT-CUPS' } }], 'ac-2'), { status: 409, code: 'INVENTORY_CATALOG_INTAKE_CORRELATION_REUSED' })

    // The same file previewed after the commit now resolves every row to what exists.
    const { intake: second } = await preview(items, 'ac-2-again')
    assert.deepEqual(second.plan.items.map((i) => i.decision), ['UNCHANGED', 'UNCHANGED', 'UNCHANGED', 'UNCHANGED', 'UNCHANGED'])
  })

  test('AC-208.3 — a plan that changed after the preview is refused, and a re-preview recomputes it', async () => {
    const items = [{ sku: { code: 'CIT-STALE-1', name: 'Stale' }, master: { code: 'CIT-CUPS' }, identifiers: [{ kind: 'BARCODE', value: 'CIT-STALE-BAR' }] }]
    const { intake } = await preview(items, 'ac-3')
    assert.equal(intake.plan.items[0].decision, 'CREATE')
    // Someone creates the SKU by hand in between.
    await createProduct('CIT-STALE-1', { name: 'Stale' })
    await rejects(commit(intake), { status: 409, code: 'INVENTORY_CATALOG_INTAKE_PLAN_STALE' })
    const { replayed, intake: fresh } = await preview(items, 'ac-3')
    assert.equal(replayed, false)
    assert.deepEqual([fresh.id, fresh.version], [intake.id, intake.version + 1])
    assert.deepEqual([fresh.plan.items[0].decision, fresh.plan.items[0].matchedBy], ['MATCH', 'CODE'])
    assert.notEqual(fresh.planHash, intake.planHash)
    assert.deepEqual(await intakeAudits(intake.id), ['INVENTORY_CATALOG_INTAKE_PREVIEWED', 'INVENTORY_CATALOG_INTAKE_REPREVIEWED'])
    const { intake: done } = await commit(fresh)
    assert.deepEqual(done.result.matched.map((r) => [r.code, r.additions]), [['CIT-STALE-1', 1]])
  })

  test('AC-208.4 — a code taken in another Business of the Tenant after the preview makes the plan stale, and nothing is written', async () => {
    const items = [
      { sku: { code: 'CIT-RB-1', name: 'Stale one' }, master: { code: 'CIT-CUPS' } },
      { sku: { code: 'CIT-RB-2', name: 'Stale two' }, master: { code: 'CIT-CUPS' } },
    ]
    const { intake } = await preview(items, 'ac-4')
    assert.equal(intake.committable, true)
    // Codes are unique per Tenant: the other Business taking one changes what the re-plan decides.
    const at = new Date().toISOString()
    await h.store.transaction((sql) => {
      sql.run("INSERT INTO InventoryCategory (id, code, tenantId, businessId, nameTh, nameEn, createdAt, updatedAt) VALUES ('cit-other-cat', 'CIT-OTHER-CAT', ?, ?, 'x', 'x', ?, ?)", TENANT, OTHER_BIZ, at, at)
      sql.run("INSERT INTO ProductMaster (id, code, tenantId, businessId, categoryId, nameTh, nameEn, createdAt, updatedAt) VALUES ('cit-other-pm', 'CIT-OTHER-PM', ?, ?, 'cit-other-cat', 'x', 'x', ?, ?)", TENANT, OTHER_BIZ, at, at)
      sql.run("INSERT INTO Product (id, code, tenantId, businessId, productMasterId, createdAt, updatedAt) VALUES ('cit-other-rb2', 'CIT-RB-2', ?, ?, 'cit-other-pm', ?, ?)", TENANT, OTHER_BIZ, at, at)
    })
    await rejects(commit(intake), { status: 409, code: 'INVENTORY_CATALOG_INTAKE_PLAN_STALE' })
    assert.equal(await count("SELECT COUNT(*) AS n FROM Product WHERE businessId = ? AND code IN ('CIT-RB-1', 'CIT-RB-2')", BIZ), 0)
    assert.equal((await h.bus.queries.catalogIntake(as('member'), intake.id)).intake.status, 'PREVIEWED')
    const { intake: replanned } = await preview(items, 'ac-4')
    assert.deepEqual(replanned.plan.items[1].issues.map((i) => i.code), ['INTAKE_CODE_TAKEN_IN_TENANT'])
  })

  test('AC-208.5 — expiry, cancellation, authority and reads', async () => {
    clockAt = new Date('2026-01-01T00:00:00Z')
    const { intake } = await preview([{ sku: { code: 'CIT-EXP-1' }, master: { code: 'CIT-CUPS' } }], 'ac-5')
    assert.equal(intake.expiresAt, '2026-01-02T00:00:00.000Z')
    const line = await preview([{ sku: { code: 'CIT-LINE-1' }, master: { code: 'CIT-CUPS' } }], 'line:acc:evt', 'owner', 'LINE_OA')
    assert.equal(line.intake.expiresAt, '2026-01-01T00:30:00.000Z')
    clockAt = new Date('2026-01-02T00:00:01Z')
    await rejects(commit(intake), { status: 409, code: 'INVENTORY_CATALOG_INTAKE_EXPIRED' })
    clockAt = null

    const { intake: toCancel } = await preview([{ sku: { code: 'CIT-CAN-1' }, master: { code: 'CIT-CUPS' } }], 'ac-5b')
    await rejects(cancel(toCancel, { version: toCancel.version + 5 }), { status: 409, code: 'INVENTORY_CATALOG_INTAKE_VERSION_CONFLICT' })
    const { intake: cancelled } = await cancel(toCancel, { version: toCancel.version }, 'manager')
    assert.equal(cancelled.status, 'CANCELLED')
    await rejects(commit(toCancel), { code: 'INVENTORY_CATALOG_INTAKE_CANCELLED' })
    await rejects(cancel(toCancel, { version: cancelled.version }), { status: 409, code: 'INVENTORY_CATALOG_INTAKE_CANCELLED' })

    await rejects(preview([{ sku: { code: 'X' }, master: { code: 'CIT-CUPS' } }], undefined, 'member'), { status: 404 })
    await rejects(run('owner', 'inventory.catalog-intake.preview', { ...envelope([{}]), businessId: OTHER_BIZ }), { status: 404 })
    await assert.rejects(run('owner', 'inventory.catalog-intake.preview', { schemaVersion: '2.0', businessId: BIZ, source: { channel: 'REST_API', correlationId: 'x' }, items: [{}] }), { name: 'ZodError' })
    const got = (await h.bus.queries.catalogIntake(as('member'), intake.id)).intake
    assert.deepEqual([got.id, got.plan.counts.total], [intake.id, 1])
    const { intakes } = await h.bus.queries.catalogIntakes(as('member'), { businessId: BIZ })
    assert.ok(intakes.length >= 5)
    assert.ok(!('planJson' in intakes[0]) && !('plan' in intakes[0]))
    await rejects(h.bus.queries.catalogIntakes(as('noDomain'), { businessId: BIZ }), { status: 404 })
    await rejects(h.bus.queries.catalogIntake(as('noDomain'), intake.id), { status: 404 })
  })

  test('AC-208.6 — the intake matches a merged duplicate\'s code to its survivor', async () => {
    const keep = await createProduct('CIT-KEEP', { name: 'Keeper' })
    const dup = await createProduct('CIT-DUP', { name: 'Dup' })
    await run('owner', 'inventory.product.action', { action: 'MERGE', version: 1, into: keep.id }, dup.id)
    const { intake } = await preview([{ sku: { code: 'CIT-DUP' }, master: { code: 'CIT-CUPS' }, identifiers: [{ kind: 'BARCODE', value: 'CIT-MERGED-BAR' }] }], 'ac-6')
    assert.deepEqual([intake.plan.items[0].decision, intake.plan.items[0].product.id, intake.plan.items[0].product.code], ['MATCH', keep.id, 'CIT-KEEP'])
    assert.ok(intake.plan.items[0].warnings.map((w) => w.code).includes('INTAKE_REDIRECTED_FROM_MERGED'))
    await commit(intake)
    assert.ok((await h.bus.queries.identifiers(as('member'), keep.id, {})).identifiers.map((i) => i.value).includes('CIT-MERGED-BAR'))
  })
})

describe('SCM surface: requesterOnly, by-code, lock-first commit (D-27)', () => {
  test('requesterOnly refuses anyone but the actor who previewed, as the LINE confirmation does', async () => {
    const lineUser = h.as({ sub: 'per-line-user', grants: G.owner })
    const other = h.as({ sub: 'per-other-owner', grants: G.owner })
    const { intake } = await h.run(lineUser, 'inventory.catalog-intake.preview', { body: envelope([{ sku: { code: 'CIT-LN-1' }, master: { code: 'CIT-CUPS' } }], 'line:acc:evt-2', 'LINE_OA') })
    assert.equal(intake.requestedById, 'per-line-user')
    const found = (await h.bus.queries.catalogIntakeByCode(other, { businessId: BIZ, code: intake.code.toLowerCase() })).intake
    assert.equal(found.id, intake.id)
    await rejects(h.bus.queries.catalogIntakeByCode(as('member'), { businessId: BIZ, code: intake.code }), { status: 404 })
    await rejects(h.bus.queries.catalogIntakeByCode(other, { businessId: BIZ, code: 'CIT-00000000' }), { status: 404 })
    // A code held by another Business of the Tenant is not found from this one.
    const at = new Date().toISOString()
    await h.store.transaction((sql) => sql.run(
      "INSERT INTO InventoryCatalogIntake (id, code, tenantId, businessId, sourceChannel, sourceCorrelationId, payloadSha256, normalizedEnvelopeJson, planJson, planHash, expiresAt, createdAt, updatedAt) VALUES ('other-intake', 'CIT-0THER000', ?, ?, 'REST_API', 'x', 'x', '{}', '{}', 'x', ?, ?, ?)",
      TENANT, OTHER_BIZ, at, at, at,
    ))
    await rejects(h.bus.queries.catalogIntakeByCode(other, { businessId: BIZ, code: 'CIT-0THER000' }), { status: 404 })
    const body = { businessId: BIZ, intakeId: intake.id, planHash: intake.planHash, requesterOnly: true }
    await rejects(h.run(other, 'inventory.catalog-intake.commit', { body }), { status: 404, code: 'SCM_SCOPE_NOT_FOUND' })
    await rejects(h.run(other, 'inventory.catalog-intake.action', { targetId: intake.id, body: { action: 'CANCEL', version: intake.version, requesterOnly: true } }), { status: 404 })
    // Without the flag any Inventory writer of the Business may commit (the web console rule).
    const { intake: done } = await h.run(lineUser, 'inventory.catalog-intake.commit', { body })
    assert.equal(done.status, 'COMMITTED')
    await rejects(h.run(lineUser, 'inventory.catalog-intake.action', { targetId: intake.id, body: { action: 'CANCEL', version: done.version, businessId: BIZ } }), { status: 409, code: 'INVENTORY_CATALOG_INTAKE_ALREADY_COMMITTED' })
    await rejects(h.run(lineUser, 'inventory.catalog-intake.action', { targetId: intake.id, body: { action: 'CANCEL', version: done.version, businessId: OTHER_BIZ } }), { status: 404 })
  })

  test('a second commit of the same intake under a new key replays the committed row and writes nothing', async () => {
    const { intake } = await preview([{ sku: { code: 'CIT-TWICE' }, master: { code: 'CIT-CUPS' } }], 'twice')
    const first = await commit(intake)
    const products = await count('SELECT COUNT(*) AS n FROM Product')
    const second = await commit(intake, 'manager')
    assert.deepEqual([first.replayed, second.replayed, second.intake.id, second.intake.version], [false, true, intake.id, first.intake.version])
    assert.equal(await count('SELECT COUNT(*) AS n FROM Product'), products)
    await rejects(commit(intake, 'owner', { planHash: 'e'.repeat(64) }), { status: 409, code: 'INVENTORY_CATALOG_INTAKE_PLAN_STALE' })
  })
})
