// Shelf-life (FR-179), catalogue hygiene (FR-206) and replenishment (FR-207)
// through the real SCM commands, queries and ledger. [legacy] tests mirror
// apps/server fr179-shelf-life-guard.test.js AC-179.1 / AC-179.5 and
// fr201-inventory-sku-governance.test.js AC-206.1 / AC-207.1 with the same
// inputs and expectations; the issue-side guard (AC-179.2..4) is the stock
// writer's and is covered in inventory-stock.test.js.
import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { createHarness, rejects } from '../support/harness.js'
import { BIZ, OTHER_BIZ, TENANT, idem } from '../support/fixtures.js'

const DAY = 86_400_000
const NOW = new Date(Date.UTC(2026, 8, 10))
const daysAgo = (n) => new Date(NOW.getTime() - n * DAY).toISOString()
const G = {
  owner: { [BIZ]: { owner: true, domains: ['inventory'], permissions: [] } },
  manager: { [BIZ]: { owner: false, domains: ['inventory'], permissions: ['inventory.catalog.write'] } },
  member: { [BIZ]: { owner: false, domains: ['inventory'], permissions: [] } },
  noDomain: { [BIZ]: { owner: true, domains: ['commerce'], permissions: [] } },
}
let h, clockAt, category, master
before(async () => {
  clockAt = NOW
  h = createHarness({ products: [], clock: () => clockAt })
  category = (await run('owner', 'inventory.category.create', { businessId: BIZ, code: 'shelf-cat', nameTh: 'ไอที', nameEn: 'Tech' })).category
  master = (await run('owner', 'inventory.product-master.create', { businessId: BIZ, code: 'PM-PB', categoryId: category.id, nameTh: 'พาวเวอร์แบงก์', nameEn: 'Power bank' })).master
})
after(() => h.close())
function as(who) { return h.as({ sub: `per-${who}`, grants: G[who] }) }
function run(who, action, body, targetId = null) { return h.run(as(who), action, { body, targetId, idempotencyKey: idem(action) }) }
const sku = (code, over = {}) => run('owner', 'inventory.product.create', { businessId: BIZ, code, productMasterId: master.id, ...over }).then((r) => r.product)
const lot = (productId, code, manufacturedAt) => run('owner', 'inventory.lot.create', { businessId: BIZ, productId, code, manufacturedAt }).then((r) => r.lot)
const receive = (productId, quantity, over = {}) => run('owner', 'inventory.movement.record', { businessId: BIZ, productId, kind: 'RECEIPT', quantity, ...over })
const audits = (entityType, entityId) => h.store.read((sql) => sql.all('SELECT action, payloadJson FROM ScmAuditEvent WHERE entityType = ? AND entityId = ? ORDER BY occurredAt, id', entityType, entityId))

