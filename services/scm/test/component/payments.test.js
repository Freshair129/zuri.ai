// Payments (FR-163, FR-196) through the real SCM use cases and store. Mirrors
// apps/server fr163-payment.test.js AC-163.1..3 and the payment half of
// fr196-segregation-of-duties.test.js (marked [legacy]). AC-163.4 (revenue
// read model) has not moved and is not claimed here.
import { test, describe, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { createHarness, rejects } from '../support/harness.js'
import { BIZ, OTHER_BIZ, TENANT, idem } from '../support/fixtures.js'

const RECORD = 'commerce.payment.record'
const ACTION = 'commerce.payment.action'
const G = {
  rep: { owner: false, domains: ['commerce'], permissions: ['commerce.order.write'] },
  verifier: { owner: false, domains: ['commerce'], permissions: ['commerce.payment.verify'] },
  owner: { owner: true, domains: ['commerce'], permissions: [] },
  member: { owner: false, domains: ['commerce'], permissions: [] },
  noDomain: { owner: true, domains: ['projects'], permissions: [] },
}
let h
beforeEach(() => { h = createHarness() })
afterEach(() => h.close())
const as = (who, grant = G[who]) => h.as({ sub: `per-${who}`, grants: { [BIZ]: grant } })

/** Synthetic order rows (order creation has not moved to SCM yet). */
async function order({ status = 'CONFIRMED', totalSatang = 100000, businessId = BIZ } = {}) {
  const id = randomUUID()
  const now = new Date().toISOString()
  await h.store.transaction((sql) => {
    sql.run("INSERT INTO SalesOrder (id, code, tenantId, businessId, origin, status, currency, discountSatang, orderedAt, createdAt, updatedAt, version) VALUES (?,?,?,?,'WALK_IN',?,'THB',0,?,?,?,1)", id, `ORD-SYN-${id.slice(0, 6)}`, TENANT, businessId, status, now, now, now)
    sql.run('INSERT INTO SalesOrderLine (id, orderId, description, qty, unitPriceSatang, discountSatang, sortOrder) VALUES (?,?,?,?,?,0,0)', randomUUID(), id, 'Synthetic gift set', 2, totalSatang / 2)
  })
  return id
}
const record = (orderId, body, who = 'rep') => h.run(as(who), RECORD, { targetId: orderId, body })
const act = (paymentId, body, who = 'verifier') => h.run(as(who), ACTION, { targetId: paymentId, body })
const getOrder = (id) => h.bus.queries.salesOrder(as('member'), id).then((r) => r.order)

describe('[legacy] AC-163.1 — record', () => {
  test('a rep records PENDING with a PAY code; order stays UNPAID; reference unique; slip must be this Business\'s', async () => {
    const o = await order()
    const r = await record(o, { method: 'TRANSFER', amount: 400, bankReference: 'KBANK-0001', slipFileAssetId: 'slip-own', paidAt: '2026-09-06T02:00:00Z' })
    assert.match(r.payment.code, /^PAY-\d{8}-001$/)
    assert.deepEqual([r.payment.orderId, r.payment.kind, r.payment.method, r.payment.amount, r.payment.status, r.payment.bankReference, r.payment.slipFileAssetId, r.payment.createdByPersonId, r.payment.version],
      [o, 'PAYMENT', 'TRANSFER', 400, 'PENDING', 'KBANK-0001', 'slip-own', 'per-rep', 1])
    assert.equal(r.payment.paidAt, '2026-09-06T02:00:00.000Z')
    const view = await getOrder(o)
    assert.deepEqual([view.paid, view.pending, view.balanceDue, view.paymentState], [0, 400, 1000, 'UNPAID'])
    await rejects(record(o, { method: 'TRANSFER', amount: 1, bankReference: 'KBANK-0001' }), { status: 409, code: 'PAYMENT_REFERENCE_TAKEN' })
    for (const slip of ['slip-deleted', 'slip-unknown']) await rejects(record(o, { method: 'TRANSFER', amount: 1, slipFileAssetId: slip }), { status: 422, code: 'PAYMENT_SLIP_NOT_FOUND' })
    await rejects(record(o, { method: 'CASH', amount: 1 }, 'member'), { status: 404 })
    await rejects(record('no-such-order', { method: 'CASH', amount: 1 }, 'owner'), { status: 404 })
    const foreign = await order({ businessId: OTHER_BIZ })
    await rejects(record(foreign, { method: 'CASH', amount: 1 }, 'owner'), { status: 404 })
    const audits = await h.store.read((sql) => sql.all("SELECT action FROM ScmAuditEvent WHERE entityType = 'PAYMENT' AND entityId = ?", r.payment.id).map((a) => a.action))
    assert.deepEqual(audits, ['PAYMENT_RECORDED'])
  })
})

describe('[legacy] AC-163.2 — verify / reject, FR-196', () => {
  test('verifier hat (or owner) needed; verified money moves PARTIAL → PAID; rejected never counts; owner self-verify needs attestation', async () => {
    const o = await order()
    const p1 = (await record(o, { method: 'QR', amount: 300 })).payment
    await rejects(act(p1.id, { action: 'VERIFY', version: 1 }, 'rep'), { status: 404 })
    await rejects(act(p1.id, { action: 'VERIFY', version: 1 }, 'noDomain'), { status: 404 })
    const v1 = await act(p1.id, { action: 'VERIFY', version: 1 })
    assert.deepEqual([v1.payment.status, v1.payment.verifiedByPersonId, v1.payment.version], ['VERIFIED', 'per-verifier', 2])
    assert.deepEqual([v1.order.paid, v1.order.balanceDue, v1.order.paymentState], [300, 700, 'PARTIAL'])
    await rejects(act(p1.id, { action: 'REJECT', version: 2 }), { status: 409, code: 'PAYMENT_STATUS_INVALID' })
    await rejects(act(p1.id, { action: 'VERIFY', version: 1 }), { status: 409, code: 'PAYMENT_VERSION_CONFLICT' })
    const bad = (await record(o, { method: 'TRANSFER', amount: 700, note: 'สลิปปลอม' })).payment
    const rejected = await act(bad.id, { action: 'REJECT', version: 1, reason: 'สลิปไม่ตรง' }, 'owner')
    assert.deepEqual([rejected.payment.status, rejected.payment.rejectReason, rejected.order.paid, rejected.order.paymentState], ['REJECTED', 'สลิปไม่ตรง', 300, 'PARTIAL'])
    const p3 = (await record(o, { method: 'CASH', amount: 700 }, 'owner')).payment
    await rejects(act(p3.id, { action: 'VERIFY', version: 1 }, 'owner'), { status: 409, code: 'PAYMENT_SELF_VERIFY_FORBIDDEN' })
    const paid = await act(p3.id, { action: 'VERIFY', version: 1, selfVerifyAttested: true }, 'owner')
    assert.deepEqual([paid.order.paid, paid.order.balanceDue, paid.order.paymentState], [1000, 0, 'PAID'])
    const listed = await h.bus.queries.orderPayments(as('member'), o)
    assert.deepEqual(listed.payments.map((p) => p.status), ['VERIFIED', 'REJECTED', 'VERIFIED'])
    assert.deepEqual(listed.summary, { paid: 1000, refunded: 0, net: 1000, pending: 0 })
    assert.equal((await h.bus.queries.payment(as('member'), p3.id)).payment.amount, 700)
    // [legacy fr196] the audit payload records selfVerified true/false.
    const payloads = await h.store.read((sql) => sql.all("SELECT entityId, payloadJson FROM ScmAuditEvent WHERE action = 'PAYMENT_VERIFIED'").map((a) => [a.entityId, JSON.parse(a.payloadJson).selfVerified]))
    assert.deepEqual(Object.fromEntries(payloads), { [p1.id]: false, [p3.id]: true })
  })
  test('a POS payment (PENDING from checkout) is verified here by a second person', async () => {
    const o = await order({ status: 'COMPLETED' })
    const p = (await record(o, { method: 'CASH', amount: 1000 }, 'owner')).payment
    const v = await act(p.id, { action: 'VERIFY', version: 1 })
    assert.equal(v.order.paymentState, 'PAID')
  })
})

describe('[legacy] AC-163.3 — refunds', () => {
  test('bounded by verified money; allowed on a cancelled order; a payment on a cancelled order is not', async () => {
    const o = await order()
    const p = (await record(o, { method: 'TRANSFER', amount: 1000, bankReference: 'SCB-9' })).payment
    await act(p.id, { action: 'VERIFY', version: 1 }, 'owner')
    const tooMuch = (await record(o, { kind: 'REFUND', method: 'TRANSFER', amount: 1200 })).payment
    await rejects(act(tooMuch.id, { action: 'VERIFY', version: 1 }, 'owner'), { status: 409, code: 'PAYMENT_REFUND_EXCEEDS_PAID' })
    await h.store.transaction((sql) => sql.run("UPDATE SalesOrder SET status = 'CANCELLED' WHERE id = ?", o)) // order cancel has not moved: synthetic
    await rejects(record(o, { method: 'CASH', amount: 1 }), { status: 409, code: 'SALES_ORDER_CANCELLED' })
    const refund = (await record(o, { kind: 'REFUND', method: 'TRANSFER', amount: 1000 })).payment
    const refunded = await act(refund.id, { action: 'VERIFY', version: 1 })
    assert.deepEqual([refunded.order.paid, refunded.order.refunded, refunded.order.net, refunded.order.paymentState, refunded.order.status], [1000, 1000, 0, 'REFUNDED', 'CANCELLED'])
    const second = (await record(o, { kind: 'REFUND', method: 'TRANSFER', amount: 1 })).payment
    await rejects(act(second.id, { action: 'VERIFY', version: 1 }), { status: 409, code: 'PAYMENT_REFUND_EXCEEDS_PAID' })
  })
})

describe('idempotency and rollback', () => {
  test('record/verify replay on the same key; a lost verify response is found by key', async () => {
    const o = await order()
    const key = idem('pay')
    const first = await h.bus.run(as('rep'), RECORD, { idempotencyKey: key, targetId: o, body: { method: 'CASH', amount: 5 } })
    const again = await h.bus.run(as('rep'), RECORD, { idempotencyKey: key, targetId: o, body: { method: 'CASH', amount: 5 } })
    assert.deepEqual([again.replayed, again.payment.id], [true, first.payment.id])
    assert.equal((await h.bus.queries.orderPayments(as('member'), o)).payments.length, 1)
    const vkey = idem('verify')
    await h.bus.run(as('verifier'), ACTION, { idempotencyKey: vkey, targetId: first.payment.id, body: { action: 'VERIFY', version: 1 } })
    const found = await h.bus.lookup(as('verifier'), { action: ACTION, businessId: BIZ, idempotencyKey: vkey })
    assert.deepEqual([found.operation.affected.status, found.operation.affected.orderPaymentState], ['VERIFIED', 'PARTIAL'])
    const replay = await h.bus.run(as('verifier'), ACTION, { idempotencyKey: vkey, targetId: first.payment.id, body: { action: 'VERIFY', version: 1 } })
    assert.equal(replay.replayed, true, 'a timed-out verify retried with its key is not a version conflict')
  })
  test('the Files owner being down refuses a slip-bearing record (503) but not a slip-less one', async () => {
    const { createCommandBus } = await import('../../src/application/commands.js')
    const { createUnavailableReferenceAuthority } = await import('../../src/infrastructure/reference-authority.js')
    const bus = createCommandBus({ store: h.store, references: createUnavailableReferenceAuthority() })
    const o = await order()
    await rejects(bus.run(as('rep'), RECORD, { idempotencyKey: idem('p'), targetId: o, body: { method: 'TRANSFER', amount: 1, slipFileAssetId: 'slip-own' } }), { status: 503, code: 'SCM_REFERENCE_AUTHORITY_UNAVAILABLE' })
    const ok = await bus.run(as('rep'), RECORD, { idempotencyKey: idem('p'), targetId: o, body: { method: 'CASH', amount: 1 } })
    assert.equal(ok.payment.status, 'PENDING')
  })
  for (const point of ['beforePaymentUpdate', 'afterAudit']) {
    test(`fault at ${point} leaves the payment PENDING at its version with no audit/outbox/receipt`, async () => {
      let armed = true
      await h.close()
      h = createHarness({ faults: { [ACTION]: { [point]: () => { if (armed) throw Object.assign(new Error('injected'), { status: 500, code: 'TEST_FAULT' }) } } } })
      const o = await order()
      const p = (await record(o, { method: 'CASH', amount: 10 })).payment
      const before = await h.snapshot()
      const key = idem('v')
      await rejects(h.bus.run(as('verifier'), ACTION, { idempotencyKey: key, targetId: p.id, body: { action: 'VERIFY', version: 1 } }), { code: 'TEST_FAULT' })
      assert.deepEqual(await h.snapshot(), before)
      assert.deepEqual([(await h.bus.queries.payment(as('member'), p.id)).payment.status, (await h.bus.queries.payment(as('member'), p.id)).payment.version], ['PENDING', 1])
      armed = false
      assert.equal((await h.bus.run(as('verifier'), ACTION, { idempotencyKey: key, targetId: p.id, body: { action: 'VERIFY', version: 1 } })).payment.status, 'VERIFIED')
    })
  }
})
