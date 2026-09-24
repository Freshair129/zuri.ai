// Warehouse locations and the located ledger (FR-174) through the real SCM
// commands and queries: identity and authority, the standalone transfer that
// leaves Business-wide on-hand untouched, the located view with its unlocated
// remainder, the branded-stock refusal, lot identity across a move, and the
// archive guard. [legacy] tests mirror apps/server
// fr174-warehouse-locations.test.js with the same inputs and expectations.
import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { createHarness, rejects } from '../support/harness.js'
import { BIZ, OTHER_BIZ, idem } from '../support/fixtures.js'

const G = {
  owner: { [BIZ]: { owner: true, domains: ['inventory'], permissions: [] }, [OTHER_BIZ]: { owner: true, domains: ['inventory'], permissions: [] } },
  manager: { [BIZ]: { owner: false, domains: ['inventory'], permissions: ['inventory.catalog.write'] } },
  member: { [BIZ]: { owner: false, domains: ['inventory'], permissions: [] } },
}
let h, tumbler, branded, teaLot, raw, wip, finished, scrap, foreign
before(async () => {
  h = createHarness({ products: [] })
  const category = (await run('owner', 'inventory.category.create', { businessId: BIZ, code: 'drinkware', nameTh: 'แก้วน้ำ', nameEn: 'Drinkware' })).category
  const master = (await run('owner', 'inventory.product-master.create', { businessId: BIZ, code: 'PM-TUMBLER', categoryId: category.id, nameTh: 'กระบอกน้ำ', nameEn: 'Tumbler' })).master
  const sku = (body) => run('owner', 'inventory.product.create', { businessId: BIZ, productMasterId: master.id, ...body }).then((r) => r.product)
  tumbler = await sku({ code: 'COMP-TUMBLER-SUS304-500ML', name: 'SUS304 500ml' })
  branded = await sku({ code: 'BRANDED-TUMBLER-PTT', name: 'PTT tumbler', itemKind: 'CUSTOM_COMPONENT', dedicatedCustomerId: 'cust-ptt', dedicatedSalesOrderId: 'so-ptt-1' })
  teaLot = await sku({ code: 'COMP-PB-10000MAH', name: 'Power bank', trackingMode: 'LOT' })
  raw = await createLocation({ code: 'LOC-TH-RAW-01', name: 'คลังวัตถุดิบกลาง', type: 'TH_CENTRAL_RAW' })
  wip = await createLocation({ code: 'LOC-TH-LASER', name: 'ห้องยิงเลเซอร์', type: 'TH_WIP_CUSTOMIZATION' }, 'manager')
  finished = await createLocation({ code: 'LOC-TH-FG', name: 'คลังสินค้าสำเร็จรูป', type: 'TH_FINISHED_GOODS' })
  scrap = await createLocation({ code: 'LOC-TH-SCRAP', name: 'ของเสีย', type: 'TH_QUARANTINE_SCRAP' })
  foreign = (await run('owner', 'inventory.location.create', { businessId: OTHER_BIZ, code: 'LOC-OTHER', name: 'Other', type: 'TH_CENTRAL_RAW' })).location
})
after(() => h.close())
function as(who) { return h.as({ sub: `per-${who}`, grants: G[who] }) }
function run(who, action, body, targetId = null) { return h.run(as(who), action, { body, targetId, idempotencyKey: idem(action) }) }
function createLocation(body, who = 'owner') { return run(who, 'inventory.location.create', { businessId: BIZ, ...body }).then((r) => r.location) }
const record = (body) => run('owner', 'inventory.movement.record', { businessId: BIZ, ...body }).then((r) => r.movement)
const transfer = (body, who = 'owner') => run(who, 'inventory.transfer', { businessId: BIZ, ...body }).then((r) => r.transfer)
const located = (productId) => h.bus.queries.locationStock(as('member'), { businessId: BIZ, productId })
const locAction = (id, body, who = 'owner') => run(who, 'inventory.location.action', body, id).then((r) => r.location)
const onHand = (productId) => h.store.read((sql) => Number(sql.get('SELECT COALESCE(SUM(quantity), 0) AS q FROM StockMovement WHERE productId = ?', productId).q))

