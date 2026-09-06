import prisma from '@/lib/db'
import { recordAudit } from '@/modules/project-manager/application/audit'
import {
  PURCHASE_ORDER_ENTITY,
  dayKey,
  fromSatang,
  lineCostSatang,
  lineReceipt,
  nextPurchaseOrderStatus,
  procurementSummary,
  purchaseOrderCode,
  purchaseOrderTotals,
  receiptState,
  toSatang,
  zCreatePurchaseOrder,
  zPurchaseOrderAction,
  zPurchaseOrderListQuery,
} from '../domain/procurement'
import { loadBusiness, notFound } from './procurement-authority'

// @req FR-160 — the only writer of PurchaseOrder and its lines: create an
//   order against an ACTIVE Supplier of the same Business with lines that may
//   name an inventory SKU of the same Business (the unit cost is always given
//   — the agreed price of this purchase, not Inventory's catalogue cost), a
//   generated `PO-YYYYMMDD-NNN` code, and the versioned actions UPDATE (lines
//   and supplier only while DRAFT), SEND, CLOSE (a short-close of a SENT
//   order with lines outstanding) and CANCEL (refused once anything was
//   received — the receipt already moved stock). Total, received and
//   outstanding quantities and the `receiptState` are computed on every read
//   from the lines and their receipt lines — never stored. Every write is
//   one transaction with one audit row; nothing is deleted.
// @spec ADR-066; ADR-054 D3/D4; BR-001; BR-002; SEC-001; FR-072
// @tested tests/integration/fr160-procurement.test.js

const failure = (status, message) => Object.assign(new Error(message), { status })
const actor = (viewer) => viewer?.principal?.id ?? null

const LINE_SELECT = {
  id: true, productId: true, description: true, qty: true, unitCostSatang: true, sortOrder: true,
  product: { select: { id: true, code: true, name: true, stockPolicy: true, trackingMode: true, status: true } },
  receiptLines: { select: { id: true, receiptId: true, qty: true } },
}
const RECEIPT_LINE_SELECT = { id: true, purchaseOrderLineId: true, qty: true, lotCode: true, expiresAt: true, serialNosJson: true }
const RECEIPT_SELECT = { id: true, code: true, purchaseOrderId: true, supplierReference: true, notes: true, receivedAt: true, postedByPersonId: true, createdAt: true, lines: { select: RECEIPT_LINE_SELECT } }
const PO_SELECT = {
  id: true, code: true, tenantId: true, businessId: true, supplierId: true, status: true, currency: true, expectedAt: true, notes: true, orderedAt: true,
  sentAt: true, receivedAt: true, closedAt: true, closeReason: true, cancelledAt: true, cancelReason: true, createdByPersonId: true, createdAt: true, updatedAt: true, version: true,
  supplier: { select: { id: true, code: true, name: true, status: true } },
  lines: { select: LINE_SELECT, orderBy: { sortOrder: 'asc' } },
  receipts: { select: RECEIPT_SELECT, orderBy: { receivedAt: 'asc' } },
}

const parseSerials = (json) => {
  if (!json) return []
  try {
    const value = JSON.parse(json)
    return Array.isArray(value) ? value : []
  } catch {
    return []
  }
}

const lineDto = (l) => {
  const { receivedQty, outstandingQty } = lineReceipt(l)
  return {
    id: l.id, productId: l.productId, description: l.description, qty: l.qty, unitCost: fromSatang(l.unitCostSatang), lineTotal: fromSatang(lineCostSatang(l)),
    receivedQty, outstandingQty,
    product: l.product ? { code: l.product.code, name: l.product.name, stockPolicy: l.product.stockPolicy, trackingMode: l.product.trackingMode, counted: l.product.stockPolicy === 'TRACKED' } : null,
  }
}

export const receiptDto = (r) => ({ ...r, lines: r.lines.map(({ serialNosJson, ...line }) => ({ ...line, serialNos: parseSerials(serialNosJson) })) })

export function purchaseOrderDto(row) {
  const { lines, receipts, supplier, ...order } = row
  const totals = purchaseOrderTotals(lines)
  return {
    ...order,
    supplier: supplier ? { id: supplier.id, code: supplier.code, name: supplier.name } : null,
    total: fromSatang(totals.total),
    receivedValue: fromSatang(totals.receivedValue),
    outstandingValue: fromSatang(totals.outstandingValue),
    outstandingValueSatang: totals.outstandingValue,
    receiptState: receiptState(lines),
    receiptCount: receipts.length,
    lines: lines.map(lineDto),
    receipts: receipts.map(receiptDto),
  }
}

