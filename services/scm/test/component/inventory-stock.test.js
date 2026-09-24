// The stock core (FR-155) through the real SCM commands and queries: RECEIPT,
// ISSUE and ADJUSTMENT on a plain SKU, lots by code and by the explicit path,
// serial units received and issued one by one, the refusals by code, the
// recomputed summary with its counts, FEFO. [legacy] tests mirror apps/server
// fr155-inventory-stock.test.js with the same inputs and expectations.
import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { createHarness, rejects } from '../support/harness.js'
import { BIZ, idem } from '../support/fixtures.js'

const G = {
  owner: { [BIZ]: { owner: true, domains: ['inventory'], permissions: [] } },
  manager: { [BIZ]: { owner: false, domains: ['inventory'], permissions: ['inventory.catalog.write'] } },
  member: { [BIZ]: { owner: false, domains: ['inventory'], permissions: [] } },
  noDomain: { [BIZ]: { owner: true, domains: ['projects'], permissions: [] } },
}
let h, factory, plain, lotted, serial, service
before(async () => {
  h = createHarness({ products: [] })
  const category = (await run('owner', 'inventory.category.create', { businessId: BIZ, code: 'classic-oriental', nameTh: 'คลาสสิก', nameEn: 'Classic oriental' })).category
  factory = (await run('owner', 'inventory.factory.create', { businessId: BIZ, code: 'FAC-1', name: 'Factory One' })).factory
  const master = (await run('owner', 'inventory.product-master.create', { businessId: BIZ, code: 'PM-TEA', categoryId: category.id, factoryId: factory.id, nameTh: 'ชุดชา', nameEn: 'Tea set' })).master
  const sku = (code, over) => run('owner', 'inventory.product.create', { businessId: BIZ, code, productMasterId: master.id, ...over }).then((r) => r.product)
  plain = await sku('TEA-PLAIN', { safetyStock: 4 })
  lotted = await sku('TEA-LOT', { trackingMode: 'LOT', safetyStock: 0 })
  serial = await sku('TEA-SERIAL', { trackingMode: 'SERIAL', safetyStock: 1 })
  service = await sku('TEA-CEREMONY', { stockPolicy: 'UNTRACKED' })
})
after(() => h.close())
function as(who) { return h.as({ sub: `per-${who}`, grants: G[who] }) }
function run(who, action, body, targetId = null) { return h.run(as(who), action, { body, targetId, idempotencyKey: idem(action) }) }
const record = (body, who = 'owner') => run(who, 'inventory.movement.record', { businessId: BIZ, ...body }).then((r) => r.movement)
const createLot = (body, who = 'owner') => run(who, 'inventory.lot.create', { businessId: BIZ, ...body }).then((r) => r.lot)
const lots = (productId) => h.bus.queries.lots(as('member'), { businessId: BIZ, productId }).then((r) => r.lots)
const audits = (entityType, ids) => h.store.read((sql) => sql.all(`SELECT entityId, action, payloadJson FROM ScmAuditEvent WHERE entityType = ? AND entityId IN (${ids.map(() => '?').join(',')}) ORDER BY occurredAt, rowid`, entityType, ...ids))

