import prisma from '@/lib/db'
import { recordAudit } from '@/modules/project-manager/application/audit'
import { appendMovement, mayManage as mayManageInventory } from '@/modules/inventory'
import {
  GOODS_RECEIPT_ENTITY,
  PURCHASE_ORDER_ENTITY,
  dayKey,
  goodsReceiptCode,
  planReceipt,
  receiptReference,
  zPostReceipt,
} from '../domain/procurement'
import { loadBusiness, notFound } from './procurement-authority'
import { PO_SELECT, RECEIPT_SELECT, purchaseOrderDto, receiptDto } from './purchase-order-service'

// @req FR-161 — the only writer of GoodsReceipt: post what arrived against a
//   SENT purchase order. Every receipt line names one order line of that
//   order and may not receive more than the line still has outstanding
//   (refused whole with the per-line list). A line whose order line names a
//   counted SKU writes RECEIPT rows into the Inventory ledger through
//   Inventory's exported `appendMovement` inside this same transaction —
//   `lotCode` names or creates the lot (LOT-tracked SKUs need one; a given
//   `expiresAt` is set on a lot that has none yet), `serialNos` create the
//   units (SERIAL-tracked SKUs need exactly one per unit), and the reference
//   `PO:<code>/GRN:<code>` ties every ledger row back here. A free-text line
//   or an uncounted SKU is recorded on the receipt and touches no ledger. The
//   stock half needs Inventory's write authority on top of the buyer's — a
//   Procurement role never widens Inventory (ADR-066 D4). When the receipt
//   completes every line the order becomes RECEIVED in the same transaction.
//   A receipt is never edited or deleted: a wrong one is corrected by an
//   Inventory ADJUSTMENT. Generated `GRN-YYYYMMDD-NNN`; one audit row for
//   the receipt (and one for the order when it completes).
// @spec ADR-066; ADR-054 D3/D4; BR-002; SEC-001; FR-072; FR-155
// @tested tests/integration/fr161-goods-receipt.test.js

const failure = (status, message) => Object.assign(new Error(message), { status })
const actor = (viewer) => viewer?.principal?.id ?? null

async function nextCode(tx, business, now) {
  const prefix = `GRN-${dayKey(now).replace(/-/g, '')}-`
  const count = await tx.goodsReceipt.count({ where: { tenantId: business.tenantId, code: { startsWith: prefix } } })
  for (let seq = count + 1; seq < count + 50; seq += 1) {
    const code = goodsReceiptCode(now, seq)
    const taken = await tx.goodsReceipt.findUnique({ where: { tenantId_code: { tenantId: business.tenantId, code } }, select: { id: true } })
    if (!taken) return code
  }
  throw failure(409, 'GOODS_RECEIPT_CODE_EXHAUSTED')
}

const isCounted = (orderLine) => orderLine.product?.stockPolicy === 'TRACKED'