async function requireSupplier(tx, business, supplierId) {
  const supplier = await tx.supplier.findUnique({ where: { id: supplierId }, select: { id: true, businessId: true, status: true } })
  if (!supplier || supplier.businessId !== business.id) throw failure(422, 'SUPPLIER_NOT_FOUND')
  if (supplier.status === 'ARCHIVED') throw failure(409, 'SUPPLIER_ARCHIVED')
  return supplier
}

/** Lines resolved to columns; a product must be a non-archived SKU of the same Business and lends its name as the description. */
async function resolveLines(tx, business, lines) {
  const out = []
  for (const [index, line] of lines.entries()) {
    let description = line.description ?? null
    if (line.productId) {
      const product = await tx.product.findUnique({ where: { id: line.productId }, select: { id: true, businessId: true, status: true, code: true, name: true } })
      if (!product || product.businessId !== business.id) throw failure(422, 'PRODUCT_NOT_FOUND')
      if (product.status === 'ARCHIVED') throw failure(409, 'PRODUCT_ARCHIVED')
      description = description ?? product.name ?? product.code
    }
    out.push({ productId: line.productId ?? null, description, qty: line.qty, unitCostSatang: toSatang(line.unitCost), sortOrder: index })
  }
  return out
}

async function nextCode(tx, business, now) {
  const prefix = `PO-${dayKey(now).replace(/-/g, '')}-`
  const count = await tx.purchaseOrder.count({ where: { tenantId: business.tenantId, code: { startsWith: prefix } } })
  for (let seq = count + 1; seq < count + 50; seq += 1) {
    const code = purchaseOrderCode(now, seq)
    const taken = await tx.purchaseOrder.findUnique({ where: { tenantId_code: { tenantId: business.tenantId, code } }, select: { id: true } })
    if (!taken) return code
  }
  throw failure(409, 'PURCHASE_ORDER_CODE_EXHAUSTED')
}

export async function createPurchaseOrder(input, { viewer, db = prisma, now = new Date() } = {}) {
  const data = zCreatePurchaseOrder.parse(input)
  const row = await db.$transaction(async (tx) => {
    const business = await loadBusiness(tx, viewer, data.businessId, { capability: 'po' })
    const supplier = await requireSupplier(tx, business, data.supplierId)
    const lines = await resolveLines(tx, business, data.lines)
    const code = await nextCode(tx, business, now)
    const created = await tx.purchaseOrder.create({
      data: {
        code, tenantId: business.tenantId, businessId: business.id, supplierId: supplier.id, currency: data.currency ?? 'THB',
        expectedAt: data.expectedAt ?? null, notes: data.notes ?? null, orderedAt: data.orderedAt ?? now, createdByPersonId: actor(viewer),
        lines: { create: lines },
      },
      select: PO_SELECT,
    })
    const dto = purchaseOrderDto(created)
    await recordAudit(tx, { entityType: PURCHASE_ORDER_ENTITY, entityId: created.id, action: 'PURCHASE_ORDER_CREATED', actorId: actor(viewer), payload: { businessId: business.id, code: created.code, supplierId: supplier.id, lines: lines.length, total: dto.total } })
    return created
  })
  return purchaseOrderDto(row)
}

export async function listPurchaseOrders(query, { viewer, db = prisma } = {}) {
  const q = zPurchaseOrderListQuery.parse(query)
  const business = await loadBusiness(db, viewer, q.businessId)
  const where = {
    businessId: business.id,
    ...(q.status ? { status: q.status } : q.includeClosed ? {} : { status: { in: ['DRAFT', 'SENT'] } }),
    ...(q.supplierId ? { supplierId: q.supplierId } : {}),
  }
  const rows = await db.purchaseOrder.findMany({ where, orderBy: [{ orderedAt: 'desc' }, { createdAt: 'desc' }], take: q.limit ?? 200, select: PO_SELECT })
  const orders = rows.map(purchaseOrderDto)
  const summary = procurementSummary(orders)
  return {
    businessId: business.id,
    orders,
    summary: { open: summary.open, draft: summary.draft, awaitingDelivery: summary.awaitingDelivery, partiallyReceived: summary.partiallyReceived, outstandingValue: fromSatang(summary.outstandingValueSatang) },
  }
}

