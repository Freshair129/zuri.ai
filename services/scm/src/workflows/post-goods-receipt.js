import { GOODS_RECEIPT_ENTITY, PURCHASE_ORDER_ENTITY, goodsReceiptCode, planReceipt, receiptReference, zPostReceipt } from '../kernel/procurement/procurement.js'
import { amortiseSatang } from '../kernel/inventory/inventory-costing.js'
import { recordAudit, enqueueOutbox } from '../infrastructure/evidence.js'
import * as inventory from '../modules/inventory/index.js'
import * as procurementRepo from '../modules/procurement/adapters/procurement-repo.js'
import { loadOrderInScope, nextGoodsReceiptCode, purchaseOrderDto, receiptDto } from '../modules/procurement/application/purchase-orders.js'

// Cross-module atomic use case: post a goods receipt against a SENT purchase
// order. One unit of work holds the whole group — GRN + lines (Procurement),
// RECEIPT movements / lots / serials / ledger fence (Inventory, through its public
// writer only), PO version/state (Procurement), local audit + outbox. Any throw
// rolls ALL of it back. Port of apps/server goods-receipt-service.postGoodsReceipt
// with the same order of refusals and codes, plus two recorded differences:
//   D-1 (boundary, no behavior change): a lot's first expiry is set through
//       Inventory's setLotExpiryIfUnset instead of Procurement writing ProductLot.
//   D-2 (intentional correctness change, see SCM-HANDOFF.md "Defects"): the PO
//       update is a compare-and-swap on the version read at the start, so two
//       concurrent receipts can never both pass the outstanding check against
//       the same snapshot (the legacy `version: {increment: 1}` without a
//       predicate does not re-check under READ COMMITTED on PostgreSQL). The
//       loser gets a retryable 409 PURCHASE_ORDER_VERSION_CONFLICT and nothing
//       it planned is written.
// `faults` is a composition-time test seam (never reachable from HTTP) used by
// the rollback tests to throw between steps.

const failure = (status, code, details) => Object.assign(new Error(code), { status, code, retryable: false, ...(details ? { details } : {}) })
const isCounted = (orderLine, product) => Boolean(orderLine.productId) && product?.stockPolicy === 'TRACKED'

