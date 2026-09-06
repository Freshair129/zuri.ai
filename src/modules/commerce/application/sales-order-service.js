import prisma from '@/lib/db'
import { recordAudit } from '@/modules/project-manager/application/audit'
import { seesBusiness } from '@/modules/identity/viewer-authority'
import { appendMovement, mayManage as mayManageInventory, stockOnHand } from '@/modules/inventory'
import {
  SALES_ORDER_ENTITY,
  dayKey,
  fromSatang,
  isOrderClosed,
  lineTotalSatang,
  nextOrderStatus,
  orderCode,
  orderTotals,
  paymentState,
  paymentSummary,
  resolveOrigin,
  toSatang,
  zCreateOrder,
  zOrderAction,
  zOrderListQuery,
} from '../domain/commerce'
import { loadBusiness, notFound } from './commerce-authority'

// @req FR-158 — the only writer of SalesOrder and its lines: create a sale
//   with its lines (a line may name an inventory SKU of the same Business; the
//   price is always given, because a catalogue price is Commerce's own future
//   concern, not Inventory's cost), an optional Customer and Conversation of
//   the same Tenant reached through the Business's tenant only (BR-001 — the
//   Conversation supplies its Customer when none is named and refuses a
//   different one, and makes the origin CHAT), a generated `ORD-YYYYMMDD-NNN`
//   code, and the versioned actions UPDATE (lines only while DRAFT), CONFIRM,
//   COMPLETE and CANCEL. COMPLETE may issue stock: every line naming a
//   counted SKU is issued through the Inventory ledger (FEFO for lots) with
//   the order as reference — refused whole when any is short, when a line
//   names a SERIAL-tracked SKU (a sale cannot pick serials), or when the
//   viewer lacks Inventory's write authority (a Commerce role does not widen
//   Inventory). Totals, paid, balance and payment state are computed on every
//   read from the lines and the verified payments — never stored. Every write
//   is one transaction with one audit row.
// @spec ADR-065; ADR-054 D3/D4; BR-001; BR-002; SEC-001; FR-072
// @tested tests/integration/fr158-sales-order.test.js

const failure = (status, message) => Object.assign(new Error(message), { status })
const actor = (viewer) => viewer?.principal?.id ?? null

const LINE_SELECT = { id: true, productId: true, description: true, qty: true, unitPriceSatang: true, discountSatang: true, sortOrder: true }
const PAYMENT_SELECT = { id: true, code: true, kind: true, method: true, amountSatang: true, status: true, bankReference: true, slipFileAssetId: true, note: true, paidAt: true, verifiedAt: true, verifiedByPersonId: true, rejectReason: true, createdAt: true, version: true }
const ORDER_SELECT = {
  id: true, code: true, tenantId: true, businessId: true, customerId: true, conversationId: true, origin: true, status: true, currency: true,
  discountSatang: true, notes: true, orderedAt: true, confirmedAt: true, completedAt: true, cancelledAt: true, cancelReason: true, stockIssuedAt: true,
  closedByPersonId: true, createdByPersonId: true, createdAt: true, updatedAt: true, version: true,
  lines: { select: LINE_SELECT, orderBy: { sortOrder: 'asc' } },
  payments: { select: PAYMENT_SELECT, orderBy: { paidAt: 'asc' } },
  customer: { select: { id: true, code: true, displayName: true } },
}

const lineDto = (l) => ({ id: l.id, productId: l.productId, description: l.description, qty: l.qty, unitPrice: fromSatang(l.unitPriceSatang), discount: fromSatang(l.discountSatang), lineTotal: fromSatang(lineTotalSatang(l)) })
const paymentDto = (p) => ({ ...p, amount: fromSatang(p.amountSatang), amountSatang: undefined })

export function orderDto(row) {
  const { lines, payments, customer, discountSatang, ...order } = row
  const totals = orderTotals(lines, discountSatang)
  const summary = paymentSummary(payments)
  return {
    ...order,
    customer: customer ?? null,
    attributed: Boolean(order.conversationId),
    discount: fromSatang(discountSatang),
    subtotal: fromSatang(totals.subtotal),
    lineDiscount: fromSatang(totals.lineDiscount),
    total: fromSatang(totals.total),
    paid: fromSatang(summary.paid),
    refunded: fromSatang(summary.refunded),
    net: fromSatang(summary.net),
    pending: fromSatang(summary.pending),
    balanceDue: fromSatang(Math.max(0, totals.total - summary.net)),
    paymentState: paymentState(totals.total, summary),
    lines: lines.map(lineDto),
    payments: payments.map(paymentDto),
  }
}

async function requireCustomer(tx, viewer, business, customerId) {
  const customer = await tx.customer.findUnique({ where: { id: customerId }, select: { id: true, tenantId: true, businessId: true, deletedAt: true } })
  if (!customer || customer.tenantId !== business.tenantId || customer.deletedAt) throw failure(422, 'CUSTOMER_NOT_FOUND')
  if (customer.businessId && !seesBusiness(viewer, customer.businessId)) throw failure(422, 'CUSTOMER_NOT_FOUND')
  return customer
}

