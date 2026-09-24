// D-2: the purchase-order compare-and-swap in the receipt group. On SQLite the
// BEGIN IMMEDIATE lock already serializes writers, so a stale plan cannot occur
// there naturally; this test forces the PostgreSQL-shaped interleaving instead —
// the PO version moves between this receipt's outstanding check and its PO
// update — and proves the receipt is refused (retryable 409) with the whole
// group rolled back, and that a fresh attempt then succeeds.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createCommandBus } from '../../src/application/commands.js'
import { createHarness, rejects } from '../support/harness.js'
import { BIZ, PRODUCTS, ROLES, idem, openTestStore } from '../support/fixtures.js'

const GRN = 'procurement.goods-receipt.post'

test('a PO version change between plan and update is refused and rolled back', async () => {
  const h = createHarness()
  const order = await h.sentOrder([{ productId: PRODUCTS.plain.id, qty: 4, unitCost: 1 }])
  const receiver = h.as({ sub: 'person-receiver', grants: { [BIZ]: ROLES.receiverFull } })
  const before = await h.snapshot()
  await h.store.close()

  const store = openTestStore(h.db)
  let current = null
  const transaction = store.transaction
  store.transaction = (fn) => transaction((sql) => { current = sql; return fn(sql) })
  let interleave = true
  const bus = createCommandBus({ store, faults: { [GRN]: { beforePurchaseOrderUpdate: () => {
    if (interleave) current.run('UPDATE PurchaseOrder SET version = version + 1 WHERE id = ?', order.id)
  } } } })
  try {
    const body = { lines: [{ purchaseOrderLineId: order.lines[0].id, qty: 4 }] }
    const error = await rejects(bus.run(receiver, GRN, { idempotencyKey: idem('cas'), targetId: order.id, body }), { status: 409, code: 'PURCHASE_ORDER_VERSION_CONFLICT' })
    assert.equal(error.retryable, true)
    const after = await store.read((sql) => ({
      grn: sql.get('SELECT COUNT(*) AS n FROM GoodsReceipt').n,
      moves: sql.get('SELECT COUNT(*) AS n FROM StockMovement').n,
      receipts: sql.get('SELECT COUNT(*) AS n FROM ScmOperationReceipt').n,
      version: sql.get('SELECT version FROM PurchaseOrder WHERE id = ?', order.id).version,
    }))
    assert.deepEqual(after, { grn: before.GoodsReceipt, moves: before.StockMovement, receipts: before.ScmOperationReceipt, version: order.version })

    interleave = false
    const ok = await bus.run(receiver, GRN, { idempotencyKey: idem('cas-retry'), targetId: order.id, body })
    assert.equal(ok.order.status, 'RECEIVED')
  } finally {
    await store.close()
    h.db.cleanup()
  }
})
