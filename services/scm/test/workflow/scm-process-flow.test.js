// Acceptance D26 (SCM-local): the vertical slice through the REAL SCM process —
// HTTP ingress → delegation → command → store → receipt → readback — with no
// Next.js, LINE, Files, MSP or GKS running. Also D23/D24 for this slice:
// crash (SIGKILL) right after a commit, restart, look the outcome up by key.
// The core issuer is synthetic; real core/BFF integration is a separate gate.
import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { startScmProcess } from '../support/scm-process.js'
import { BIZ, PRODUCTS, ROLES, delegation, idem, seedDatabase, tempDbPath } from '../support/fixtures.js'

const db = tempDbPath('workflow')
after(() => db.cleanup())
seedDatabase(db.path, { products: Object.values(PRODUCTS) })
const buyer = () => delegation({ sub: 'person-buyer', grants: { [BIZ]: ROLES.receiverFull } })
const receiver = () => delegation({ sub: 'person-receiver', grants: { [BIZ]: ROLES.receiverFull } })

test('PO → SEND → GRN → stock → PO state over HTTP; crash after commit; restart; lookup; no duplicate', async () => {
  let scm = await startScmProcess({ sqlitePath: db.path })
  try {
    assert.equal((await scm.request('GET', '/healthz')).status, 200)
    const ready = await scm.request('GET', '/readyz')
    assert.deepEqual([ready.status, ready.body.status], [200, 'ready'])
    assert.equal((await scm.request('POST', '/v1/procurement/suppliers', { key: idem('s'), body: { businessId: BIZ, code: 'SUP-X', name: 'X' } })).status, 401, 'no delegation → 401')
    assert.equal((await scm.request('POST', '/v1/procurement/suppliers', { token: buyer(), body: { businessId: BIZ, code: 'SUP-X', name: 'X' } })).body.error.code, 'SCM_IDEMPOTENCY_KEY_REQUIRED')

    const supplier = await scm.request('POST', '/v1/procurement/suppliers', { token: buyer(), key: idem('s'), body: { businessId: BIZ, code: 'SUP-HTTP', name: 'Synthetic HTTP Supplier' } })
    assert.equal(supplier.status, 201)
    const created = await scm.request('POST', '/v1/procurement/purchase-orders', { token: buyer(), key: idem('po'), body: { businessId: BIZ, supplierId: supplier.body.supplier.id, lines: [{ productId: PRODUCTS.plain.id, qty: 8, unitCost: 19.99 }] } })
    assert.equal(created.status, 201)
    const invalid = await scm.request('POST', '/v1/procurement/purchase-orders', { token: buyer(), key: idem('po'), body: { businessId: BIZ, supplierId: supplier.body.supplier.id, lines: [], sql: 'DROP TABLE' } })
    assert.deepEqual([invalid.status, invalid.body.error.code], [422, 'SCM_VALIDATION_FAILED'])
    const order = created.body.order
    const sent = await scm.request('POST', `/v1/procurement/purchase-orders/${order.id}/actions`, { token: buyer(), key: idem('send'), body: { action: 'SEND', version: order.version } })
    assert.equal(sent.body.order.status, 'SENT')

    const key = idem('grn')
    const posted = await scm.request('POST', `/v1/procurement/purchase-orders/${order.id}/receipts`, { token: receiver(), key, body: { lines: [{ purchaseOrderLineId: order.lines[0].id, qty: 8 }] } })
    assert.equal(posted.status, 201)
    assert.equal(posted.body.order.status, 'RECEIVED')

    // Crash immediately after the commit — as if the response had been lost in flight.
    await scm.kill()
    scm = await startScmProcess({ sqlitePath: db.path })
    const lookup = await scm.request('GET', `/v1/operations/procurement.goods-receipt.post/${key}?businessId=${BIZ}`, { token: receiver() })
    assert.equal(lookup.status, 200)
    assert.equal(lookup.body.operation.affected.goodsReceiptId, posted.body.receipt.id)
    const resent = await scm.request('POST', `/v1/procurement/purchase-orders/${order.id}/receipts`, { token: receiver(), key, body: { lines: [{ purchaseOrderLineId: order.lines[0].id, qty: 8 }] } })
    assert.deepEqual([resent.status, resent.body.replayed, resent.body.receipt.id], [200, true, posted.body.receipt.id])

    const stock = await scm.request('GET', `/v1/inventory/stock?businessId=${BIZ}`, { token: receiver() })
    assert.equal(stock.body.products.find((p) => p.code === PRODUCTS.plain.code).onHand, 8, 'exactly one receipt reached the ledger')
    const movements = await scm.request('GET', `/v1/inventory/movements?businessId=${BIZ}&productId=${PRODUCTS.plain.id}`, { token: receiver() })
    assert.equal(movements.body.movements.length, 1)
    assert.equal(movements.body.movements[0].costSatang, 1999)
    const readback = await scm.request('GET', `/v1/procurement/purchase-orders/${order.id}`, { token: receiver() })
    assert.deepEqual(readback.body.order, posted.body.order)
    const foreign = await scm.request('GET', `/v1/procurement/purchase-orders/${order.id}`, { token: delegation({ sub: 'x', grants: {} }) })
    assert.deepEqual([foreign.status, foreign.body.error.code], [404, 'SCM_SCOPE_NOT_FOUND'])

    // Logs carry no prices, bodies or tokens.
    const logText = JSON.stringify(scm.logs)
    assert.ok(!logText.includes('19.99') && !logText.includes('Delegation ') && !logText.includes('Synthetic HTTP Supplier'))
  } finally { await scm.kill() }
})

test('a process refuses to start on a missing schema, a short key or production self-migration', async () => {
  const empty = tempDbPath('noschema')
  try {
    await assert.rejects(startScmProcess({ sqlitePath: empty.path }), (e) => e.exitCode === 1 && e.logs.some((l) => l.code === 'SCM_SCHEMA_MISMATCH'))
    await assert.rejects(startScmProcess({ sqlitePath: empty.path, env: { SCM_DELEGATION_KEY: 'short' } }), (e) => e.exitCode === 1 && e.logs.some((l) => l.code === 'SCM_CONFIG_INVALID' && !JSON.stringify(l).includes('short')))
    await assert.rejects(startScmProcess({ sqlitePath: empty.path, env: { SCM_ENV: 'production', SCM_ENSURE_SCHEMA: '1' } }), (e) => e.exitCode === 1)
  } finally { empty.cleanup() }
})

test('graceful SIGTERM drains and exits 0', { skip: process.platform === 'win32' ? 'NOT_RUN on Windows: child.kill(SIGTERM) is a hard kill there; proven in the Linux image smoke' : false }, async () => {
  const scm = await startScmProcess({ sqlitePath: db.path })
  const { code } = await scm.stop()
  assert.equal(code, 0)
  assert.ok(scm.logs.some((l) => l.message === 'stopped'))
})