async function requireConversation(tx, viewer, business, conversationId) {
  const conversation = await tx.conversation.findUnique({ where: { id: conversationId }, select: { id: true, tenantId: true, businessId: true, customerId: true } })
  if (!conversation || conversation.tenantId !== business.tenantId) throw failure(422, 'CONVERSATION_NOT_FOUND')
  if (conversation.businessId && !seesBusiness(viewer, conversation.businessId)) throw failure(422, 'CONVERSATION_NOT_FOUND')
  return conversation
}

/** Lines resolved to columns; a product must be an ACTIVE SKU of the same Business and lends its code/name as the description. */
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
    out.push({ productId: line.productId ?? null, description, qty: line.qty, unitPriceSatang: toSatang(line.unitPrice), discountSatang: toSatang(line.discount ?? 0), sortOrder: index })
  }
  return out
}

async function nextCode(tx, business, now) {
  const prefix = `ORD-${dayKey(now).replace(/-/g, '')}-`
  const count = await tx.salesOrder.count({ where: { tenantId: business.tenantId, code: { startsWith: prefix } } })
  for (let seq = count + 1; seq < count + 50; seq += 1) {
    const code = orderCode(now, seq)
    const taken = await tx.salesOrder.findUnique({ where: { tenantId_code: { tenantId: business.tenantId, code } }, select: { id: true } })
    if (!taken) return code
  }
  throw failure(409, 'SALES_ORDER_CODE_EXHAUSTED')
}

export async function createOrder(input, { viewer, db = prisma, now = new Date() } = {}) {
  const data = zCreateOrder.parse(input)
  const row = await db.$transaction(async (tx) => {
    const business = await loadBusiness(tx, viewer, data.businessId, { capability: 'order' })
    let customerId = data.customerId ?? null
    if (customerId) await requireCustomer(tx, viewer, business, customerId)
    const conversationId = data.conversationId ?? null
    if (conversationId) {
      const conversation = await requireConversation(tx, viewer, business, conversationId)
      if (customerId && conversation.customerId !== customerId) throw failure(422, 'CONVERSATION_CUSTOMER_MISMATCH')
      customerId = customerId ?? conversation.customerId
    }
    const lines = await resolveLines(tx, business, data.lines)
    const code = await nextCode(tx, business, now)
    const created = await tx.salesOrder.create({
      data: {
        code, tenantId: business.tenantId, businessId: business.id, customerId, conversationId,
        origin: resolveOrigin({ conversationId, origin: data.origin }), currency: data.currency ?? 'THB',
        discountSatang: toSatang(data.discount ?? 0), notes: data.notes ?? null, orderedAt: data.orderedAt ?? now,
        createdByPersonId: actor(viewer), lines: { create: lines },
      },
      select: ORDER_SELECT,
    })
    const dto = orderDto(created)
    await recordAudit(tx, { entityType: SALES_ORDER_ENTITY, entityId: created.id, action: 'SALES_ORDER_CREATED', actorId: actor(viewer), payload: { businessId: business.id, code: created.code, origin: created.origin, customerId, conversationId, lines: lines.length, total: dto.total } })
    return created
  })
  return orderDto(row)
}

export async function listOrders(query, { viewer, db = prisma } = {}) {
  const q = zOrderListQuery.parse(query)
  const business = await loadBusiness(db, viewer, q.businessId)
  const where = {
    businessId: business.id,
    ...(q.status ? { status: q.status } : q.includeClosed ? {} : { status: { in: ['DRAFT', 'CONFIRMED'] } }),
    ...(q.origin ? { origin: q.origin } : {}),
    ...(q.customerId ? { customerId: q.customerId } : {}),
    ...(q.conversationId ? { conversationId: q.conversationId } : {}),
  }
  const rows = await db.salesOrder.findMany({ where, orderBy: [{ orderedAt: 'desc' }, { createdAt: 'desc' }], take: q.limit ?? 200, select: ORDER_SELECT })
  const orders = rows.map(orderDto)
  return {
    businessId: business.id,
    orders,
    summary: {
      open: orders.filter((o) => !isOrderClosed(o.status)).length,
      unpaid: orders.filter((o) => !isOrderClosed(o.status) && o.paymentState !== 'PAID' && o.paymentState !== 'OVERPAID').length,
      pendingPayments: orders.reduce((n, o) => n + o.payments.filter((p) => p.status === 'PENDING').length, 0),
    },
  }
}

export async function getOrder(id, { viewer, db = prisma } = {}) {
  const orderId = typeof id === 'string' ? id.trim() : ''
  if (!orderId) throw notFound()
  const row = await db.salesOrder.findUnique({ where: { id: orderId }, select: ORDER_SELECT })
  if (!row) throw notFound()
  await loadBusiness(db, viewer, row.businessId)
  return orderDto(row)
}

const ACTIONS = Object.freeze({ UPDATE: 'SALES_ORDER_UPDATED', CONFIRM: 'SALES_ORDER_CONFIRMED', COMPLETE: 'SALES_ORDER_COMPLETED', CANCEL: 'SALES_ORDER_CANCELLED' })

