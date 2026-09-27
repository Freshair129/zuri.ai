// Acceptance B10 (receipt half): two SEPARATE SCM processes, two DB connections,
// one PO line of 5 units, 12 concurrent single-unit receipts split across both
// processes. Exactly 5 commit; every other request is refused with a safe,
// retryable-or-final code and leaves no trace; the ledger, receipt lines and PO
// agree. Runs on the suite's engine; on PostgreSQL (--engine=postgres) the commits
// really interleave, and scripts/prove-guards-on-postgres.mjs shows this test fails
// there without the PurchaseOrder compare-and-swap (F-1).
import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { startScmProcess } from '../support/scm-process.js'
import { BIZ, PRODUCTS, ROLES, delegation, idem, openRaw, seedDatabase, tempDbPath } from '../support/fixtures.js'

const db = tempDbPath('race')
after(() => db.cleanup())
seedDatabase(db, { products: [PRODUCTS.plain] })

test('concurrent receipts across two processes never over-receive', async (t) => {
  const a = await startScmProcess({ db })
  const b = await startScmProcess({ db })
  try {
    const buyer = delegation({ sub: 'person-buyer', grants: { [BIZ]: ROLES.receiverFull } })
    const supplier = await a.request('POST', '/v1/procurement/suppliers', { token: buyer, key: idem('s'), body: { businessId: BIZ, code: 'SUP-RACE', name: 'Race Supplier' } })
    const created = await a.request('POST', '/v1/procurement/purchase-orders', { token: buyer, key: idem('po'), body: { businessId: BIZ, supplierId: supplier.body.supplier.id, lines: [{ productId: PRODUCTS.plain.id, qty: 5, unitCost: 1 }] } })
    const order = created.body.order
    await b.request('POST', `/v1/procurement/purchase-orders/${order.id}/actions`, { token: buyer, key: idem('send'), body: { action: 'SEND', version: order.version } })

    const attempts = Array.from({ length: 12 }, (_, i) => (i % 2 ? a : b).request('POST', `/v1/procurement/purchase-orders/${order.id}/receipts`, {
      token: delegation({ sub: `person-receiver-${i}`, grants: { [BIZ]: ROLES.receiverFull } }), key: idem(`grn-${i}`),
      body: { lines: [{ purchaseOrderLineId: order.lines[0].id, qty: 1 }] },
    }))
    const results = await Promise.all(attempts)
    const committed = results.filter((r) => r.status === 201)
    const refused = results.filter((r) => r.status !== 201)
    assert.equal(committed.length, 5, JSON.stringify(results.map((r) => [r.status, r.body.error?.code])))
    for (const r of refused) assert.ok(['PROCUREMENT_RECEIPT_EXCEEDS_ORDERED', 'PURCHASE_ORDER_NOT_RECEIVABLE', 'PURCHASE_ORDER_VERSION_CONFLICT', 'SCM_STORE_BUSY', 'SCM_CONCURRENT_CONFLICT'].includes(r.body.error.code), r.body.error.code)
    const byProcess = results.map((r, i) => [i % 2 ? 'A' : 'B', r.status === 201 ? 'COMMITTED' : r.body.error.code])
    t.diagnostic(`outcomes: ${JSON.stringify(byProcess)}`)
    assert.equal(new Set(committed.map((r) => r.body.operation.id)).size, 5)

    const check = openRaw(db)
    try {
      assert.equal(check.prepare('SELECT SUM(quantity) AS q FROM StockMovement').get().q, 5)
      assert.equal(check.prepare('SELECT SUM(qty) AS q FROM GoodsReceiptLine').get().q, 5)
      assert.equal(check.prepare('SELECT COUNT(*) AS n FROM GoodsReceipt').get().n, 5)
      assert.equal(check.prepare('SELECT COUNT(DISTINCT code) AS n FROM GoodsReceipt').get().n, 5, 'GRN codes stay unique under contention')
      assert.equal(check.prepare("SELECT COUNT(*) AS n FROM ScmOperationReceipt WHERE action = 'procurement.goods-receipt.post'").get().n, 5)
      assert.equal(check.prepare('SELECT status FROM PurchaseOrder WHERE id = ?').get(order.id).status, 'RECEIVED')
      assert.equal(check.prepare('SELECT mutationRevision FROM InventoryLedgerFence').get().mutationRevision, 5)
    } finally { check.close() }
  } finally { await Promise.all([a.kill(), b.kill()]) }
})