describe('[legacy] FR-174 Warehouse locations and the located ledger', () => {
  test('AC-174.1 — a location is Business-scoped with a Tenant-unique code, typed, and writable only by an inventory authority', async () => {
    assert.deepEqual([raw.code, raw.type, raw.isVirtual, raw.status, raw.version], ['LOC-TH-RAW-01', 'TH_CENTRAL_RAW', false, 'ACTIVE', 1])
    const vessel = await createLocation({ code: 'LOC-SEA-01', name: 'ตู้คอนเทนเนอร์บนเรือ', type: 'INTL_SEA_TRANSIT', isVirtual: true })
    assert.equal(vessel.isVirtual, true)
    await rejects(createLocation({ code: 'LOC-TH-RAW-01', name: 'dup', type: 'TH_CENTRAL_RAW' }), { status: 409, code: 'WAREHOUSE_LOCATION_CODE_TAKEN' })
    await assert.rejects(createLocation({ code: 'LOC-X', name: 'x', type: 'MOON_BASE' }))
    await rejects(createLocation({ code: 'LOC-Y', name: 'y', type: 'TH_CENTRAL_RAW' }, 'member'), { status: 404 })
    const { locations } = await h.bus.queries.locations(as('member'), { businessId: BIZ })
    assert.ok(locations.map((l) => l.code).includes('LOC-SEA-01'))
    assert.ok(locations.every((l) => l.businessId === BIZ))
    const actions = await h.store.read((sql) => sql.all("SELECT action FROM ScmAuditEvent WHERE entityType = 'WAREHOUSE_LOCATION' AND entityId = ?", raw.id).map((a) => a.action))
    assert.deepEqual(actions, ['WAREHOUSE_LOCATION_CREATED'])
  })

  test('AC-174.2 — a transfer moves stock between locations in one unit of work and leaves Business-wide on-hand untouched', async () => {
    await record({ productId: tumbler.id, kind: 'RECEIPT', quantity: 1000, reference: 'GRN:INITIAL', targetLocationId: raw.id, costSatang: 11346 })
    const before = await onHand(tumbler.id)
    const result = await transfer({ productId: tumbler.id, sourceLocationId: raw.id, targetLocationId: wip.id, quantity: 510, reference: 'CWO:TEST' }, 'manager')
    assert.equal(await onHand(tumbler.id), before)
    assert.deepEqual([result.quantity, result.sourceLocationId, result.targetLocationId], [510, raw.id, wip.id])
    const out = result.issued.movements[0]
    const into = result.received[0].movements[0]
    assert.deepEqual([out.kind, Number(out.quantity), out.sourceLocationId], ['ISSUE', -510, raw.id])
    assert.deepEqual([into.kind, Number(into.quantity), into.targetLocationId], ['RECEIPT', 510, wip.id])
    const view = await located(tumbler.id)
    assert.deepEqual([view.total, view.unlocated], [1000, 0])
    assert.deepEqual(view.located.map((r) => [r.code, r.onHand]).sort(), [['LOC-TH-LASER', 510], ['LOC-TH-RAW-01', 490]])
  })

  test("AC-174.3 — a transfer is refused when it names one place twice, an unknown place, another Business's place, or more than the source holds", async () => {
    await assert.rejects(transfer({ productId: tumbler.id, sourceLocationId: raw.id, targetLocationId: raw.id, quantity: 1 }))
    await rejects(transfer({ productId: tumbler.id, sourceLocationId: raw.id, targetLocationId: 'nope', quantity: 1 }), { status: 422, code: 'WAREHOUSE_LOCATION_NOT_FOUND' })
    await rejects(transfer({ productId: tumbler.id, sourceLocationId: raw.id, targetLocationId: foreign.id, quantity: 1 }), { status: 422, code: 'WAREHOUSE_LOCATION_NOT_FOUND' })
    await rejects(transfer({ productId: tumbler.id, sourceLocationId: raw.id, targetLocationId: wip.id, quantity: 99999 }), { status: 409, code: 'INVENTORY_INSUFFICIENT_STOCK' })
    await rejects(transfer({ productId: tumbler.id, sourceLocationId: raw.id, targetLocationId: wip.id, quantity: 1 }, 'member'), { status: 404 })
  })

  test('AC-174.4 — branded stock can never be transferred back into a generic-stock location (BR-028)', async () => {
    await record({ productId: branded.id, kind: 'RECEIPT', quantity: 100, targetLocationId: wip.id, customerId: 'cust-ptt', salesOrderId: 'so-ptt-1' })
    await rejects(transfer({ productId: branded.id, sourceLocationId: wip.id, targetLocationId: raw.id, quantity: 10 }), { status: 409, code: 'INVENTORY_CUSTOM_COMPONENT_NOT_RETURNABLE' })
    const toScrap = await transfer({ productId: branded.id, sourceLocationId: wip.id, targetLocationId: scrap.id, quantity: 10 })
    assert.equal(toScrap.quantity, 10)
    assert.deepEqual((await located(branded.id)).located.map((r) => [r.code, r.onHand]).sort(), [['LOC-TH-LASER', 90], ['LOC-TH-SCRAP', 10]])
  })

  test('AC-174.5 — a lot-tracked transfer keeps its batch identity, and its receivedQty is not inflated by the move', async () => {
    await record({ productId: teaLot.id, kind: 'RECEIPT', quantity: 200, lotCode: 'LOT-PB-2026A', targetLocationId: raw.id })
    const lot = () => h.store.read((sql) => sql.get("SELECT id, receivedQty FROM ProductLot WHERE productId = ? AND code = 'LOT-PB-2026A'", teaLot.id))
    const { id: lotId, receivedQty } = await lot()
    assert.equal(Number(receivedQty), 200)
    const moved = await transfer({ productId: teaLot.id, sourceLocationId: raw.id, targetLocationId: finished.id, quantity: 50 })
    assert.deepEqual(moved.allocations, [{ lotId, qty: 50 }])
    assert.equal(moved.received[0].movements[0].lotId, lotId)
    assert.equal(Number((await lot()).receivedQty), 200)
    assert.deepEqual((await located(teaLot.id)).located.map((r) => [r.code, r.onHand]).sort(), [['LOC-TH-FG', 50], ['LOC-TH-RAW-01', 150]])
  })

  test('AC-174.6 — an unlocated row is reported beside the total, never folded into a location (BR-026)', async () => {
    await record({ productId: tumbler.id, kind: 'RECEIPT', quantity: 40, reference: 'LEGACY' })
    const view = await located(tumbler.id)
    assert.deepEqual([view.unlocated, view.total, view.located.reduce((sum, r) => sum + r.onHand, 0)], [40, 1040, 1000])
  })

  test('AC-174.7 — a location holding stock cannot be archived; an empty one can, and archiving stops new transfers', async () => {
    const full = await rejects(locAction(raw.id, { action: 'ARCHIVE', version: raw.version }), { status: 409, code: 'WAREHOUSE_LOCATION_NOT_EMPTY' })
    // Every SKU at the location counts (legacy sums the location, not one product): 490 tumblers + 150 power banks.
    assert.equal(full.details.onHand, 640)
    const spare = await createLocation({ code: 'LOC-SPARE', name: 'ชั้นว่าง', type: 'TH_CENTRAL_RAW' })
    const renamed = await locAction(spare.id, { action: 'UPDATE', version: spare.version, fields: { name: 'ชั้นว่าง (ปิด)' } })
    assert.deepEqual([renamed.name, renamed.version], ['ชั้นว่าง (ปิด)', 2])
    await rejects(locAction(spare.id, { action: 'UPDATE', version: 1, fields: { name: 'stale' } }), { status: 409, code: 'WAREHOUSE_LOCATION_VERSION_CONFLICT' })
    const archived = await locAction(spare.id, { action: 'ARCHIVE', version: renamed.version })
    assert.deepEqual([archived.status, Boolean(archived.archivedAt)], ['ARCHIVED', true])
    await rejects(transfer({ productId: tumbler.id, sourceLocationId: raw.id, targetLocationId: spare.id, quantity: 1 }), { status: 409, code: 'WAREHOUSE_LOCATION_NOT_FOUND' })
    assert.equal((await h.bus.queries.location(as('member'), spare.id)).location.status, 'ARCHIVED')
  })
})
