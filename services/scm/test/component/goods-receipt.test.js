// PO → GRN → Stock → PO state through the real SCM use cases and store.
// Acceptance B8, B11 (receipt half), C17, C18 — see SCM-HANDOFF.md.
import { test, describe, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { createHarness, rejects } from '../support/harness.js'
import { BIZ, OTHER_BIZ, OTHER_TENANT, PRODUCTS, ROLES, idem } from '../support/fixtures.js'

const GRN = 'procurement.goods-receipt.post'
let h
beforeEach(() => { h = createHarness() })
afterEach(() => h.close())
const receiver = (role = ROLES.receiverFull, extra = {}) => h.as({ sub: 'person-receiver', grants: { [BIZ]: role }, ...extra })

describe('happy path and readback', () => {
  test('partial then completing receipt: GRN, ledger, lot, PO state, audit, outbox and receipts agree', async () => {
    const order = await h.sentOrder([
      { productId: PRODUCTS.plain.id, qty: 10, unitCost: 12.5 },
      { productId: PRODUCTS.lot.id, qty: 4, unitCost: 3 },
      { description: 'Inbound freight (free text)', qty: 1, unitCost: 500 },
    ])
    const [plainLine, lotLine, freeLine] = order.lines
    assert.equal(order.status, 'SENT')

    const first = await h.run(receiver(), GRN, { targetId: order.id, body: { lines: [{ purchaseOrderLineId: plainLine.id, qty: 6 }], batchCostSatang: 600 } })
    assert.equal(first.replayed, false)
    assert.equal(first.order.status, 'SENT')
    assert.equal(first.order.receiptState, 'PARTIAL')
    assert.match(first.receipt.code, /^GRN-\d{8}-001$/)
    assert.equal(first.posted[0].onHandAfter, 6)
    // agreed 1250 satang + ceil(600/6)=100 amortised batch cost
    assert.equal(first.posted[0].costSatang, 1350)
    assert.deepEqual(first.operation.affected.stockMovementIds, first.posted[0].movementIds)

    const second = await h.run(receiver(), GRN, { targetId: order.id, body: { lines: [
      { purchaseOrderLineId: plainLine.id, qty: 4 },
      { purchaseOrderLineId: lotLine.id, qty: 4, lotCode: 'LOT-SYN-1', expiresAt: '2027-01-31T00:00:00.000Z' },
      { purchaseOrderLineId: freeLine.id, qty: 1 },
    ] } })
    assert.equal(second.order.status, 'RECEIVED')
    assert.equal(second.order.receiptState, 'COMPLETE')
    assert.equal(second.order.version, order.version + 2)
    assert.equal(second.posted.length, 2, 'free-text line is recorded on the receipt but touches no ledger')

    const stock = await h.bus.queries.stock(receiver(), BIZ)
    const byCode = Object.fromEntries(stock.products.map((p) => [p.code, p.onHand]))
    assert.equal(byCode['SYN-PLAIN'], 10)
    assert.equal(byCode['SYN-LOT'], 4)
    assert.equal(byCode['SYN-UNTRACKED'], null, 'uncounted is null, never 0')
    const lot = await h.store.read((sql) => sql.get("SELECT * FROM ProductLot WHERE code = 'LOT-SYN-1'"))
    assert.equal(lot.receivedQty, 4)
    assert.equal(lot.expiresAt, '2027-01-31T00:00:00.000Z')
    const refs = await h.store.read((sql) => sql.all('SELECT DISTINCT reference FROM StockMovement').map((r) => r.reference))
    assert.deepEqual(refs.sort(), [`PO:${order.code}/GRN:${first.receipt.code}`, `PO:${order.code}/GRN:${second.receipt.code}`].sort())
    const audit = await h.store.read((sql) => sql.all('SELECT action FROM ScmAuditEvent').map((r) => r.action))
    for (const action of ['GOODS_RECEIPT_POSTED', 'PURCHASE_ORDER_RECEIVED', 'STOCK_RECEIPT_RECORDED']) assert.ok(audit.includes(action), action)
    const fence = await h.store.read((sql) => sql.get('SELECT mutationRevision FROM InventoryLedgerFence').mutationRevision)
    assert.equal(fence, 3, 'one fence advance per ledger append')
    assert.equal(await h.count('ScmOperationReceipt'), 5)

    await h.reopen()
    const again = await h.bus.queries.purchaseOrder(receiver(), order.id)
    assert.deepEqual(again.order, second.order, 'restart readback returns the identical order')
  })
})

describe('idempotency and recovery', () => {
  test('same key + same payload replays the stored outcome and writes nothing new', async () => {
    const order = await h.sentOrder([{ productId: PRODUCTS.plain.id, qty: 5, unitCost: 1 }])
    const key = idem('grn')
    const body = { lines: [{ purchaseOrderLineId: order.lines[0].id, qty: 2 }] }
    const first = await h.bus.run(receiver(), GRN, { idempotencyKey: key, targetId: order.id, body })
    const before = await h.snapshot()
    const replay = await h.bus.run(receiver(), GRN, { idempotencyKey: key, targetId: order.id, body })
    assert.equal(replay.replayed, true)
    assert.equal(replay.receipt.id, first.receipt.id)
    assert.deepEqual(await h.snapshot(), before)
  })
  test('same key + different payload or target is a conflict', async () => {
    const order = await h.sentOrder([{ productId: PRODUCTS.plain.id, qty: 5, unitCost: 1 }])
    const key = idem('grn')
    await h.bus.run(receiver(), GRN, { idempotencyKey: key, targetId: order.id, body: { lines: [{ purchaseOrderLineId: order.lines[0].id, qty: 2 }] } })
    await rejects(h.bus.run(receiver(), GRN, { idempotencyKey: key, targetId: order.id, body: { lines: [{ purchaseOrderLineId: order.lines[0].id, qty: 3 }] } }), { status: 409, code: 'SCM_IDEMPOTENCY_KEY_CONFLICT' })
  })
  test('lost response: the outcome is looked up by key, not re-executed', async () => {
    const order = await h.sentOrder([{ productId: PRODUCTS.plain.id, qty: 5, unitCost: 1 }])
    const key = idem('grn')
    const committed = await h.bus.run(receiver(), GRN, { idempotencyKey: key, targetId: order.id, body: { lines: [{ purchaseOrderLineId: order.lines[0].id, qty: 5 }] } })
    // …the caller never saw `committed`.
    const found = await h.bus.lookup(receiver(), { action: GRN, businessId: BIZ, idempotencyKey: key })
    assert.equal(found.operation.affected.goodsReceiptId, committed.receipt.id)
    assert.equal(found.response.order.status, 'RECEIVED')
    await rejects(h.bus.lookup(receiver(), { action: GRN, businessId: BIZ, idempotencyKey: idem('never-sent') }), { status: 404, code: 'SCM_OPERATION_NOT_FOUND' })
  })
  test('a key is not a read capability: replay and lookup re-check current authority', async () => {
    const order = await h.sentOrder([{ productId: PRODUCTS.plain.id, qty: 5, unitCost: 1 }])
    const key = idem('grn')
    const body = { lines: [{ purchaseOrderLineId: order.lines[0].id, qty: 1 }] }
    await h.bus.run(receiver(), GRN, { idempotencyKey: key, targetId: order.id, body })
    const revoked = h.as({ sub: 'person-receiver', grants: {} })
    await rejects(h.bus.run(revoked, GRN, { idempotencyKey: key, targetId: order.id, body }), { status: 404 })
    await rejects(h.bus.lookup(revoked, { action: GRN, businessId: BIZ, idempotencyKey: key }), { status: 404 })
    // Another actor holding the same key string gets no one else's receipt.
    const other = h.as({ sub: 'person-other', grants: { [BIZ]: ROLES.receiverFull } })
    await rejects(h.bus.lookup(other, { action: GRN, businessId: BIZ, idempotencyKey: key }), { status: 404, code: 'SCM_OPERATION_NOT_FOUND' })
  })
  test('mutations without an Idempotency-Key are refused before any effect', async () => {
    const order = await h.sentOrder([{ productId: PRODUCTS.plain.id, qty: 5, unitCost: 1 }])
    await rejects(h.bus.run(receiver(), GRN, { idempotencyKey: undefined, targetId: order.id, body: { lines: [{ purchaseOrderLineId: order.lines[0].id, qty: 1 }] } }), { status: 400, code: 'SCM_IDEMPOTENCY_KEY_REQUIRED' })
  })
})

describe('refusals (legacy parity)', () => {
  test('over-receipt is refused whole with the per-line list', async () => {
    const order = await h.sentOrder([{ productId: PRODUCTS.plain.id, qty: 3, unitCost: 1 }])
    const before = await h.snapshot()
    const error = await rejects(h.run(receiver(), GRN, { targetId: order.id, body: { lines: [{ purchaseOrderLineId: order.lines[0].id, qty: 4 }] } }), { status: 409, code: 'PROCUREMENT_RECEIPT_EXCEEDS_ORDERED' })
    assert.equal(error.details[0].outstanding, 3)
    assert.deepEqual(await h.snapshot(), before)
  })
  test('two-ladder rule: receipt permission without Inventory authority posts nothing', async () => {
    const order = await h.sentOrder([{ productId: PRODUCTS.plain.id, qty: 3, unitCost: 1 }])
    const before = await h.snapshot()
    await rejects(h.run(receiver(ROLES.receiverNoInventory), GRN, { targetId: order.id, body: { lines: [{ purchaseOrderLineId: order.lines[0].id, qty: 1 }] } }), { status: 403, code: 'PROCUREMENT_RECEIPT_REQUIRES_INVENTORY_AUTHORITY' })
    // Permission without the inventory DOMAIN is the not-found of the Inventory writer.
    await rejects(h.run(receiver(ROLES.receiverNoInventoryDomain), GRN, { targetId: order.id, body: { lines: [{ purchaseOrderLineId: order.lines[0].id, qty: 1 }] } }), { status: 404 })
    assert.deepEqual(await h.snapshot(), before)
  })
  test('buyer permission alone cannot post receipts; inventory manager alone cannot either', async () => {
    const order = await h.sentOrder([{ productId: PRODUCTS.plain.id, qty: 3, unitCost: 1 }])
    const body = { lines: [{ purchaseOrderLineId: order.lines[0].id, qty: 1 }] }
    await rejects(h.run(receiver(ROLES.buyer), GRN, { targetId: order.id, body }), { status: 404 })
    await rejects(h.run(receiver(ROLES.inventoryOnly), GRN, { targetId: order.id, body }), { status: 404 })
  })
  test('a free-text-only receipt needs no Inventory authority and touches no ledger', async () => {
    const order = await h.sentOrder([{ description: 'Installation service', qty: 1, unitCost: 900 }])
    const res = await h.run(receiver(ROLES.receiverNoInventory), GRN, { targetId: order.id, body: { lines: [{ purchaseOrderLineId: order.lines[0].id, qty: 1 }] } })
    assert.equal(res.order.status, 'RECEIVED')
    assert.equal(await h.count('StockMovement'), 0)
  })
  test('wrong business / wrong tenant / expired delegation are denied before side effects', async () => {
    const order = await h.sentOrder([{ productId: PRODUCTS.plain.id, qty: 3, unitCost: 1 }])
    const body = { lines: [{ purchaseOrderLineId: order.lines[0].id, qty: 1 }] }
    await rejects(h.run(h.as({ sub: 'person-receiver', grants: { [OTHER_BIZ]: ROLES.owner } }), GRN, { targetId: order.id, body }), { status: 404 })
    await rejects(h.run(h.as({ sub: 'person-receiver', tenantId: OTHER_TENANT, grants: { [BIZ]: ROLES.owner } }), GRN, { targetId: order.id, body }), { status: 404 })
    assert.throws(() => h.as({ iat: Math.floor(Date.now() / 1000) - 600 }), (e) => e.code === 'SCM_DELEGATION_EXPIRED')
    assert.throws(() => h.as({ lifetime: 3600 }), (e) => e.code === 'SCM_DELEGATION_INVALID')
    assert.throws(() => h.as({ key: 'x'.repeat(48) }), (e) => e.code === 'SCM_DELEGATION_INVALID')
    assert.equal(await h.count('GoodsReceipt'), 0)
  })
  test('FR-196: the order author cannot receive it unless explicitly attested', async () => {
    const order = await h.sentOrder([{ productId: PRODUCTS.plain.id, qty: 3, unitCost: 1 }])
    const author = h.as({ sub: 'person-buyer', grants: { [BIZ]: ROLES.owner } })
    const body = { lines: [{ purchaseOrderLineId: order.lines[0].id, qty: 1 }] }
    await rejects(h.run(author, GRN, { targetId: order.id, body }), { status: 409, code: 'GOODS_RECEIPT_SELF_POST_FORBIDDEN' })
    const attested = await h.run(author, GRN, { targetId: order.id, body: { ...body, selfVerifyAttested: true } })
    const audit = await h.store.read((sql) => JSON.parse(sql.get("SELECT payloadJson FROM ScmAuditEvent WHERE action = 'GOODS_RECEIPT_POSTED'").payloadJson))
    assert.equal(audit.selfVerified, true)
    assert.equal(attested.order.receiptState, 'PARTIAL')
  })
  test('draft, cancelled and received orders are not receivable', async () => {
    const buyer = h.as({ sub: 'person-buyer', grants: { [BIZ]: ROLES.receiverFull } })
    const { supplier } = await h.run(buyer, 'procurement.supplier.create', { body: { businessId: BIZ, code: 'SUP-D', name: 'Draft Supplier' } })
    const { order } = await h.run(buyer, 'procurement.purchase-order.create', { body: { businessId: BIZ, supplierId: supplier.id, lines: [{ productId: PRODUCTS.plain.id, qty: 1, unitCost: 1 }] } })
    await rejects(h.run(receiver(), GRN, { targetId: order.id, body: { lines: [{ purchaseOrderLineId: order.lines[0].id, qty: 1 }] } }), { status: 409, code: 'PURCHASE_ORDER_NOT_RECEIVABLE' })
  })
  test('SERVICE lines, lot data on uncounted lines, archived SKUs and unknown lines are refused', async () => {
    await rejects(h.sentOrder([{ productId: PRODUCTS.archived.id, qty: 1, unitCost: 1 }]), { status: 409, code: 'PRODUCT_ARCHIVED' })
    await rejects(h.sentOrder([{ productId: PRODUCTS.otherBiz.id, qty: 1, unitCost: 1 }]), { status: 422, code: 'PRODUCT_NOT_FOUND' })
    const order = await h.sentOrder([{ productId: PRODUCTS.service.id, qty: 1, unitCost: 1 }, { productId: PRODUCTS.untracked.id, qty: 2, unitCost: 1 }])
    const [service, untracked] = order.lines
    await rejects(h.run(receiver(), GRN, { targetId: order.id, body: { lines: [{ purchaseOrderLineId: service.id, qty: 1 }] } }), { status: 422, code: 'PROCUREMENT_RECEIPT_LINE_IS_A_SERVICE' })
    await rejects(h.run(receiver(), GRN, { targetId: order.id, body: { lines: [{ purchaseOrderLineId: untracked.id, qty: 1, lotCode: 'L1' }] } }), { status: 422, code: 'PROCUREMENT_RECEIPT_LINE_NOT_COUNTED' })
    await rejects(h.run(receiver(), GRN, { targetId: order.id, body: { lines: [{ purchaseOrderLineId: 'no-such-line', qty: 1 }] } }), { status: 422, code: 'PROCUREMENT_RECEIPT_LINE_NOT_FOUND' })
    const ok = await h.run(receiver(), GRN, { targetId: order.id, body: { lines: [{ purchaseOrderLineId: untracked.id, qty: 2 }] } })
    assert.equal(ok.posted.length, 0, 'UNTRACKED is received on paper, never into a ledger')
  })
  test('lot and serial rules of the Inventory writer hold through the receipt', async () => {
    const order = await h.sentOrder([{ productId: PRODUCTS.lot.id, qty: 5, unitCost: 1 }, { productId: PRODUCTS.serial.id, qty: 3, unitCost: 1 }])
    const [lotLine, serialLine] = order.lines
    await rejects(h.run(receiver(), GRN, { targetId: order.id, body: { lines: [{ purchaseOrderLineId: lotLine.id, qty: 1 }] } }), { status: 422, code: 'INVENTORY_LOT_REQUIRED' })
    await rejects(h.run(receiver(), GRN, { targetId: order.id, body: { lines: [{ purchaseOrderLineId: serialLine.id, qty: 2, serialNos: ['S-1'] }] } }), { status: 422, code: 'INVENTORY_SERIAL_COUNT_MISMATCH' })
    await rejects(h.run(receiver(), GRN, { targetId: order.id, body: { lines: [{ purchaseOrderLineId: serialLine.id, qty: 2, serialNos: ['S-1', 'S-1'] }] } }), { status: 422, code: 'INVENTORY_SERIAL_DUPLICATE' })
    const ok = await h.run(receiver(), GRN, { targetId: order.id, body: { lines: [{ purchaseOrderLineId: serialLine.id, qty: 2, serialNos: ['S-1', 'S-2'] }] } })
    assert.equal(ok.posted[0].movementIds.length, 2, 'one ledger row per serial')
    await rejects(h.run(receiver(), GRN, { targetId: order.id, body: { lines: [{ purchaseOrderLineId: serialLine.id, qty: 1, serialNos: ['S-2'] }] } }), { status: 409, code: 'INVENTORY_SERIAL_ALREADY_IN_STOCK' })
    // A lot's existing expiry is not overwritten by a later receipt.
    await h.run(receiver(), GRN, { targetId: order.id, body: { lines: [{ purchaseOrderLineId: lotLine.id, qty: 2, lotCode: 'L-A', expiresAt: '2027-01-01T00:00:00.000Z' }] } })
    await h.run(receiver(), GRN, { targetId: order.id, body: { lines: [{ purchaseOrderLineId: lotLine.id, qty: 2, lotCode: 'L-A', expiresAt: '2028-01-01T00:00:00.000Z' }] } })
    const lot = await h.store.read((sql) => sql.get("SELECT receivedQty, expiresAt FROM ProductLot WHERE code = 'L-A'"))
    assert.deepEqual({ ...lot }, { receivedQty: 4, expiresAt: '2027-01-01T00:00:00.000Z' })
  })
})

describe('purchase-order lifecycle', () => {
  test('stale version is refused; cancel after a receipt is refused; short-close keeps receipts', async () => {
    const buyer = h.as({ sub: 'person-buyer', grants: { [BIZ]: ROLES.receiverFull } })
    const order = await h.sentOrder([{ productId: PRODUCTS.plain.id, qty: 5, unitCost: 1 }], { buyer })
    await rejects(h.run(buyer, 'procurement.purchase-order.action', { targetId: order.id, body: { action: 'CLOSE', version: order.version - 1 } }), { status: 409, code: 'PURCHASE_ORDER_VERSION_CONFLICT' })
    const received = await h.run(receiver(), GRN, { targetId: order.id, body: { lines: [{ purchaseOrderLineId: order.lines[0].id, qty: 2 }] } })
    await rejects(h.run(buyer, 'procurement.purchase-order.action', { targetId: order.id, body: { action: 'CANCEL', version: received.order.version } }), { status: 409, code: 'PURCHASE_ORDER_HAS_RECEIPTS' })
    await rejects(h.run(buyer, 'procurement.purchase-order.action', { targetId: order.id, body: { action: 'UPDATE', version: received.order.version, fields: { lines: [{ productId: PRODUCTS.plain.id, qty: 9, unitCost: 1 }] } } }), { status: 409, code: 'PURCHASE_ORDER_LINES_LOCKED' })
    const closed = await h.run(buyer, 'procurement.purchase-order.action', { targetId: order.id, body: { action: 'CLOSE', version: received.order.version, reason: 'supplier out of stock' } })
    assert.equal(closed.order.status, 'SHORT_CLOSED')
    assert.equal(closed.order.receiptCount, 1)
  })
})

describe('append-only storage', () => {
  test('the store itself refuses edits or deletes of ledger rows and receipts', async () => {
    const order = await h.sentOrder([{ productId: PRODUCTS.plain.id, qty: 2, unitCost: 1 }])
    await h.run(receiver(), GRN, { targetId: order.id, body: { lines: [{ purchaseOrderLineId: order.lines[0].id, qty: 2 }] } })
    await assert.rejects(h.store.transaction((sql) => sql.run('UPDATE StockMovement SET quantity = 999')), /INVENTORY_LEDGER_APPEND_ONLY/)
    await assert.rejects(h.store.transaction((sql) => sql.run('DELETE FROM StockMovement')), /INVENTORY_LEDGER_APPEND_ONLY/)
    await assert.rejects(h.store.transaction((sql) => sql.run("UPDATE GoodsReceipt SET notes = 'x'")), /GOODS_RECEIPT_IMMUTABLE/)
  })
})