describe('[legacy] FR-179 shelf-life audit and maintenance', () => {
  let powerbank, tumbler, freshLot, dueLot, deadLot, tumblerLot
  before(async () => {
    // The SmartGift case: recharge due at 180 days, refuse dispatch past 240.
    powerbank = await sku('COMP-PB-10000MAH-MAGSAFE', { name: 'Power bank 10,000mAh', trackingMode: 'LOT', maintenanceIntervalDays: 180, maxStorageDays: 240 })
    tumbler = await sku('COMP-TUMBLER', { name: 'Tumbler', trackingMode: 'LOT' })
    freshLot = await lot(powerbank.id, 'LOT-PB-FRESH', daysAgo(30))
    dueLot = await lot(powerbank.id, 'LOT-PB-DUE', daysAgo(200))
    deadLot = await lot(powerbank.id, 'LOT-PB-DEAD', daysAgo(300))
    for (const l of [freshLot, dueLot, deadLot]) await receive(powerbank.id, 100, { lotId: l.id })
    tumblerLot = await lot(tumbler.id, 'LOT-TM-OLD', daysAgo(900))
    await receive(tumbler.id, 100, { lotId: tumblerLot.id })
    await lot(powerbank.id, 'LOT-PB-EMPTY', daysAgo(400))
  })

  test('AC-179.1 — the audit separates OK, DUE and EXPIRED and names the deadline each batch is measured against', async () => {
    const audit = await h.bus.queries.shelfLife(as('member'), { businessId: BIZ })
    assert.deepEqual(audit.counts, { total: 3, ok: 1, due: 1, expired: 1 })
    const row = (code) => audit.rows.find((r) => r.lotCode === code)
    assert.deepEqual([row('LOT-PB-FRESH').state, row('LOT-PB-FRESH').ageDays, row('LOT-PB-FRESH').dueInDays, row('LOT-PB-FRESH').onHand], ['OK', 30, 150, 100])
    assert.deepEqual([row('LOT-PB-DUE').state, row('LOT-PB-DUE').ageDays, row('LOT-PB-DUE').maxStorageDays], ['DUE', 200, 240])
    assert.deepEqual([row('LOT-PB-DEAD').state, row('LOT-PB-DEAD').ageDays], ['EXPIRED', 300])
    assert.equal(new Date(row('LOT-PB-DEAD').hardDeadlineAt).toISOString(), new Date(NOW.getTime() - 60 * DAY).toISOString())
    // A product that declares no storage limit is not in the report at all.
    assert.ok(!audit.rows.map((r) => r.productCode).includes('COMP-TUMBLER'))
    const narrowed = await h.bus.queries.shelfLife(as('member'), { businessId: BIZ, thresholdDays: '250' })
    assert.deepEqual([narrowed.thresholdDays, narrowed.rows.map((r) => r.lotCode)], [250, ['LOT-PB-DEAD']])
    // An empty lot is a job only when asked for.
    const withEmpty = await h.bus.queries.shelfLife(as('member'), { businessId: BIZ, includeEmpty: true })
    assert.deepEqual([withEmpty.counts.total, withEmpty.rows.find((r) => r.lotCode === 'LOT-PB-EMPTY').onHand], [4, 0])
    await rejects(h.bus.queries.shelfLife(as('noDomain'), { businessId: BIZ }), { status: 404, code: 'SCM_SCOPE_NOT_FOUND' })
  })

  test('AC-179.5 — recording maintenance resets the clock, and only for a product that actually ages', async () => {
    const issueFromDead = () => run('owner', 'inventory.movement.record', { businessId: BIZ, productId: powerbank.id, kind: 'ISSUE', quantity: 10, lotId: deadLot.id })
    await rejects(issueFromDead(), { status: 409, code: 'INVENTORY_LOT_STORAGE_EXPIRED' })
    const versionBefore = (await h.bus.queries.lots(as('member'), { businessId: BIZ, productId: powerbank.id })).lots.find((l) => l.id === deadLot.id).version
    const { lot: maintained, replayed } = await run('manager', 'inventory.lot.maintain', { businessId: BIZ, lotId: deadLot.id, note: 'charged to 65% storage voltage' })
    assert.deepEqual([replayed, maintained.lastMaintainedAt, maintained.version], [false, NOW.toISOString(), versionBefore + 1])
    const issued = await issueFromDead()
    assert.ok(issued.movement.onHandAfter > 0)
    const audit = await h.bus.queries.shelfLife(as('member'), { businessId: BIZ })
    const dead = audit.rows.find((r) => r.lotCode === 'LOT-PB-DEAD')
    assert.deepEqual([dead.state, dead.ageDays], ['OK', 0])

    await rejects(run('owner', 'inventory.lot.maintain', { businessId: BIZ, lotId: tumblerLot.id }), { status: 422, code: 'INVENTORY_PRODUCT_DOES_NOT_AGE' })
    await rejects(run('member', 'inventory.lot.maintain', { businessId: BIZ, lotId: deadLot.id }), { status: 404 })
    await rejects(run('owner', 'inventory.lot.maintain', { businessId: BIZ, lotId: 'no-such-lot' }), { status: 404, code: 'SCM_SCOPE_NOT_FOUND' })
    // [SCM] a lot of another Business of the Tenant is the same 404, and nothing is written.
    await h.store.transaction((sql) => sql.run("INSERT INTO ProductLot (id, code, tenantId, businessId, productId, manufacturedAt, createdAt, updatedAt) VALUES ('other-biz-lot', 'LOT-OTHER', ?, ?, ?, ?, ?, ?)", TENANT, OTHER_BIZ, powerbank.id, daysAgo(300), NOW.toISOString(), NOW.toISOString()))
    await rejects(run('owner', 'inventory.lot.maintain', { businessId: BIZ, lotId: 'other-biz-lot' }), { status: 404, code: 'SCM_SCOPE_NOT_FOUND' })
    assert.equal((await audits('PRODUCT_LOT', 'other-biz-lot')).length, 0)
    await assert.rejects(run('owner', 'inventory.lot.maintain', { businessId: BIZ, lotId: deadLot.id, extra: 1 }), { name: 'ZodError' })

    const rows = await audits('PRODUCT_LOT', deadLot.id)
    const maintainedRows = rows.filter((r) => r.action === 'PRODUCT_LOT_MAINTAINED')
    assert.equal(maintainedRows.length, 1)
    const payload = JSON.parse(maintainedRows[0].payloadJson)
    assert.deepEqual([payload.previousMaintainedAt, payload.maintainedAt, payload.note, payload.productCode], [null, NOW.toISOString(), 'charged to 65% storage voltage', 'COMP-PB-10000MAH-MAGSAFE'])
  })

  test('a backdated maintenance is recorded as given, and the next one audits the value it replaced; a CLOSED lot is refused', async () => {
    const { lot: first } = await run('owner', 'inventory.lot.maintain', { businessId: BIZ, lotId: dueLot.id, maintainedAt: daysAgo(10) })
    assert.equal(first.lastMaintainedAt, daysAgo(10))
    await run('owner', 'inventory.lot.maintain', { businessId: BIZ, lotId: dueLot.id })
    const payloads = (await audits('PRODUCT_LOT', dueLot.id)).filter((r) => r.action === 'PRODUCT_LOT_MAINTAINED').map((r) => JSON.parse(r.payloadJson)).sort((x, y) => x.version - y.version)
    assert.deepEqual(payloads.map((p) => [p.previousMaintainedAt, p.maintainedAt]), [[null, daysAgo(10)], [daysAgo(10), NOW.toISOString()]])
    await h.store.transaction((sql) => sql.run("UPDATE ProductLot SET status = 'CLOSED' WHERE id = ?", freshLot.id))
    await rejects(run('owner', 'inventory.lot.maintain', { businessId: BIZ, lotId: freshLot.id }), { status: 409, code: 'PRODUCT_LOT_CLOSED' })
  })
})