export function postGoodsReceipt(sql, scope, orderId, input, { now, requestId, faults = {} }) {
  const data = zPostReceipt.parse(input)
  const order = loadOrderInScope(sql, scope, orderId, 'receipt')
  const business = { id: order.businessId, tenantId: order.tenantId }
  if (order.status !== 'SENT') throw failure(409, 'PURCHASE_ORDER_NOT_RECEIVABLE')
  // FR-196 — the receiver may not be the order's author unless explicitly attested.
  const selfVerified = Boolean(order.createdByPersonId) && order.createdByPersonId === scope.actorId
  if (selfVerified && !data.selfVerifyAttested) throw failure(409, 'GOODS_RECEIPT_SELF_POST_FORBIDDEN')
  const plan = planReceipt(order.lines, data.lines)
  if (!plan.ok) throw failure(plan.code === 'PROCUREMENT_RECEIPT_LINE_NOT_FOUND' ? 422 : 409, plan.code, plan.details)
  const byId = new Map(order.lines.map((line) => [line.id, line]))
  const products = new Map(inventory.productsByIds(sql, [...new Set(order.lines.map((l) => l.productId).filter(Boolean))]).map((p) => [p.id, p]))
  for (const line of data.lines) {
    const orderLine = byId.get(line.purchaseOrderLineId)
    const product = orderLine.productId ? products.get(orderLine.productId) : null
    if (!isCounted(orderLine, product) && (line.lotCode || line.expiresAt || line.serialNos?.length)) throw failure(422, 'PROCUREMENT_RECEIPT_LINE_NOT_COUNTED')
    if (product?.stockPolicy === 'SERVICE') throw failure(422, 'PROCUREMENT_RECEIPT_LINE_IS_A_SERVICE')
    if (product?.status === 'ARCHIVED') throw failure(409, 'PRODUCT_ARCHIVED')
  }
  const stocked = data.lines.filter((line) => { const ol = byId.get(line.purchaseOrderLineId); return isCounted(ol, products.get(ol.productId)) })
  // Two-ladder rule (ADR-066 D4): a buyer's receipt permission never widens the ledger.
  if (stocked.length && !inventory.inventoryAuthority.mayManage(scope, business.id)) throw failure(403, 'PROCUREMENT_RECEIPT_REQUIRES_INVENTORY_AUTHORITY')

  const code = nextGoodsReceiptCode(sql, business, new Date(now), goodsReceiptCode)
  const receivedAt = data.receivedAt ? data.receivedAt.toISOString() : now
  const receipt = procurementRepo.insertReceipt(sql, {
    code, tenantId: business.tenantId, businessId: business.id, purchaseOrderId: order.id, supplierReference: data.supplierReference ?? null,
    notes: data.notes ?? null, receivedAt, postedByPersonId: scope.actorId, now,
  }, data.lines.map((l) => ({ ...l, expiresAt: l.expiresAt ? l.expiresAt.toISOString() : null })))
  faults.afterReceiptInsert?.()

  const reference = receiptReference(order.code, code)
  const totalCountedQty = stocked.reduce((sum, line) => sum + line.qty, 0)
  const batchCostPerUnit = data.batchCostSatang && totalCountedQty > 0 ? amortiseSatang(data.batchCostSatang, totalCountedQty) : 0
  const posted = []
  for (const [index, line] of stocked.entries()) {
    const orderLine = byId.get(line.purchaseOrderLineId)
    const costBasis = orderLine.unitCostSatang != null ? orderLine.unitCostSatang + batchCostPerUnit : null
    const movement = inventory.appendMovement(sql, scope, {
      businessId: business.id, productId: orderLine.productId, kind: 'RECEIPT', quantity: line.qty, costSatang: costBasis,
      ...(line.lotCode ? { lotCode: line.lotCode } : {}), ...(line.serialNos?.length ? { serialNos: line.serialNos } : {}),
      reason: 'GOODS_RECEIPT', reference, occurredAt: receivedAt, requestId,
    }, { now })
    if (movement.lotId && line.expiresAt) inventory.setLotExpiryIfUnset(sql, scope, { businessId: business.id, lotId: movement.lotId, expiresAt: line.expiresAt.toISOString() }, { now })
    posted.push({ purchaseOrderLineId: orderLine.id, productId: orderLine.productId, code: products.get(orderLine.productId).code, quantity: line.qty, lotId: movement.lotId, onHandAfter: movement.onHandAfter, costSatang: movement.costSatang ?? costBasis ?? null, movementIds: movement.movements.map((m) => m.id) })
    if (index === 0) faults.afterFirstMovement?.()
  }

  const change = plan.completesOrder ? { status: 'RECEIVED', receivedAt } : {}
  faults.beforePurchaseOrderUpdate?.()
  if (procurementRepo.casUpdatePurchaseOrder(sql, { id: order.id, version: order.version, change, now }) !== 1) {
    throw Object.assign(failure(409, 'PURCHASE_ORDER_VERSION_CONFLICT'), { retryable: true })
  }
  recordAudit(sql, {
    entityType: GOODS_RECEIPT_ENTITY, entityId: receipt.id, action: 'GOODS_RECEIPT_POSTED', actorId: scope.actorId, tenantId: business.tenantId, businessId: business.id, requestId, now,
    payload: { businessId: business.id, code, purchaseOrderCode: order.code, supplierReference: receipt.supplierReference, batchCostSatang: data.batchCostSatang ?? null, lines: data.lines.length, posted, completesOrder: plan.completesOrder, selfVerified },
  })
  if (plan.completesOrder) {
    recordAudit(sql, { entityType: PURCHASE_ORDER_ENTITY, entityId: order.id, action: 'PURCHASE_ORDER_RECEIVED', actorId: scope.actorId, tenantId: business.tenantId, businessId: business.id, requestId, now, payload: { businessId: business.id, code: order.code, receiptCode: code, from: { status: 'SENT' }, to: { status: 'RECEIVED' }, version: order.version + 1 } })
  }
  faults.afterAudit?.()
  enqueueOutbox(sql, { topic: 'scm.procurement.goods-receipt.posted', aggregateType: GOODS_RECEIPT_ENTITY, aggregateId: receipt.id, aggregateVersion: order.version + 1, now, payload: { businessId: business.id, code, purchaseOrderId: order.id, completesOrder: plan.completesOrder, movementIds: posted.flatMap((p) => p.movementIds) } })
  const updated = procurementRepo.loadPurchaseOrder(sql, order.id)
  return {
    response: { receipt: receiptDto(receipt), order: purchaseOrderDto(sql, updated), posted },
    affected: { goodsReceiptId: receipt.id, goodsReceiptCode: code, purchaseOrderId: order.id, purchaseOrderVersion: updated.version, purchaseOrderStatus: updated.status, stockMovementIds: posted.flatMap((p) => p.movementIds) },
  }
}