export async function postGoodsReceipt(orderId, input, { viewer, db = prisma, now = new Date() } = {}) {
  const id = typeof orderId === 'string' ? orderId.trim() : ''
  if (!id) throw notFound()
  const data = zPostReceipt.parse(input)
  const result = await db.$transaction(async (tx) => {
    const order = await tx.purchaseOrder.findUnique({ where: { id }, select: PO_SELECT })
    if (!order) throw notFound()
    const business = await loadBusiness(tx, viewer, order.businessId, { capability: 'receipt' })
    if (order.status !== 'SENT') throw failure(409, 'PURCHASE_ORDER_NOT_RECEIVABLE')
    const plan = planReceipt(order.lines, data.lines)
    if (!plan.ok) throw Object.assign(failure(plan.code === 'PROCUREMENT_RECEIPT_LINE_NOT_FOUND' ? 422 : 409, plan.code), { details: plan.details })
    const byId = new Map(order.lines.map((line) => [line.id, line]))
    for (const line of data.lines) {
      const orderLine = byId.get(line.purchaseOrderLineId)
      if (!isCounted(orderLine) && (line.lotCode || line.expiresAt || line.serialNos?.length)) throw failure(422, 'PROCUREMENT_RECEIPT_LINE_NOT_COUNTED')
      if (orderLine.product?.status === 'ARCHIVED') throw failure(409, 'PRODUCT_ARCHIVED')
    }
    const stocked = data.lines.filter((line) => isCounted(byId.get(line.purchaseOrderLineId)))
    if (stocked.length && !mayManageInventory(viewer, business.id)) throw failure(403, 'PROCUREMENT_RECEIPT_REQUIRES_INVENTORY_AUTHORITY')

    const code = await nextCode(tx, business, now)
    const receivedAt = data.receivedAt ?? now
    const receipt = await tx.goodsReceipt.create({
      data: {
        code, tenantId: business.tenantId, businessId: business.id, purchaseOrderId: order.id,
        supplierReference: data.supplierReference ?? null, notes: data.notes ?? null, receivedAt, postedByPersonId: actor(viewer),
        lines: { create: data.lines.map((line) => ({ purchaseOrderLineId: line.purchaseOrderLineId, qty: line.qty, lotCode: line.lotCode ?? null, expiresAt: line.expiresAt ?? null, serialNosJson: line.serialNos?.length ? JSON.stringify(line.serialNos) : null })) },
      },
      select: RECEIPT_SELECT,
    })

    const reference = receiptReference(order.code, code)
    const posted = []
    for (const line of stocked) {
      const orderLine = byId.get(line.purchaseOrderLineId)
      const movement = await appendMovement(tx, {
        businessId: business.id, productId: orderLine.productId, kind: 'RECEIPT', quantity: line.qty,
        ...(line.lotCode ? { lotCode: line.lotCode } : {}), ...(line.serialNos?.length ? { serialNos: line.serialNos } : {}),
        reason: 'GOODS_RECEIPT', reference, occurredAt: receivedAt,
      }, { viewer })
      if (movement.lotId && line.expiresAt) {
        const lot = await tx.productLot.findUnique({ where: { id: movement.lotId }, select: { expiresAt: true } })
        if (lot && !lot.expiresAt) await tx.productLot.update({ where: { id: movement.lotId }, data: { expiresAt: line.expiresAt } })
      }
      posted.push({ purchaseOrderLineId: orderLine.id, productId: orderLine.productId, code: orderLine.product.code, quantity: line.qty, lotId: movement.lotId, onHandAfter: movement.onHandAfter })
    }

    const change = { version: { increment: 1 } }
    if (plan.completesOrder) {
      change.status = 'RECEIVED'
      change.receivedAt = receivedAt
    }
    await tx.purchaseOrder.update({ where: { id: order.id }, data: change })
    await recordAudit(tx, {
      entityType: GOODS_RECEIPT_ENTITY, entityId: receipt.id, action: 'GOODS_RECEIPT_POSTED', actorId: actor(viewer),
      payload: { businessId: business.id, code, purchaseOrderCode: order.code, supplierReference: receipt.supplierReference, lines: data.lines.length, posted, completesOrder: plan.completesOrder },
    })
    if (plan.completesOrder) {
      await recordAudit(tx, {
        entityType: PURCHASE_ORDER_ENTITY, entityId: order.id, action: 'PURCHASE_ORDER_RECEIVED', actorId: actor(viewer),
        payload: { businessId: business.id, code: order.code, receiptCode: code, from: { status: 'SENT' }, to: { status: 'RECEIVED' }, version: order.version + 1 },
      })
    }
    const updated = await tx.purchaseOrder.findUnique({ where: { id: order.id }, select: PO_SELECT })
    return { receipt, order: updated, posted }
  })
  return { receipt: receiptDto(result.receipt), order: purchaseOrderDto(result.order), posted: result.posted }
}

export async function listGoodsReceipts(orderId, { viewer, db = prisma } = {}) {
  const id = typeof orderId === 'string' ? orderId.trim() : ''
  if (!id) throw notFound()
  const order = await db.purchaseOrder.findUnique({ where: { id }, select: { id: true, code: true, businessId: true } })
  if (!order) throw notFound()
  await loadBusiness(db, viewer, order.businessId)
  const rows = await db.goodsReceipt.findMany({ where: { purchaseOrderId: order.id }, orderBy: [{ receivedAt: 'asc' }, { createdAt: 'asc' }], select: RECEIPT_SELECT })
  return { purchaseOrderId: order.id, purchaseOrderCode: order.code, receipts: rows.map(receiptDto) }
}
