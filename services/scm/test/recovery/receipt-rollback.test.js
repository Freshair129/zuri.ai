// Acceptance B9: an injected failure anywhere inside the goods-receipt group rolls
// back the WHOLE local atomic group — GRN + lines, ledger rows, lots, serials,
// fence revision, PO version/state, audit, outbox and the operation receipt —
// and the same key then succeeds once the fault is gone (pre-effect failure is
// safely retryable; nothing half-committed is left to reconcile).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createHarness, rejects } from '../support/harness.js'
import { BIZ, PRODUCTS, ROLES, idem } from '../support/fixtures.js'

const GRN = 'procurement.goods-receipt.post'
const POINTS = ['afterReceiptInsert', 'afterFirstMovement', 'beforePurchaseOrderUpdate', 'afterAudit']

for (const point of POINTS) {
  test(`fault at ${point} leaves no trace; the same key then commits exactly once`, async () => {
    let armed = true
    const faults = { [GRN]: { [point]: () => { if (armed) throw Object.assign(new Error(`injected fault at ${point}`), { status: 500, code: 'TEST_FAULT' }) } } }
    const h = createHarness({ faults })
    try {
      const order = await h.sentOrder([{ productId: PRODUCTS.lot.id, qty: 4, unitCost: 2 }, { productId: PRODUCTS.serial.id, qty: 2, unitCost: 5 }])
      const receiver = h.as({ sub: 'person-receiver', grants: { [BIZ]: ROLES.receiverFull } })
      const key = idem('grn-fault')
      const body = { lines: [
        { purchaseOrderLineId: order.lines[0].id, qty: 4, lotCode: 'LOT-F', expiresAt: '2027-06-30T00:00:00.000Z' },
        { purchaseOrderLineId: order.lines[1].id, qty: 2, serialNos: ['SN-F1', 'SN-F2'] },
      ] }
      const before = await h.snapshot()
      await rejects(h.bus.run(receiver, GRN, { idempotencyKey: key, targetId: order.id, body }), { code: 'TEST_FAULT' })
      assert.deepEqual(await h.snapshot(), before, `nothing of the group survives a fault at ${point}`)
      await rejects(h.bus.lookup(receiver, { action: GRN, businessId: BIZ, idempotencyKey: key }), { status: 404, code: 'SCM_OPERATION_NOT_FOUND' })

      armed = false
      const ok = await h.bus.run(receiver, GRN, { idempotencyKey: key, targetId: order.id, body })
      assert.equal(ok.replayed, false)
      assert.equal(ok.order.status, 'RECEIVED')
      const after = await h.snapshot()
      assert.equal(after.GoodsReceipt, 1)
      assert.equal(after.StockMovement, 3, '1 lot row + 2 serial rows')
      assert.equal(after.ScmOperationReceipt, before.ScmOperationReceipt + 1)
      assert.equal(after.fence, before.fence === -1 ? 2 : before.fence + 2)
    } finally { await h.close() }
  })
}