describe('[legacy] FR-206 catalogue hygiene and FR-207 replenishment', () => {
  let axesMaster, serviceMaster, goodMaster
  before(async () => {
    goodMaster = (await run('owner', 'inventory.product-master.create', { businessId: BIZ, code: 'PM-HYG-GOOD', categoryId: category.id, nameTh: 'g', nameEn: 'g' })).master
    serviceMaster = (await run('owner', 'inventory.product-master.create', { businessId: BIZ, code: 'PM-HYG-SVC', categoryId: category.id, nameTh: 's', nameEn: 's', nature: 'SERVICE' })).master
    axesMaster = (await run('owner', 'inventory.product-master.create', { businessId: BIZ, code: 'PM-HYG-AXES', categoryId: category.id, nameTh: 'a', nameEn: 'a', variantAxes: ['color'] })).master
  })

  test('AC-206.1 — the report names the lookalikes, a legacy nature mismatch, a dormant SKU and the missing identifiers; it writes nothing', async () => {
    const lk1 = await run('owner', 'inventory.product.create', { businessId: BIZ, code: 'LK-1', productMasterId: goodMaster.id, name: 'Mug white' }).then((r) => r.product)
    await run('owner', 'inventory.product.create', { businessId: BIZ, code: 'LK-2', productMasterId: goodMaster.id, name: 'Mug  White', allowLookalike: true })
    await run('owner', 'inventory.identifier.add', { businessId: BIZ, kind: 'BARCODE', value: 'LK1-BAR' }, lk1.id)
    await run('owner', 'inventory.product.create', { businessId: BIZ, code: 'AX-RED', productMasterId: axesMaster.id, variant: { color: 'red' } })
    await run('owner', 'inventory.product.create', { businessId: BIZ, code: 'SVC-OK', productMasterId: serviceMaster.id })
    // A legacy service filed under a good master, as the migration backfill leaves one.
    await h.store.transaction((sql) => sql.run(
      "INSERT INTO Product (id, code, tenantId, businessId, productMasterId, stockPolicy, trackingMode, safetyStock, createdAt, updatedAt) VALUES ('legacy-svc', 'LEGACY-SVC', 'tenant-synthetic-a', ?, ?, 'SERVICE', 'NONE', 10, ?, ?)",
      BIZ, goodMaster.id, NOW.toISOString(), NOW.toISOString(),
    ))
    const before = await h.count('ScmAuditEvent')
    clockAt = new Date(NOW.getTime() + 200 * DAY)
    const report = await h.bus.queries.catalogHygiene(as('member'), { businessId: BIZ })
    clockAt = NOW
    const codesOf = (kind) => report.findings.filter((f) => f.kind === kind).flatMap((f) => f.codes)
    assert.deepEqual(codesOf('LOOKALIKE_SKUS'), ['LK-1', 'LK-2'])
    assert.deepEqual(codesOf('NATURE_MISMATCH'), ['LEGACY-SVC'])
    assert.deepEqual(codesOf('SERVICE_WITH_STOCK_FIELDS'), ['LEGACY-SVC'])
    assert.ok(report.findings.filter((f) => f.kind === 'MASTER_WITHOUT_AXES').map((f) => f.masterId).includes(goodMaster.id))
    // Dormant = counted, empty and idle past the window; a SKU with stock is never dormant.
    assert.ok(codesOf('DORMANT_SKU').includes('LK-1'))
    assert.ok(!codesOf('DORMANT_SKU').includes('COMP-TUMBLER'))
    assert.ok(codesOf('SKU_WITHOUT_IDENTIFIER').includes('LK-2'))
    assert.ok(!codesOf('SKU_WITHOUT_IDENTIFIER').includes('LK-1'))
    assert.deepEqual([report.businessId, report.dormantDays, report.total], [BIZ, 180, report.findings.length])
    assert.equal(report.catalogue.masters, 4)
    assert.equal(await h.count('ScmAuditEvent'), before)
    assert.equal((await h.bus.queries.catalogHygiene(as('member'), { businessId: BIZ, dormantDays: '5000' })).dormantDays, 3650)
    assert.equal((await h.bus.queries.catalogHygiene(as('member'), { businessId: BIZ, dormantDays: '0' })).dormantDays, 1)
    await rejects(h.bus.queries.catalogHygiene(as('noDomain'), { businessId: BIZ }), { status: 404, code: 'SCM_SCOPE_NOT_FOUND' })
  })

  test('AC-207.1 — replenishment suggests every counted ACTIVE SKU below its reorder point with the declared quantity or the gap', async () => {
    const declared = await run('owner', 'inventory.product.create', { businessId: BIZ, code: 'RP-DECLARED', productMasterId: goodMaster.id, name: 'Declared', safetyStock: 2, reorderPoint: 20, reorderQty: 50, leadTimeDays: 14 }).then((r) => r.product)
    await receive(declared.id, 5)
    const bySafety = await run('owner', 'inventory.product.create', { businessId: BIZ, code: 'RP-SAFETY', productMasterId: goodMaster.id, name: 'By safety', safetyStock: 4 }).then((r) => r.product)
    await receive(bySafety.id, 3)
    const fine = await run('owner', 'inventory.product.create', { businessId: BIZ, code: 'RP-FINE', productMasterId: goodMaster.id, name: 'Fine', safetyStock: 4 }).then((r) => r.product)
    await receive(fine.id, 4)
    // [SCM] a phased-out SKU below its threshold is not counted (ACTIVE only).
    const phased = await run('owner', 'inventory.product.create', { businessId: BIZ, code: 'RP-PHASED', productMasterId: goodMaster.id, name: 'Phased', safetyStock: 9 }).then((r) => r.product)
    await receive(phased.id, 1)
    await run('owner', 'inventory.product.action', { action: 'PHASE_OUT', version: 1 }, phased.id)
    const { rows, counts } = await h.bus.queries.replenishment(as('member'), { businessId: BIZ })
    const row = (code) => rows.find((r) => r.code === code)
    assert.deepEqual([row('RP-DECLARED').onHand, row('RP-DECLARED').threshold, row('RP-DECLARED').suggestedQty, row('RP-DECLARED').leadTimeDays], [5, 20, 50, 14])
    assert.deepEqual([row('RP-SAFETY').onHand, row('RP-SAFETY').threshold, row('RP-SAFETY').suggestedQty, row('RP-SAFETY').reorderPoint], [3, 4, 1, null])
    assert.ok(!rows.map((r) => r.code).includes('RP-FINE'))
    assert.ok(!rows.map((r) => r.code).includes('RP-PHASED'))
    // A service and an archived SKU are never counted.
    assert.ok(!rows.map((r) => r.code).includes('SVC-OK'))
    assert.equal(counts.suggested, rows.length)
    // `counted` is every TRACKED, ACTIVE SKU of the Business — the phased-out one is not among them.
    const trackedActive = await h.store.read((sql) => Number(sql.get("SELECT COUNT(*) AS n FROM Product WHERE businessId = ? AND stockPolicy = 'TRACKED' AND status = 'ACTIVE'", BIZ).n))
    assert.equal(counts.counted, trackedActive)
    await run('owner', 'inventory.product.action', { action: 'UPDATE', version: 1, fields: { reorderPoint: 4, reorderQty: null } }, declared.id)
    assert.ok(!(await h.bus.queries.replenishment(as('member'), { businessId: BIZ })).rows.map((r) => r.code).includes('RP-DECLARED'))
    await rejects(h.bus.queries.replenishment(as('noDomain'), { businessId: BIZ }), { status: 404, code: 'SCM_SCOPE_NOT_FOUND' })
  })
})