/** Issue every counted line through the Inventory ledger, or nothing; returns what moved. */
async function issueStockForOrder(tx, viewer, business, order, now) {
  if (!mayManageInventory(viewer, business.id)) throw failure(403, 'COMMERCE_STOCK_ISSUE_REQUIRES_INVENTORY_AUTHORITY')
  const productIds = [...new Set(order.lines.map((l) => l.productId).filter(Boolean))]
  if (!productIds.length) return []
  const products = await tx.product.findMany({ where: { id: { in: productIds } }, select: { id: true, code: true, stockPolicy: true, trackingMode: true, status: true, movements: { select: { quantity: true } } } })
  const byId = new Map(products.map((p) => [p.id, p]))
  const needed = new Map()
  for (const line of order.lines) {
    if (!line.productId) continue
    needed.set(line.productId, (needed.get(line.productId) || 0) + line.qty)
  }
  const short = []
  for (const [productId, qty] of needed) {
    const product = byId.get(productId)
    if (!product || product.status === 'ARCHIVED') throw failure(409, 'PRODUCT_ARCHIVED')
    if (product.stockPolicy !== 'TRACKED') continue
    if (product.trackingMode === 'SERIAL') throw failure(422, 'COMMERCE_SERIAL_LINE_UNSUPPORTED')
    const onHand = stockOnHand(product.movements)
    if (onHand < qty) short.push({ productId, code: product.code, required: qty, onHand, shortage: qty - onHand })
  }
  if (short.length) throw Object.assign(failure(409, 'COMMERCE_STOCK_SHORTAGE'), { details: short })
  const issued = []
  for (const [productId, qty] of needed) {
    const product = byId.get(productId)
    if (product.stockPolicy !== 'TRACKED') continue
    const result = await appendMovement(tx, { businessId: business.id, productId, kind: 'ISSUE', quantity: qty, reason: 'ORDER_FULFILMENT', reference: `ORDER:${order.code}`, occurredAt: now }, { viewer })
    issued.push({ productId, code: product.code, quantity: qty, onHandAfter: result.onHandAfter })
  }
  return issued
}

/** Apply one versioned action; compare-and-swap on (id, version). */
export async function applyOrderAction(id, input, { viewer, db = prisma, now = new Date() } = {}) {
  const orderId = typeof id === 'string' ? id.trim() : ''
  if (!orderId) throw notFound()
  const data = zOrderAction.parse(input)
  const updated = await db.$transaction(async (tx) => {
    const row = await tx.salesOrder.findUnique({ where: { id: orderId }, select: ORDER_SELECT })
    if (!row) throw notFound()
    const business = await loadBusiness(tx, viewer, row.businessId, { capability: 'order' })
    if (row.version !== data.version) throw failure(409, 'SALES_ORDER_VERSION_CONFLICT')
    const status = nextOrderStatus(row.status, data.action)
    if (!status) throw failure(409, 'SALES_ORDER_STATUS_INVALID')
    const change = { status }
    const payload = { businessId: row.businessId, code: row.code, from: { status: row.status }, to: { status } }
    switch (data.action) {
      case 'UPDATE': {
        const f = data.fields
        if (f.lines) {
          if (row.status !== 'DRAFT') throw failure(409, 'SALES_ORDER_LINES_LOCKED')
          change.lines = { deleteMany: {}, create: await resolveLines(tx, business, f.lines) }
        }
        if (f.customerId !== undefined) {
          if (f.customerId) await requireCustomer(tx, viewer, business, f.customerId)
          change.customerId = f.customerId
        }
        if (f.discount !== undefined) change.discountSatang = toSatang(f.discount)
        if (f.notes !== undefined) change.notes = f.notes
        if (f.orderedAt !== undefined) change.orderedAt = f.orderedAt
        payload.fields = Object.keys(f)
        break
      }
      case 'CONFIRM':
        change.confirmedAt = now
        break
      case 'COMPLETE':
        change.completedAt = now
        change.closedByPersonId = actor(viewer)
        if (data.issueStock) {
          payload.issued = await issueStockForOrder(tx, viewer, business, row, now)
          change.stockIssuedAt = now
        }
        break
      case 'CANCEL':
        change.cancelledAt = now
        change.cancelReason = data.reason ?? null
        payload.reason = change.cancelReason
        break
      default:
        throw failure(400, 'SALES_ORDER_ACTION_UNKNOWN')
    }
    const result = await tx.salesOrder.updateMany({ where: { id: row.id, version: row.version }, data: { version: { increment: 1 } } })
    if (result.count !== 1) throw failure(409, 'SALES_ORDER_VERSION_CONFLICT')
    await tx.salesOrder.update({ where: { id: row.id }, data: change })
    await recordAudit(tx, { entityType: SALES_ORDER_ENTITY, entityId: row.id, action: ACTIONS[data.action], actorId: actor(viewer), payload: { ...payload, version: row.version + 1 } })
    return tx.salesOrder.findUnique({ where: { id: row.id }, select: ORDER_SELECT })
  })
  return orderDto(updated)
}

export { ORDER_SELECT }
