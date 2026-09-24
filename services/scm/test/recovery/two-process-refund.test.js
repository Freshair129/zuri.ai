// Refund ceiling under concurrency (acceptance B15, SQLite engine): 1000 baht
// verified, four PENDING refunds of 400, all verified at once across two SCM
// processes by two verifiers. Exactly two may pass (800 ≤ 1000 < 1200); the rest
// are refused PAYMENT_REFUND_EXCEEDS_PAID and stay PENDING. The order-row lock
// (D-9) is what keeps this true on PostgreSQL; on SQLite the writer lock does.
import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { DatabaseSync } from 'node:sqlite'
import { startScmProcess } from '../support/scm-process.js'
import { BIZ, TENANT, delegation, idem, seedDatabase, tempDbPath } from '../support/fixtures.js'

const db = tempDbPath('refund-race')
after(() => db.cleanup())
seedDatabase(db.path, {})
const orderId = randomUUID()
{
  const raw = new DatabaseSync(db.path)
  const now = new Date().toISOString()
  raw.prepare("INSERT INTO SalesOrder (id, code, tenantId, businessId, origin, status, currency, discountSatang, orderedAt, createdAt, updatedAt, version) VALUES (?,?,?,?,'WALK_IN','CONFIRMED','THB',0,?,?,?,1)").run(orderId, 'ORD-RACE-1', TENANT, BIZ, now, now, now)
  raw.prepare("INSERT INTO SalesOrderLine (id, orderId, description, qty, unitPriceSatang, discountSatang, sortOrder) VALUES (?,?,'Synthetic',1,100000,0,0)").run(randomUUID(), orderId)
  raw.close()
}
const rep = () => delegation({ sub: 'per-rep', grants: { [BIZ]: { owner: false, domains: ['commerce'], permissions: ['commerce.order.write'] } } })
const verifier = (n) => delegation({ sub: `per-ver-${n}`, grants: { [BIZ]: { owner: false, domains: ['commerce'], permissions: ['commerce.payment.verify'] } } })

test('four concurrent refund verifications never exceed the verified net', async (t) => {
  const a = await startScmProcess({ sqlitePath: db.path })
  const b = await startScmProcess({ sqlitePath: db.path })
  try {
    const paid = await a.request('POST', `/v1/commerce/orders/${orderId}/payments`, { token: rep(), key: idem('pay'), body: { method: 'TRANSFER', amount: 1000 } })
    assert.equal(paid.status, 201)
    assert.equal((await b.request('POST', `/v1/commerce/payments/${paid.body.payment.id}/actions`, { token: verifier(0), key: idem('v'), body: { action: 'VERIFY', version: 1 } })).status, 201)
    const refunds = []
    for (let i = 0; i < 4; i += 1) refunds.push((await a.request('POST', `/v1/commerce/orders/${orderId}/payments`, { token: rep(), key: idem(`r${i}`), body: { kind: 'REFUND', method: 'TRANSFER', amount: 400 } })).body.payment.id)
    const results = await Promise.all(refunds.map((id, i) => (i % 2 ? a : b).request('POST', `/v1/commerce/payments/${id}/actions`, { token: verifier(i % 2 ? 1 : 2), key: idem(`rv${i}`), body: { action: 'VERIFY', version: 1 } })))
    t.diagnostic(`outcomes: ${JSON.stringify(results.map((r, i) => [i % 2 ? 'A' : 'B', r.status === 201 ? 'VERIFIED' : r.body.error.code]))}`)
    assert.equal(results.filter((r) => r.status === 201).length, 2)
    for (const r of results.filter((x) => x.status !== 201)) assert.ok(['PAYMENT_REFUND_EXCEEDS_PAID', 'SCM_STORE_BUSY'].includes(r.body.error.code), r.body.error.code)
    const view = await a.request('GET', `/v1/commerce/orders/${orderId}`, { token: rep() })
    assert.deepEqual([view.body.order.paid, view.body.order.refunded, view.body.order.net], [1000, 800, 200])
    const check = new DatabaseSync(db.path)
    try {
      assert.equal(check.prepare("SELECT COUNT(*) AS n FROM Payment WHERE kind = 'REFUND' AND status = 'PENDING'").get().n, 2)
    } finally { check.close() }
  } finally { await Promise.all([a.kill(), b.kill()]) }
})