export async function getPurchaseOrder(id, { viewer, db = prisma } = {}) {
  const orderId = typeof id === 'string' ? id.trim() : ''
  if (!orderId) throw notFound()
  const row = await db.purchaseOrder.findUnique({ where: { id: orderId }, select: PO_SELECT })
  if (!row) throw notFound()
  await loadBusiness(db, viewer, row.businessId)
  return purchaseOrderDto(row)
}

const ACTIONS = Object.freeze({ UPDATE: 'PURCHASE_ORDER_UPDATED', SEND: 'PURCHASE_ORDER_SENT', CLOSE: 'PURCHASE_ORDER_CLOSED', CANCEL: 'PURCHASE_ORDER_CANCELLED' })

/** Apply one versioned action; compare-and-swap on (id, version). */
export async function applyPurchaseOrderAction(id, input, { viewer, db = prisma, now = new Date() } = {}) {
  const orderId = typeof id === 'string' ? id.trim() : ''
  if (!orderId) throw notFound()
  const data = zPurchaseOrderAction.parse(input)
  const updated = await db.$transaction(async (tx) => {
    const row = await tx.purchaseOrder.findUnique({ where: { id: orderId }, select: PO_SELECT })
    if (!row) throw notFound()
    const business = await loadBusiness(tx, viewer, row.businessId, { capability: 'po' })
    if (row.version !== data.version) throw failure(409, 'PURCHASE_ORDER_VERSION_CONFLICT')
    const status = nextPurchaseOrderStatus(row.status, data.action)
    if (!status) throw failure(409, 'PURCHASE_ORDER_STATUS_INVALID')
    const change = { status }
    const payload = { businessId: row.businessId, code: row.code, from: { status: row.status }, to: { status } }
    switch (data.action) {
      case 'UPDATE': {
        const f = data.fields
        if (f.lines) {
          if (row.status !== 'DRAFT') throw failure(409, 'PURCHASE_ORDER_LINES_LOCKED')
          change.lines = { deleteMany: {}, create: await resolveLines(tx, business, f.lines) }
        }
        if (f.supplierId !== undefined) {
          if (row.status !== 'DRAFT') throw failure(409, 'PURCHASE_ORDER_SUPPLIER_LOCKED')
          await requireSupplier(tx, business, f.supplierId)
          change.supplierId = f.supplierId
        }
        if (f.expectedAt !== undefined) change.expectedAt = f.expectedAt
        if (f.notes !== undefined) change.notes = f.notes
        if (f.orderedAt !== undefined) change.orderedAt = f.orderedAt
        payload.fields = Object.keys(f)
        break
      }
      case 'SEND':
        change.sentAt = now
        break
      case 'CLOSE':
        change.closedAt = now
        change.closeReason = data.reason ?? null
        payload.reason = change.closeReason
        payload.receiptState = receiptState(row.lines)
        break
      case 'CANCEL':
        if (row.receipts.length) throw failure(409, 'PURCHASE_ORDER_HAS_RECEIPTS')
        change.cancelledAt = now
        change.cancelReason = data.reason ?? null
        payload.reason = change.cancelReason
        break
      default:
        throw failure(400, 'PURCHASE_ORDER_ACTION_UNKNOWN')
    }
    const result = await tx.purchaseOrder.updateMany({ where: { id: row.id, version: row.version }, data: { version: { increment: 1 } } })
    if (result.count !== 1) throw failure(409, 'PURCHASE_ORDER_VERSION_CONFLICT')
    await tx.purchaseOrder.update({ where: { id: row.id }, data: change })
    await recordAudit(tx, { entityType: PURCHASE_ORDER_ENTITY, entityId: row.id, action: ACTIONS[data.action], actorId: actor(viewer), payload: { ...payload, version: row.version + 1 } })
    return tx.purchaseOrder.findUnique({ where: { id: row.id }, select: PO_SELECT })
  })
  return purchaseOrderDto(updated)
}

export { PO_SELECT, RECEIPT_SELECT }
