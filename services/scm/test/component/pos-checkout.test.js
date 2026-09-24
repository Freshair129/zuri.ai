// POS checkout (FR-183) through the real SCM use case and store. Mirrors every
// case of apps/server/tests/integration/fr183-pos.test.js (marked [legacy]) and
// adds FEFO / dedication / reference / idempotency / rollback cases.
// Acceptance B14 (checkout half), B11 (issue half), C17, C18, C20, D23.
import { test, describe, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { createHarness, rejects } from '../support/harness.js'
import { BIZ, LOCATIONS, OTHER_BIZ, PRODUCTS, REFERENCE_FIXTURE, ROLES, idem } from '../support/fixtures.js'
import { createFixtureReferenceAuthority, createUnavailableReferenceAuthority } from '../../src/infrastructure/reference-authority.js'

const POS = 'commerce.pos.checkout'
const DAY = 86_400_000
const seed = {
  locations: Object.values(LOCATIONS),
  stock: [{ productId: PRODUCTS.plain.id, quantity: 10 }, { productId: PRODUCTS.dedicated.id, quantity: 5 }, { productId: PRODUCTS.dedicatedCustomer.id, quantity: 5 }],
}
let h
const make = (options = {}) => { h = createHarness({ ...options, seed: { ...seed, ...(options.seed ?? {}) } }) }
afterEach(() => h?.close())
const cashier = (role = ROLES.cashier, extra = {}) => h.as({ sub: 'person-cashier', grants: { [BIZ]: role }, ...extra })
const body = (over = {}) => ({
  businessId: BIZ, branchId: 'branch-main', warehouseLocationId: LOCATIONS.shop.id,
  lines: [{ productId: PRODUCTS.plain.id, qty: 2, unitPrice: 10, ...(over.line ?? {}) }],
  payment: { method: 'CASH', receivedAmount: 25, ...(over.payment ?? {}) },
  ...(over.meta ?? {}),
})
const checkout = (over, scope = cashier()) => h.run(scope, POS, { body: body(over) })
const counts = () => h.snapshot().then((s) => ({ orders: s.SalesOrder, payments: s.Payment, movements: s.StockMovement, receipts: s.ScmOperationReceipt, outbox: s.ScmOutbox }))

describe('happy path', () => {
  beforeEach(() => make())
  test('[legacy] completed WALK_IN order + PENDING payment + located issue, exact change, atomically', async () => {
    const r = await checkout()
    assert.equal(r.success, true)
    assert.deepEqual([r.status, r.paymentStatus, r.totalSatang, r.totalAmount, r.receivedAmount, r.changeAmount, r.paymentMethod], ['PENDING', 'PENDING', 2000, 20, 25, 5, 'CASH'])
    assert.deepEqual([r.branch.id, r.warehouseLocation.id], ['branch-main', LOCATIONS.shop.id])
    assert.deepEqual([r.order.status, r.order.origin, r.order.paymentState, r.order.pending], ['COMPLETED', 'WALK_IN', 'UNPAID', 20])
    assert.match(r.orderCode, /^ORD-\d{8}-001$/)
    assert.match(r.paymentCode, /^PAY-\d{8}-001$/)
    const move = await h.store.read((sql) => sql.get("SELECT * FROM StockMovement WHERE salesOrderId = ? AND kind = 'ISSUE'", r.orderId))
    assert.deepEqual([move.quantity, move.sourceLocationId, move.reference, move.productId], [-2, LOCATIONS.shop.id, `POS:${r.orderCode}`, PRODUCTS.plain.id])
    const pay = await h.store.read((sql) => sql.get('SELECT amountSatang, status, verifiedAt, verifiedByPersonId FROM Payment WHERE id = ?', r.paymentId))
    assert.deepEqual({ ...pay }, { amountSatang: 2000, status: 'PENDING', verifiedAt: null, verifiedByPersonId: null }, 'checkout never verifies money')
    const order = await h.store.read((sql) => sql.get('SELECT stockIssuedAt, closedByPersonId FROM SalesOrder WHERE id = ?', r.orderId))
    assert.ok(order.stockIssuedAt)
    assert.equal(order.closedByPersonId, 'person-cashier')
    const audit = await h.store.read((sql) => sql.all('SELECT action FROM ScmAuditEvent').map((a) => a.action))
    for (const a of ['SALES_ORDER_CREATED', 'STOCK_ISSUE_RECORDED', 'PAYMENT_RECORDED', 'SALES_ORDER_COMPLETED']) assert.ok(audit.includes(a), a)
    assert.equal((await h.bus.queries.stock(cashier(), BIZ)).products.find((p) => p.code === 'SYN-PLAIN').onHand, 8)
    assert.equal(r.references.authority, 'fixture')
    await h.reopen()
    assert.deepEqual((await h.bus.queries.salesOrder(cashier(), r.orderId)).order, r.order, 'restart readback identical')
  })
  test('manual price is kept exactly; untracked lines are sold without a ledger row', async () => {
    const r = await h.run(cashier(), POS, { body: { ...body(), lines: [{ productId: PRODUCTS.untracked.id, qty: 3, unitPrice: 123.45, discount: 0.35 }, { description: 'Gift wrap', qty: 1, unitPrice: 20 }], payment: { method: 'CASH', receivedAmount: 400 } } })
    assert.equal(r.totalSatang, 3 * 12345 - 35 + 2000)
    assert.deepEqual(r.stockDeductions, [])
    assert.equal(r.order.stockIssuedAt, null)
    assert.equal(await h.count('StockMovement'), 3, 'only the 3 opening rows')
  })
  test('[legacy] int32 overflow is refused before any write; maximum cash change stays exact', async () => {
    const before = await counts()
    await rejects(checkout({ line: { qty: 2, unitPrice: 15000000 }, payment: { receivedAmount: 30000000 } }), { status: 422, code: 'POS_AMOUNT_INVALID' })
    await rejects(checkout({ line: { qty: Number.MAX_SAFE_INTEGER }, payment: { receivedAmount: 1000000000000 } }), { status: 422, code: 'POS_AMOUNT_INVALID' })
    await assert.rejects(checkout({ payment: { receivedAmount: 20.001 } }))
    assert.deepEqual(await counts(), before)
    const max = await checkout({ line: { qty: 1, unitPrice: 0.01 }, payment: { receivedAmount: 21474836.47 } })
    assert.deepEqual([max.totalSatang, max.receivedAmountSatang, max.changeAmountSatang], [1, 2147483647, 2147483646])
  })
  test('cash short and non-cash mismatch are refused', async () => {
    await rejects(checkout({ payment: { receivedAmount: 19.99 } }), { status: 422, code: 'POS_CASH_INSUFFICIENT' })
    await rejects(checkout({ payment: { method: 'TRANSFER', receivedAmount: 25 } }), { status: 422, code: 'POS_PAYMENT_AMOUNT_MISMATCH' })
    const exact = await checkout({ payment: { method: 'TRANSFER', receivedAmount: 20 } })
    assert.equal(exact.changeAmountSatang, 0)
  })
})

describe('authority and references', () => {
  test('[legacy] needs Commerce order authority AND Inventory write authority; foreign scope is not found', async () => {
    let calls = 0
    const counting = createFixtureReferenceAuthority(REFERENCE_FIXTURE)
    const spy = { ...counting, branch: async (...a) => { calls += 1; return counting.branch(...a) } }
    make({ references: spy })
    await rejects(checkout({}, cashier(ROLES.commerceViewer)), { status: 404 })
    await rejects(checkout({}, cashier(ROLES.salesRepOnly)), { status: 403, code: 'POS_STOCK_ISSUE_REQUIRES_INVENTORY_AUTHORITY' })
    await rejects(checkout({}, h.as({ sub: 'x', grants: { [OTHER_BIZ]: { owner: true, domains: ['commerce', 'inventory'], permissions: [] } } })), { status: 404 })
    await rejects(checkout({}, cashier(ROLES.receiverFull)), { status: 404 }, 'procurement grants do not sell')
    assert.equal(calls, 0, 'an unauthorized caller triggers no reference lookup')
  })
  test('[legacy] branch and location must be ACTIVE, physical and of this Business', async () => {
    make()
    for (const branchId of ['wrong-branch', 'branch-closed', 'branch-foreign']) await rejects(checkout({ meta: { branchId } }), { status: 422, code: 'POS_BRANCH_NOT_CONFIGURED' })
    for (const loc of ['wrong-location', LOCATIONS.virtual.id, LOCATIONS.foreign.id]) await rejects(checkout({ meta: { warehouseLocationId: loc } }), { status: 422, code: 'WAREHOUSE_LOCATION_NOT_FOUND' })
  })
  test('customers: own and tenant-shared accepted; deleted, foreign and unknown refused; no CRM display data copied', async () => {
    make()
    const own = await checkout({ meta: { customerId: 'cust-own' } })
    assert.deepEqual(own.order.customer, { id: 'cust-own', code: 'CUS-OWN' })
    assert.ok(!JSON.stringify(own).includes('Synthetic Buyer'), 'displayName is not copied into SCM')
    const shared = await checkout({ meta: { customerId: 'cust-shared' } })
    assert.equal(shared.order.customerId, 'cust-shared')
    for (const customerId of ['cust-deleted', 'cust-foreign', 'cust-unknown']) await rejects(checkout({ meta: { customerId } }), { status: 422, code: 'CUSTOMER_NOT_FOUND' })
    const stored = await h.store.read((sql) => sql.all('SELECT customerId FROM StockMovement WHERE salesOrderId = ?', own.orderId))
    assert.equal(stored[0].customerId, 'cust-own')
  })
  test('payment slips come from Files: a missing/deleted slip rolls the whole sale back', async () => {
    make()
    const ok = await checkout({ payment: { method: 'TRANSFER', receivedAmount: 20, slipFileAssetId: 'slip-own' } })
    assert.equal(ok.payment.slipFileAssetId, 'slip-own')
    const before = await counts()
    await rejects(checkout({ payment: { method: 'TRANSFER', receivedAmount: 20, slipFileAssetId: 'slip-deleted' } }), { status: 422, code: 'PAYMENT_SLIP_NOT_FOUND' })
    assert.deepEqual(await counts(), before, 'the stock issue that ran before the slip check is rolled back')
  })
  test('reference owner unavailable → retryable 503, no effect; a committed sale still replays', async () => {
    make()
    const key = idem('pos')
    const committed = await h.bus.run(cashier(), POS, { idempotencyKey: key, body: body() })
    const down = createUnavailableReferenceAuthority()
    const { createCommandBus } = await import('../../src/application/commands.js')
    const bus = createCommandBus({ store: h.store, references: down })
    const before = await counts()
    const error = await rejects(bus.run(cashier(), POS, { idempotencyKey: idem('pos'), body: body() }), { status: 503, code: 'SCM_REFERENCE_AUTHORITY_UNAVAILABLE' })
    assert.equal(error.retryable, true)
    assert.deepEqual(await counts(), before)
    const replay = await bus.run(cashier(), POS, { idempotencyKey: key, body: body() })
    assert.deepEqual([replay.replayed, replay.orderId], [true, committed.orderId])
  })
})

describe('stock rules through the Inventory writer', () => {
  test('[legacy] shortage and duplicate bank reference roll everything back; reference stays unique', async () => {
    make()
    const before = await counts()
    await rejects(checkout({ line: { qty: 100 }, payment: { bankReference: 'POS-DUP-1', receivedAmount: 1000 } }), { status: 409, code: 'INVENTORY_INSUFFICIENT_STOCK' })
    assert.deepEqual(await counts(), before)
    await checkout({ payment: { bankReference: 'POS-DUP-1' } })
    await rejects(checkout({ payment: { bankReference: 'POS-DUP-1' } }), { status: 409, code: 'PAYMENT_REFERENCE_TAKEN' })
    assert.equal(await h.store.read((sql) => sql.get("SELECT COUNT(*) AS n FROM Payment WHERE bankReference = 'POS-DUP-1'").n), 1)
  })
  test('serial, archived and foreign products are refused as before', async () => {
    make()
    await rejects(checkout({ line: { productId: PRODUCTS.serial.id } }), { status: 422, code: 'POS_SERIAL_LINE_UNSUPPORTED' })
    await rejects(checkout({ line: { productId: PRODUCTS.archived.id } }), { status: 409, code: 'PRODUCT_ARCHIVED' })
    await rejects(checkout({ line: { productId: PRODUCTS.otherBiz.id } }), { status: 422, code: 'PRODUCT_NOT_FOUND' })
  })
  test('FEFO: earliest expiry first, lots past storage limit skipped, remainder refused as STORAGE_EXPIRED', async () => {
    const now = Date.now()
    make({ seed: {
      lots: [
        { id: 'lot-late', code: 'L-LATE', productId: PRODUCTS.aged.id, expiresAt: new Date(now + 90 * DAY).toISOString(), manufacturedAt: new Date(now - 5 * DAY).toISOString() },
        { id: 'lot-early', code: 'L-EARLY', productId: PRODUCTS.aged.id, expiresAt: new Date(now + 10 * DAY).toISOString(), manufacturedAt: new Date(now - 5 * DAY).toISOString() },
        { id: 'lot-stale', code: 'L-STALE', productId: PRODUCTS.aged.id, expiresAt: new Date(now + 5 * DAY).toISOString(), manufacturedAt: new Date(now - 60 * DAY).toISOString() },
      ],
      stock: [{ productId: PRODUCTS.aged.id, lotId: 'lot-late', quantity: 4 }, { productId: PRODUCTS.aged.id, lotId: 'lot-early', quantity: 3 }, { productId: PRODUCTS.aged.id, lotId: 'lot-stale', quantity: 9 }],
    } })
    const r = await checkout({ line: { productId: PRODUCTS.aged.id, qty: 5 }, payment: { receivedAmount: 50 } })
    const rows = await h.store.read((sql) => sql.all('SELECT lotId, quantity FROM StockMovement WHERE salesOrderId = ? ORDER BY quantity', r.orderId))
    assert.deepEqual(rows.map((x) => [x.lotId, x.quantity]).sort(), [['lot-early', -3], ['lot-late', -2]].sort(), 'expired-storage lot never picked')
    const before = await counts()
    const error = await rejects(checkout({ line: { productId: PRODUCTS.aged.id, qty: 3 }, payment: { receivedAmount: 50 } }), { status: 409, code: 'INVENTORY_LOT_STORAGE_EXPIRED' })
    assert.equal(error.details.blockedLots[0].lotId, 'lot-stale')
    assert.deepEqual(await counts(), before)
  })
  test('dedicated stock leaves only for its own order/customer', async () => {
    make()
    await rejects(checkout({ line: { productId: PRODUCTS.dedicated.id } }), { status: 409, code: 'INVENTORY_CUSTOM_COMPONENT_WRONG_SALES_ORDER' })
    await rejects(checkout({ line: { productId: PRODUCTS.dedicatedCustomer.id }, meta: { customerId: 'cust-own' } }), { status: 409, code: 'INVENTORY_CUSTOM_COMPONENT_WRONG_CUSTOMER' })
    const ok = await checkout({ line: { productId: PRODUCTS.dedicatedCustomer.id }, meta: { customerId: 'cust-shared' } })
    assert.equal(ok.stockDeductions[0].quantity, 2)
  })
})

describe('QR / PromptPay', () => {
  test('[legacy] QR needs a configured profile and stays PENDING', async () => {
    make()
    await rejects(checkout({ payment: { method: 'QR', receivedAmount: 20 } }), { status: 422, code: 'PROMPTPAY_NOT_CONFIGURED' })
    await h.close()
    make({ seed: { billingProfiles: [{ businessId: BIZ }] } })
    const r = await checkout({ payment: { method: 'QR', receivedAmount: 20 } })
    assert.deepEqual([r.paymentStatus, r.paymentMethod, r.promptPay.provider, r.promptPay.amountSatang], ['PENDING', 'QR', 'PROMPTPAY', 2000])
    assert.equal(typeof r.promptPay.payload, 'string')
    await rejects(checkout({ payment: { method: 'QR', receivedAmount: 20 }, line: { qty: 1 } }, cashier(ROLES.commerceViewer)), { status: 404 })
  })
  test('an unverified or inactive PromptPay profile is not configured', async () => {
    make({ seed: { billingProfiles: [{ businessId: BIZ, promptPayActive: false }] } })
    await rejects(checkout({ payment: { method: 'QR', receivedAmount: 20 } }), { status: 422, code: 'PROMPTPAY_NOT_CONFIGURED' })
  })
})

describe('idempotency, lookup and rollback', () => {
  test('same key replays the sale; different payload conflicts; a timeout retry never sells twice', async () => {
    make()
    const key = idem('pos')
    const first = await h.bus.run(cashier(), POS, { idempotencyKey: key, body: body() })
    const before = await counts()
    const replay = await h.bus.run(cashier(), POS, { idempotencyKey: key, body: body() })
    assert.deepEqual([replay.replayed, replay.orderId, replay.paymentId], [true, first.orderId, first.paymentId])
    assert.deepEqual(await counts(), before)
    await rejects(h.bus.run(cashier(), POS, { idempotencyKey: key, body: body({ line: { qty: 3 } }) }), { status: 409, code: 'SCM_IDEMPOTENCY_KEY_CONFLICT' })
    const found = await h.bus.lookup(cashier(), { action: POS, businessId: BIZ, idempotencyKey: key })
    assert.deepEqual([found.operation.affected.salesOrderId, found.operation.affected.paymentStatus], [first.orderId, 'PENDING'])
    await rejects(h.bus.lookup(cashier(ROLES.salesRepOnly, { grants: { [BIZ]: { owner: false, domains: ['commerce'], permissions: ['commerce.order.write'] } } }), { action: POS, businessId: BIZ, idempotencyKey: key }), { status: 404 }, 'replay shows on-hand: needs inventory view')
  })
  for (const point of ['afterOrderInsert', 'afterStockIssue', 'beforePayment', 'afterAudit']) {
    test(`fault at ${point}: order, lines, issue, fence, payment, audit, outbox, receipt all roll back`, async () => {
      let armed = true
      make({ faults: { [POS]: { [point]: () => { if (armed) throw Object.assign(new Error('injected'), { status: 500, code: 'TEST_FAULT' }) } } } })
      const key = idem('pos-fault')
      const before = await h.snapshot()
      await rejects(h.bus.run(cashier(), POS, { idempotencyKey: key, body: body() }), { code: 'TEST_FAULT' })
      assert.deepEqual(await h.snapshot(), before)
      armed = false
      const ok = await h.bus.run(cashier(), POS, { idempotencyKey: key, body: body() })
      assert.equal(ok.replayed, false)
      const after = await h.snapshot()
      assert.deepEqual([after.SalesOrder, after.Payment, after.StockMovement - before.StockMovement], [before.SalesOrder + 1, before.Payment + 1, 1])
    })
  }
})
