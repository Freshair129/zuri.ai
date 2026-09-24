// Sales-order concurrency (acceptance B10/B14 fulfilment half):
//  1. CAS: the order's version moves between the version check and the update
//     (the PostgreSQL-shaped interleaving) → 409, and the stock already issued in
//     this unit of work is rolled back with it.
//  2. Two SCM processes COMPLETE two orders (3 + 3 units) over 5 units at once →
//     exactly one fulfils; the other is refused whole and stays CONFIRMED.
import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { openSqliteStore } from '../../src/infrastructure/sqlite-store.js'
import { createCommandBus } from '../../src/application/commands.js'
import { createFixtureReferenceAuthority } from '../../src/infrastructure/reference-authority.js'
import { createHarness, rejects } from '../support/harness.js'
import { startScmProcess } from '../support/scm-process.js'
import { BIZ, PRODUCTS, REFERENCE_FIXTURE, delegation, idem, seedDatabase, tempDbPath } from '../support/fixtures.js'

const OWNER = { [BIZ]: { owner: true, domains: ['commerce', 'inventory'], permissions: [] } }
const ACTION = 'commerce.sales-order.action'

test('a SalesOrder version change during fulfilment is refused and the issue rolls back', async () => {
  const h = createHarness({ seed: { stock: [{ productId: PRODUCTS.plain.id, quantity: 5 }] } })
  const owner = h.as({ sub: 'per-owner', grants: OWNER })
  const { order } = await h.run(owner, 'commerce.sales-order.create', { body: { businessId: BIZ, lines: [{ productId: PRODUCTS.plain.id, qty: 2, unitPrice: 1 }] } })
  await h.run(owner, ACTION, { targetId: order.id, body: { action: 'CONFIRM', version: 1 } })
  const before = await h.snapshot()
  await h.store.close()
  const store = openSqliteStore({ location: h.db.path })
  let current = null
  const transaction = store.transaction
  store.transaction = (fn) => transaction((sql) => { current = sql; return fn(sql) })
  let interleave = true
  const bus = createCommandBus({ store, references: createFixtureReferenceAuthority(REFERENCE_FIXTURE), faults: { [ACTION]: { beforeOrderUpdate: () => {
    if (interleave) current.run('UPDATE SalesOrder SET version = version + 1 WHERE id = ?', order.id)
  } } } })
  try {
    await rejects(bus.run(owner, ACTION, { idempotencyKey: idem('cas'), targetId: order.id, body: { action: 'COMPLETE', version: 2, issueStock: true } }), { status: 409, code: 'SALES_ORDER_VERSION_CONFLICT' })
    const after = await store.read((sql) => ({ moves: sql.get('SELECT COUNT(*) AS n FROM StockMovement').n, row: { ...sql.get('SELECT status, version, stockIssuedAt FROM SalesOrder WHERE id = ?', order.id) }, fence: sql.get('SELECT COALESCE(MAX(mutationRevision), -1) AS r FROM InventoryLedgerFence').r }))
    assert.deepEqual(after, { moves: before.StockMovement, row: { status: 'CONFIRMED', version: 2, stockIssuedAt: null }, fence: before.fence })
    interleave = false
    assert.equal((await bus.run(owner, ACTION, { idempotencyKey: idem('cas-retry'), targetId: order.id, body: { action: 'COMPLETE', version: 2, issueStock: true } })).order.status, 'COMPLETED')
  } finally {
    await store.close()
    h.db.cleanup()
  }
})

const db = tempDbPath('fulfil-race')
after(() => db.cleanup())

test('two processes fulfilling two orders over scarce stock: exactly one wins, the other is refused whole', async (t) => {
  seedDatabase(db.path, { products: [PRODUCTS.plain], stock: [{ productId: PRODUCTS.plain.id, quantity: 5 }] })
  const a = await startScmProcess({ sqlitePath: db.path })
  const b = await startScmProcess({ sqlitePath: db.path })
  try {
    const token = () => delegation({ sub: 'per-owner', grants: OWNER })
    const orders = []
    for (const p of [a, b]) {
      const created = await p.request('POST', '/v1/commerce/orders', { token: token(), key: idem('so'), body: { businessId: BIZ, lines: [{ productId: PRODUCTS.plain.id, qty: 3, unitPrice: 1 }] } })
      assert.equal(created.status, 201, JSON.stringify(created.body))
      await p.request('POST', `/v1/commerce/orders/${created.body.order.id}/actions`, { token: token(), key: idem('c'), body: { action: 'CONFIRM', version: 1 } })
      orders.push(created.body.order.id)
    }
    const results = await Promise.all(orders.map((id, i) => [a, b][i].request('POST', `/v1/commerce/orders/${id}/actions`, { token: token(), key: idem(`f${i}`), body: { action: 'COMPLETE', version: 2, issueStock: true } })))
    t.diagnostic(`outcomes: ${JSON.stringify(results.map((r, i) => [i ? 'B' : 'A', r.status === 201 ? 'COMPLETED' : r.body.error.code]))}`)
    assert.equal(results.filter((r) => r.status === 201).length, 1)
    const loser = results.find((r) => r.status !== 201)
    assert.ok(['COMMERCE_STOCK_SHORTAGE', 'SCM_STORE_BUSY'].includes(loser.body.error.code), loser.body.error.code)
    const check = new DatabaseSync(db.path)
    try {
      assert.equal(check.prepare('SELECT SUM(quantity) AS q FROM StockMovement').get().q, 2)
      assert.deepEqual(check.prepare('SELECT status FROM SalesOrder ORDER BY status').all().map((r) => r.status), ['COMPLETED', 'CONFIRMED'])
    } finally { check.close() }
  } finally { await Promise.all([a.kill(), b.kill()]) }
})

