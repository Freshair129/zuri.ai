// Sales orders (FR-166) through the real SCM use cases and store. Mirrors
// apps/server fr166-sales-order.test.js AC-162.1..6 (marked [legacy]) and adds
// the Commerce cohort end to end (order → payment → cancel → refund),
// idempotency, rollback and version-CAS cases.
import { test, describe, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { createHarness, rejects } from '../support/harness.js'
import { BIZ, OTHER_BIZ, PRODUCTS, idem } from '../support/fixtures.js'

const CREATE = 'commerce.sales-order.create'
const ACTION = 'commerce.sales-order.action'
const DOMAINS = ['commerce', 'inventory']
const G = {
  owner: { [BIZ]: { owner: true, domains: DOMAINS, permissions: [] }, [OTHER_BIZ]: { owner: true, domains: DOMAINS, permissions: [] } },
  rep: { [BIZ]: { owner: false, domains: DOMAINS, permissions: ['commerce.order.write'] } },
  repWithStock: { [BIZ]: { owner: false, domains: DOMAINS, permissions: ['commerce.order.write', 'inventory.catalog.write'] } },
  member: { [BIZ]: { owner: false, domains: DOMAINS, permissions: [] } },
  noDomain: { [BIZ]: { owner: true, domains: ['projects'], permissions: [] } },
  verifier: { [BIZ]: { owner: false, domains: ['commerce'], permissions: ['commerce.payment.verify'] } },
}
let h
beforeEach(() => { h = createHarness({ seed: { stock: [{ productId: PRODUCTS.plain.id, quantity: 5 }] } }) })
afterEach(() => h.close())
const as = (who) => h.as({ sub: `per-${who}`, grants: G[who] })
const lines = () => [{ productId: PRODUCTS.plain.id, qty: 2, unitPrice: 745, discount: 45 }, { description: 'ค่าจัดส่ง', qty: 1, unitPrice: 100 }]
const create = (over = {}, who = 'owner') => h.run(as(who), CREATE, { body: { businessId: BIZ, lines: lines(), ...over } }).then((r) => r.order)
const act = (id, body, who = 'owner') => h.run(as(who), ACTION, { targetId: id, body }).then((r) => r.order)
const onHand = async () => (await h.bus.queries.stock(as('owner'), BIZ)).products.find((p) => p.code === PRODUCTS.plain.code).onHand

describe('[legacy] AC-162.1..3 — create, references, authority', () => {
  test('ORD code, exact totals from lines, the product lends its name, one audit row', async () => {
    const order = await create({ discount: 50, notes: 'ส่งวันศุกร์' }, 'rep')
    assert.match(order.code, /^ORD-\d{8}-001$/)
    assert.deepEqual([order.businessId, order.origin, order.status, order.currency, order.attributed, order.version, order.createdByPersonId], [BIZ, 'WALK_IN', 'DRAFT', 'THB', false, 1, 'per-rep'])
    assert.deepEqual(order.lines.map((l) => [l.description, l.qty, l.unitPrice, l.discount, l.lineTotal]), [['SYN-PLAIN', 2, 745, 45, 1445], ['ค่าจัดส่ง', 1, 100, 0, 100]])
    assert.deepEqual([order.subtotal, order.lineDiscount, order.discount, order.total, order.paid, order.balanceDue, order.paymentState], [1590, 45, 50, 1495, 0, 1495, 'UNPAID'])
    assert.match((await create()).code, /^ORD-\d{8}-002$/)
    const audits = await h.store.read((sql) => sql.all("SELECT action FROM ScmAuditEvent WHERE entityType = 'SALES_ORDER' AND entityId = ?", order.id).map((a) => a.action))
    assert.deepEqual(audits, ['SALES_ORDER_CREATED'])
  })
  test('a Conversation makes the sale CHAT and supplies its Customer; references stay inside the Tenant', async () => {
    const chat = await create({ conversationId: 'conv-own', origin: 'ONLINE' })
    assert.deepEqual([chat.origin, chat.attributed, chat.customerId], ['CHAT', true, 'cust-own'])
    assert.deepEqual(chat.customer, { id: 'cust-own' }, 'D-5: the display name stays with CRM')
    await rejects(create({ customerId: 'cust-other-tenant' }), { status: 422, code: 'CUSTOMER_NOT_FOUND' })
    await rejects(create({ conversationId: 'conv-own', customerId: 'cust-other-tenant' }), { status: 422, code: 'CUSTOMER_NOT_FOUND' })
    await rejects(create({ conversationId: 'conv-own', customerId: 'cust-shared' }), { status: 422, code: 'CONVERSATION_CUSTOMER_MISMATCH' })
    await rejects(create({ conversationId: 'no-such' }), { status: 422, code: 'CONVERSATION_NOT_FOUND' })
    await rejects(create({ conversationId: 'conv-hidden' }), { status: 422, code: 'CONVERSATION_NOT_FOUND' })
    await rejects(create({ lines: [{ productId: PRODUCTS.otherBiz.id, qty: 1, unitPrice: 1 }] }), { status: 422, code: 'PRODUCT_NOT_FOUND' })
    // Legacy visibility rule, kept exactly: a customer bound to ANOTHER Business the actor can see is accepted.
    assert.equal((await create({ customerId: 'cust-foreign' })).customerId, 'cust-foreign')
    await rejects(create({ customerId: 'cust-foreign' }, 'rep'), { status: 422, code: 'CUSTOMER_NOT_FOUND' })
    await rejects(create({ customerId: 'cust-hidden' }), { status: 422, code: 'CUSTOMER_NOT_FOUND' })
    assert.equal((await create({ customerId: 'cust-shared' })).customerId, 'cust-shared')
  })
  test('the ladder: commerce domain gate, then OWNER or SALES_REP writes; members read', async () => {
    assert.equal((await h.bus.queries.orders(as('member'), { businessId: BIZ })).businessId, BIZ)
    await rejects(create({}, 'member'), { status: 404 })
    await rejects(h.bus.queries.orders(as('noDomain'), { businessId: BIZ }), { status: 404 })
    await rejects(h.bus.queries.salesOrder(as('owner'), 'no-such-order'), { status: 404 })
    const order = await create({}, 'rep')
    assert.equal((await h.bus.queries.salesOrder(as('member'), order.id)).order.id, order.id)
    await rejects(act(order.id, { action: 'CONFIRM', version: 1 }, 'member'), { status: 404 })
  })
})

describe('[legacy] AC-162.4..6 — lifecycle and fulfilment', () => {
  test('UPDATE replaces lines only while DRAFT; CONFIRM locks them; stale version conflicts; COMPLETE without stock', async () => {
    const order = await create()
    const updated = await act(order.id, { action: 'UPDATE', version: 1, fields: { lines: [{ description: 'บริการห่อ', qty: 3, unitPrice: 20 }], discount: 0, notes: 'แก้ไข' } })
    assert.deepEqual([updated.total, updated.notes, updated.version, updated.lines.length], [60, 'แก้ไข', 2, 1])
    const confirmed = await act(order.id, { action: 'CONFIRM', version: 2 }, 'rep')
    assert.deepEqual([confirmed.status, confirmed.version, Boolean(confirmed.confirmedAt)], ['CONFIRMED', 3, true])
    await rejects(act(order.id, { action: 'UPDATE', version: 3, fields: { lines: [{ description: 'x', qty: 1, unitPrice: 1 }] } }), { status: 409, code: 'SALES_ORDER_LINES_LOCKED' })
    assert.deepEqual([(await act(order.id, { action: 'UPDATE', version: 3, fields: { notes: 'ยังแก้หมายเหตุได้' } })).version], [4])
    await rejects(act(order.id, { action: 'CONFIRM', version: 4 }), { status: 409, code: 'SALES_ORDER_STATUS_INVALID' })
    await rejects(act(order.id, { action: 'CANCEL', version: 1 }), { status: 409, code: 'SALES_ORDER_VERSION_CONFLICT' })
    const done = await act(order.id, { action: 'COMPLETE', version: 4 })
    assert.deepEqual([done.status, done.stockIssuedAt], ['COMPLETED', null])
  })
  test('COMPLETE + issueStock takes every counted line, or nothing; shortage is reported whole; serial refused', async () => {
    const order = await create({ lines: [{ productId: PRODUCTS.plain.id, qty: 2, unitPrice: 745 }, { productId: PRODUCTS.untracked.id, qty: 2, unitPrice: 30 }, { description: 'ค่าจัดส่ง', qty: 1, unitPrice: 100 }] }, 'rep')
    await act(order.id, { action: 'CONFIRM', version: 1 }, 'rep')
    await rejects(act(order.id, { action: 'COMPLETE', version: 2, issueStock: true }, 'rep'), { status: 403, code: 'COMMERCE_STOCK_ISSUE_REQUIRES_INVENTORY_AUTHORITY' })
    const res = await h.run(as('repWithStock'), ACTION, { targetId: order.id, body: { action: 'COMPLETE', version: 2, issueStock: true } })
    assert.deepEqual([res.order.status, res.order.version, Boolean(res.order.stockIssuedAt)], ['COMPLETED', 3, true])
    assert.equal(await onHand(), 3)
    const issued = await h.store.read((sql) => sql.all('SELECT kind, quantity FROM StockMovement WHERE reference = ?', `ORDER:${order.code}`).map((m) => [m.kind, m.quantity]))
    assert.deepEqual(issued, [['ISSUE', -2]])
    const audit = await h.store.read((sql) => JSON.parse(sql.get("SELECT payloadJson FROM ScmAuditEvent WHERE entityType = 'SALES_ORDER' AND entityId = ? AND action = 'SALES_ORDER_COMPLETED'", order.id).payloadJson))
    assert.deepEqual(audit.issued, [{ productId: PRODUCTS.plain.id, code: 'SYN-PLAIN', quantity: 2, onHandAfter: 3 }], 'legacy audit shape')

    const big = await create({ lines: [{ productId: PRODUCTS.plain.id, qty: 10, unitPrice: 745 }] })
    await act(big.id, { action: 'CONFIRM', version: 1 })
    const before = await h.snapshot()
    const error = await rejects(act(big.id, { action: 'COMPLETE', version: 2, issueStock: true }), { status: 409, code: 'COMMERCE_STOCK_SHORTAGE' })
    assert.deepEqual(error.details, [{ productId: PRODUCTS.plain.id, code: 'SYN-PLAIN', required: 10, onHand: 3, shortage: 7 }])
    assert.deepEqual(await h.snapshot(), before)
    assert.equal((await h.bus.queries.salesOrder(as('owner'), big.id)).order.status, 'CONFIRMED')

    const serial = await create({ lines: [{ productId: PRODUCTS.serial.id, qty: 1, unitPrice: 1 }] })
    await act(serial.id, { action: 'CONFIRM', version: 1 })
    await rejects(act(serial.id, { action: 'COMPLETE', version: 2, issueStock: true }), { status: 422, code: 'COMMERCE_SERIAL_LINE_UNSUPPORTED' })
  })
  test('F-10 parity: fulfilment issues a dedicated SKU (the issue names neither customer nor order)', async () => {
    await h.close()
    h = createHarness({ seed: { stock: [{ productId: PRODUCTS.dedicated.id, quantity: 3 }] } })
    const order = await create({ lines: [{ productId: PRODUCTS.dedicated.id, qty: 1, unitPrice: 1 }] })
    await act(order.id, { action: 'CONFIRM', version: 1 })
    assert.equal((await act(order.id, { action: 'COMPLETE', version: 2, issueStock: true })).status, 'COMPLETED')
  })
  test('CANCEL keeps the row; the list hides closed orders unless asked and summarises open work', async () => {
    const mk = (title) => create({ lines: [{ description: title, qty: 1, unitPrice: 100 }] })
    const a = await mk('a'); const b = await mk('b'); const c = await mk('c')
    await act(b.id, { action: 'CONFIRM', version: 1 })
    const cancelled = await act(c.id, { action: 'CANCEL', version: 1, reason: 'ลูกค้ายกเลิก' })
    assert.deepEqual([cancelled.status, cancelled.cancelReason], ['CANCELLED', 'ลูกค้ายกเลิก'])
    const open = await h.bus.queries.orders(as('owner'), { businessId: BIZ })
    assert.deepEqual(open.orders.map((o) => o.id).sort(), [a.id, b.id].sort())
    assert.deepEqual(open.summary, { open: 2, unpaid: 2, pendingPayments: 0 })
    assert.equal((await h.bus.queries.orders(as('owner'), { businessId: BIZ, includeClosed: true })).orders.length, 3)
    assert.deepEqual((await h.bus.queries.orders(as('owner'), { businessId: BIZ, status: 'CANCELLED' })).orders.map((o) => o.id), [c.id])
  })
})

describe('the Commerce cohort in one store', () => {
  test('order → payment → verify → cancel → refund, all in SCM (closes D-8 for SCM-created orders)', async () => {
    const order = await create({ lines: [{ description: 'Gift set', qty: 1, unitPrice: 1000 }] }, 'rep')
    const pay = await h.run(as('rep'), 'commerce.payment.record', { targetId: order.id, body: { method: 'TRANSFER', amount: 1000 } })
    const verified = await h.run(as('verifier'), 'commerce.payment.action', { targetId: pay.payment.id, body: { action: 'VERIFY', version: 1 } })
    assert.equal(verified.order.paymentState, 'PAID')
    await act(order.id, { action: 'CANCEL', version: 1, reason: 'คืนสินค้า' })
    await rejects(h.run(as('rep'), 'commerce.payment.record', { targetId: order.id, body: { method: 'CASH', amount: 1 } }), { status: 409, code: 'SALES_ORDER_CANCELLED' })
    const refund = await h.run(as('rep'), 'commerce.payment.record', { targetId: order.id, body: { kind: 'REFUND', method: 'TRANSFER', amount: 1000 } })
    const refunded = await h.run(as('verifier'), 'commerce.payment.action', { targetId: refund.payment.id, body: { action: 'VERIFY', version: 1 } })
    assert.deepEqual([refunded.order.status, refunded.order.paymentState, refunded.order.net], ['CANCELLED', 'REFUNDED', 0])
  })
})

describe('idempotency and rollback', () => {
  test('create and complete replay on their keys; a timed-out COMPLETE never issues twice', async () => {
    const key = idem('so')
    const body = { businessId: BIZ, lines: [{ productId: PRODUCTS.plain.id, qty: 1, unitPrice: 5 }] }
    const first = await h.bus.run(as('owner'), CREATE, { idempotencyKey: key, body })
    const again = await h.bus.run(as('owner'), CREATE, { idempotencyKey: key, body })
    assert.deepEqual([again.replayed, again.order.id], [true, first.order.id])
    await act(first.order.id, { action: 'CONFIRM', version: 1 })
    const ckey = idem('complete')
    const done = await h.bus.run(as('owner'), ACTION, { idempotencyKey: ckey, targetId: first.order.id, body: { action: 'COMPLETE', version: 2, issueStock: true } })
    const retry = await h.bus.run(as('owner'), ACTION, { idempotencyKey: ckey, targetId: first.order.id, body: { action: 'COMPLETE', version: 2, issueStock: true } })
    assert.deepEqual([retry.replayed, retry.order.version], [true, done.order.version])
    assert.equal(await onHand(), 4, 'issued once')
    await rejects(h.bus.run(as('member'), ACTION, { idempotencyKey: ckey, targetId: first.order.id, body: { action: 'COMPLETE', version: 2, issueStock: true } }), { status: 404 })
  })
  for (const point of ['afterStockIssue', 'beforeOrderUpdate', 'afterAudit']) {
    test(`fault at ${point} during fulfilment: no issue, no status change, no audit/outbox/receipt`, async () => {
      let armed = false // armed only for COMPLETE: the same hooks fire on CONFIRM
      await h.close()
      h = createHarness({ seed: { stock: [{ productId: PRODUCTS.plain.id, quantity: 5 }] }, faults: { [ACTION]: { [point]: () => { if (armed) throw Object.assign(new Error('injected'), { status: 500, code: 'TEST_FAULT' }) } } } })
      const order = await create({ lines: [{ productId: PRODUCTS.plain.id, qty: 2, unitPrice: 5 }] })
      await act(order.id, { action: 'CONFIRM', version: 1 })
      const before = await h.snapshot()
      const key = idem('complete')
      armed = true
      await rejects(h.bus.run(as('owner'), ACTION, { idempotencyKey: key, targetId: order.id, body: { action: 'COMPLETE', version: 2, issueStock: true } }), { code: 'TEST_FAULT' })
      assert.deepEqual(await h.snapshot(), before)
      assert.equal((await h.bus.queries.salesOrder(as('owner'), order.id)).order.status, 'CONFIRMED')
      armed = false
      assert.equal((await h.bus.run(as('owner'), ACTION, { idempotencyKey: key, targetId: order.id, body: { action: 'COMPLETE', version: 2, issueStock: true } })).order.status, 'COMPLETED')
      assert.equal(await onHand(), 3)
    })
  }
})