describe('[legacy] FR-155 Inventory stock ledger', () => {
  test('AC-155.1 — a plain counted SKU: receipt adds, issue removes, adjustment corrects, and on-hand is recomputed from the rows', async () => {
    const receipt = await record({ productId: plain.id, kind: 'RECEIPT', quantity: 10, reference: 'PO-1' }, 'manager')
    assert.deepEqual([receipt.kind, receipt.quantity, receipt.onHandBefore, receipt.onHandAfter, receipt.lotId, receipt.movements.length], ['RECEIPT', 10, 0, 10, null, 1])
    await record({ productId: plain.id, kind: 'ISSUE', quantity: 3 })
    const adjusted = await record({ productId: plain.id, kind: 'ADJUSTMENT', quantity: -4, reason: 'stocktake' })
    assert.deepEqual([adjusted.onHandBefore, adjusted.onHandAfter], [7, 3])
    await rejects(record({ productId: plain.id, kind: 'ISSUE', quantity: 4 }), { status: 409, code: 'INVENTORY_INSUFFICIENT_STOCK' })
    const { movements } = await h.bus.queries.movements(as('member'), { businessId: BIZ, productId: plain.id })
    assert.deepEqual(movements.map((r) => Number(r.quantity)), [-4, -3, 10])
    const rows = await audits('STOCK_MOVEMENT', movements.map((r) => r.id))
    assert.deepEqual(rows.map((a) => a.action), ['STOCK_RECEIPT_RECORDED', 'STOCK_ISSUE_RECORDED', 'STOCK_ADJUSTMENT_RECORDED'])
    const first = JSON.parse(rows[0].payloadJson)
    assert.deepEqual([first.onHandBefore, first.onHandAfter, first.reference], [0, 10, 'PO-1'])
  })

  test('AC-155.2 — the refusals by code: uncounted, wrong tracking mode, unknown product, member cannot write', async () => {
    await rejects(record({ productId: service.id, kind: 'RECEIPT', quantity: 1 }), { status: 422, code: 'INVENTORY_PRODUCT_UNTRACKED' })
    await rejects(record({ productId: plain.id, kind: 'RECEIPT', quantity: 1, lotCode: 'L' }), { status: 422, code: 'INVENTORY_LOT_NOT_TRACKED' })
    await rejects(record({ productId: plain.id, kind: 'RECEIPT', quantity: 1, serialNos: ['S'] }), { status: 422, code: 'INVENTORY_SERIAL_NOT_TRACKED' })
    await rejects(record({ productId: lotted.id, kind: 'RECEIPT', quantity: 1 }), { status: 422, code: 'INVENTORY_LOT_REQUIRED' })
    await rejects(record({ productId: 'no-such', kind: 'RECEIPT', quantity: 1 }), { status: 422, code: 'INVENTORY_PRODUCT_NOT_FOUND' })
    await rejects(record({ productId: plain.id, kind: 'RECEIPT', quantity: 1 }, 'member'), { status: 404 })
    await rejects(run('owner', 'inventory.movement.record', { businessId: 'no-such-business', productId: plain.id, kind: 'RECEIPT', quantity: 1 }), { status: 404 })
  })

  test('AC-155.3 — a LOT-tracked SKU: a receipt names or creates its lot, the lot counts what it received, an explicit lot carries dates', async () => {
    const first = await record({ productId: lotted.id, kind: 'RECEIPT', quantity: 20, lotCode: 'LOT-2026-09' })
    assert.ok(first.lotId)
    const again = await record({ productId: lotted.id, kind: 'RECEIPT', quantity: 5, lotCode: 'LOT-2026-09' })
    assert.equal(again.lotId, first.lotId)
    const listed = await lots(lotted.id)
    assert.equal(listed.length, 1)
    assert.deepEqual([listed[0].code, Number(listed[0].receivedQty), listed[0].status], ['LOT-2026-09', 25, 'OPEN'])

    const dated = await createLot({ productId: lotted.id, code: 'LOT-2026-10', factoryId: factory.id, manufacturedAt: '2026-10-01T00:00:00Z', expiresAt: '2027-10-01T00:00:00Z' }, 'manager')
    assert.deepEqual([dated.factoryId, Number(dated.receivedQty)], [factory.id, 0])
    await rejects(createLot({ productId: lotted.id, code: 'LOT-2026-10' }), { status: 409, code: 'PRODUCT_LOT_CODE_TAKEN' })
    await rejects(createLot({ productId: plain.id, code: 'LOT-X' }), { status: 422, code: 'INVENTORY_LOT_NOT_TRACKED' })
    await assert.rejects(createLot({ productId: lotted.id, code: 'LOT-BAD', manufacturedAt: '2027-01-01T00:00:00Z', expiresAt: '2026-01-01T00:00:00Z' }), /expiresAt/)
    // [SCM] not in the legacy case: a lot names a factory of its own Business only.
    await rejects(createLot({ productId: lotted.id, code: 'LOT-FOREIGN-FAC', factoryId: 'no-such-factory' }), { status: 422, code: 'FACTORY_NOT_FOUND' })

    const issued = await record({ productId: lotted.id, kind: 'ISSUE', quantity: 7, lotId: first.lotId })
    assert.deepEqual([issued.onHandBefore, issued.onHandAfter, issued.lotId], [25, 18, first.lotId])
    await rejects(record({ productId: lotted.id, kind: 'ISSUE', quantity: 1, lotCode: 'LOT-NOPE' }), { status: 422, code: 'PRODUCT_LOT_NOT_FOUND' })
  })

  test('AC-155.4 — a SERIAL-tracked SKU: one row per serial, a unit exists from its receipt, is ISSUED by its issue, and cannot be issued twice', async () => {
    const receipt = await record({ productId: serial.id, kind: 'RECEIPT', quantity: 3, serialNos: ['SN-1', 'SN-2', 'SN-3'], lotCode: 'SER-LOT' }, 'manager')
    assert.deepEqual([receipt.onHandBefore, receipt.onHandAfter, receipt.movements.length], [0, 3, 3])
    assert.ok(receipt.movements.every((m) => Number(m.quantity) === 1 && m.serialUnitId))
    const units = (await h.bus.queries.serialUnits(as('member'), { businessId: BIZ, productId: serial.id })).serialUnits
    assert.deepEqual(units.map((u) => [u.serialNo, u.status]), [['SN-1', 'IN_STOCK'], ['SN-2', 'IN_STOCK'], ['SN-3', 'IN_STOCK']])
    assert.ok(units.every((u) => u.lotId === receipt.lotId))

    await rejects(record({ productId: serial.id, kind: 'RECEIPT', quantity: 1, serialNos: ['SN-1'] }), { status: 409, code: 'INVENTORY_SERIAL_ALREADY_IN_STOCK' })
    await rejects(record({ productId: serial.id, kind: 'RECEIPT', quantity: 2, serialNos: ['SN-9'] }), { status: 422, code: 'INVENTORY_SERIAL_COUNT_MISMATCH' })
    await rejects(record({ productId: serial.id, kind: 'ADJUSTMENT', quantity: 1 }), { status: 422, code: 'INVENTORY_SERIAL_ADJUSTMENT_NOT_ALLOWED' })

    const issue = await record({ productId: serial.id, kind: 'ISSUE', quantity: 2, serialNos: ['SN-1', 'SN-3'] })
    assert.deepEqual([issue.onHandBefore, issue.onHandAfter], [3, 1])
    assert.deepEqual((await h.bus.queries.serialUnits(as('member'), { businessId: BIZ, productId: serial.id, status: 'ISSUED' })).serialUnits.map((u) => u.serialNo), ['SN-1', 'SN-3'])
    await rejects(record({ productId: serial.id, kind: 'ISSUE', quantity: 1, serialNos: ['SN-1'] }), { status: 409, code: 'INVENTORY_SERIAL_NOT_IN_STOCK' })
    await rejects(record({ productId: serial.id, kind: 'ISSUE', quantity: 1, serialNos: ['SN-404'] }), { status: 409, code: 'INVENTORY_SERIAL_NOT_IN_STOCK' })

    const returned = await record({ productId: serial.id, kind: 'RECEIPT', quantity: 1, serialNos: ['SN-1'] })
    assert.equal(returned.onHandAfter, 2)
    assert.deepEqual((await audits('SERIAL_UNIT', [units[0].id])).map((a) => a.action), ['SERIAL_UNIT_RECEIVED', 'SERIAL_UNIT_ISSUED', 'SERIAL_UNIT_RECEIVED'])
  })

  test('AC-155.5 — the summary recomputes every on-hand, flags safety stock, and prints null (never zero) for an uncounted product', async () => {
    const summary = await h.bus.queries.stock(as('member'), BIZ)
    const byCode = Object.fromEntries(summary.products.map((p) => [p.code, p]))
    assert.deepEqual([byCode['TEA-PLAIN'].onHand, byCode['TEA-PLAIN'].safetyStock, byCode['TEA-PLAIN'].belowSafetyStock], [3, 4, true])
    assert.deepEqual([byCode['TEA-LOT'].onHand, byCode['TEA-LOT'].belowSafetyStock], [18, false])
    assert.deepEqual([byCode['TEA-SERIAL'].onHand, byCode['TEA-SERIAL'].safetyStock, byCode['TEA-SERIAL'].belowSafetyStock], [2, 1, false])
    assert.deepEqual([byCode['TEA-CEREMONY'].onHand, byCode['TEA-CEREMONY'].stockPolicy, byCode['TEA-CEREMONY'].belowSafetyStock], [null, 'UNTRACKED', false])
    assert.deepEqual(summary.counts, { products: 4, tracked: 3, untracked: 1, services: 0, phaseOut: 0, belowSafetyStock: 1, belowReorderPoint: 1 })
    await rejects(h.bus.queries.stock(as('noDomain'), BIZ), { status: 404 })
  })

  test('AC-155.6 — an issue that names no lot is consumed FEFO across open lots; one that names a lot may not exceed it', async () => {
    const dated = (await lots(lotted.id)).find((l) => l.code === 'LOT-2026-10')
    await record({ productId: lotted.id, kind: 'RECEIPT', quantity: 5, lotId: dated.id })
    const fefo = await record({ productId: lotted.id, kind: 'ISSUE', quantity: 20 })
    assert.deepEqual([fefo.onHandBefore, fefo.onHandAfter, fefo.lotId, fefo.movements.length], [23, 3, null, 2])
    assert.deepEqual(fefo.allocations.map((a) => a.qty), [5, 15])
    assert.equal(fefo.allocations[0].lotId, dated.id)
    assert.deepEqual(Object.fromEntries((await lots(lotted.id)).map((l) => [l.code, l.onHand])), { 'LOT-2026-09': 3, 'LOT-2026-10': 0 })
    await record({ productId: lotted.id, kind: 'RECEIPT', quantity: 5, lotId: dated.id })
    const undated = (await lots(lotted.id)).find((l) => l.code === 'LOT-2026-09')
    await rejects(record({ productId: lotted.id, kind: 'ISSUE', quantity: 4, lotId: undated.id }), { status: 409, code: 'INVENTORY_LOT_INSUFFICIENT_STOCK' })
    await rejects(record({ productId: lotted.id, kind: 'ISSUE', quantity: 9 }), { status: 409, code: 'INVENTORY_INSUFFICIENT_STOCK' })
    assert.equal((await record({ productId: lotted.id, kind: 'ISSUE', quantity: 8 })).onHandAfter, 0)
    const audit = (await audits('STOCK_MOVEMENT', [fefo.movements[0].id]))[0]
    assert.equal(JSON.parse(audit.payloadJson).allocations.length, 2)
  })
})
