import { SALES_ORDER_ENTITY, isOrderClosed, nextOrderStatus, resolveOrigin, toSatang, zCreateOrder, zOrderAction, zOrderListQuery } from '../../../kernel/commerce/commerce.js'
import { commerceAuthority, denied } from '../../../infrastructure/delegation.js'
import { enqueueOutbox, recordAudit } from '../../../infrastructure/evidence.js'
import * as inventory from '../../inventory/index.js'
import * as repo from '../adapters/commerce-repo.js'
import { nextCommerceCode } from './codes.js'
import { orderDto } from './orders.js'

// Sales orders (FR-166) inside SCM — port of apps/server sales-order-service
// createOrder / applyOrderAction with the same codes, order of refusals and
// audit actions:
//   create  — lines may name an ACTIVE SKU of the Business (price always given);
//             Customer and Conversation are CRM facts judged here: same Tenant,
//             not deleted, and — exactly as legacy — a Business-bound one only if
//             the actor can SEE that Business (legacy does not require it to be
//             this Business); a Conversation supplies its Customer when none is
//             named, refuses a different one, and makes the origin CHAT.
//   actions — versioned UPDATE (lines only while DRAFT) / CONFIRM / COMPLETE /
//             CANCEL, compare-and-swap on (id, version). COMPLETE with issueStock
//             needs Inventory's write authority, reports every short line at
//             once (COMMERCE_STOCK_SHORTAGE) before anything moves, refuses serial
//             lines, and issues per product through the Inventory writer (FEFO).
// Parity note (F-10): like legacy, the fulfilment ISSUE names neither the customer
// nor the order, so the dedication rule does not engage on this path.

const failure = (status, code, details) => Object.assign(new Error(code), { status, code, retryable: false, ...(details ? { details } : {}) })

function judgeCustomer(scope, business, customerId, fact) {
  if (!fact || fact.tenantId !== business.tenantId || fact.deletedAt) throw failure(422, 'CUSTOMER_NOT_FOUND')
  if (fact.businessId && !scope.visible(fact.businessId)) throw failure(422, 'CUSTOMER_NOT_FOUND')
  return fact
}

function judgeConversation(scope, business, fact) {
  if (!fact || fact.tenantId !== business.tenantId) throw failure(422, 'CONVERSATION_NOT_FOUND')
  if (fact.businessId && !scope.visible(fact.businessId)) throw failure(422, 'CONVERSATION_NOT_FOUND')
  return fact
}

function resolveLines(sql, business, lines) {
  const products = new Map(inventory.productsByIds(sql, [...new Set(lines.map((l) => l.productId).filter(Boolean))]).map((p) => [p.id, p]))
  return lines.map((line, index) => {
    let description = line.description ?? null
    if (line.productId) {
      const product = products.get(line.productId)
      if (!product || product.businessId !== business.id || product.tenantId !== business.tenantId) throw failure(422, 'PRODUCT_NOT_FOUND')
      if (product.status === 'ARCHIVED') throw failure(409, 'PRODUCT_ARCHIVED')
      description = description ?? product.name ?? product.code
    }
    return { productId: line.productId ?? null, description, qty: line.qty, unitPriceSatang: toSatang(line.unitPrice), discountSatang: toSatang(line.discount ?? 0), sortOrder: index }
  })
}

// ── create ───────────────────────────────────────────────────────────────────
export async function prepareCreateOrder(scope, body, { references }) {
  const data = zCreateOrder.parse(body)
  const business = commerceAuthority.require(scope, data.businessId, 'order')
  const [customer, conversation] = await Promise.all([
    data.customerId ? references.customer(scope, { businessId: business.id, customerId: data.customerId }) : null,
    data.conversationId ? references.conversation(scope, { businessId: business.id, conversationId: data.conversationId }) : null,
  ])
  return { data, facts: { customer, conversation, verifiedAt: new Date().toISOString(), authority: references.kind } }
}

export function createOrder(sql, scope, prepared, { now, requestId }) {
  const { data, facts } = prepared
  const business = commerceAuthority.require(scope, data.businessId, 'order')
  let customerId = data.customerId ?? null
  if (customerId) judgeCustomer(scope, business, customerId, facts.customer)
  const conversationId = data.conversationId ?? null
  if (conversationId) {
    const conversation = judgeConversation(scope, business, facts.conversation)
    if (customerId && conversation.customerId !== customerId) throw failure(422, 'CONVERSATION_CUSTOMER_MISMATCH')
    customerId = customerId ?? conversation.customerId
  }
  const lines = resolveLines(sql, business, data.lines)
  const code = nextCommerceCode(sql, 'SalesOrder', business, now)
  const id = repo.insertOrder(sql, {
    code, tenantId: business.tenantId, businessId: business.id, customerId, conversationId, origin: resolveOrigin({ conversationId, origin: data.origin }),
    status: 'DRAFT', currency: data.currency ?? 'THB', discountSatang: toSatang(data.discount ?? 0), notes: data.notes ?? null,
    orderedAt: data.orderedAt ? data.orderedAt.toISOString() : now, createdByPersonId: scope.actorId, now,
  }, lines)
  const order = orderDto(repo.loadOrder(sql, id), customerId && facts.customer?.id === customerId ? facts.customer : null)
  recordAudit(sql, { entityType: SALES_ORDER_ENTITY, entityId: id, action: 'SALES_ORDER_CREATED', actorId: scope.actorId, tenantId: business.tenantId, businessId: business.id, requestId, now, payload: { businessId: business.id, code, origin: order.origin, customerId, conversationId, lines: lines.length, total: order.total } })
  enqueueOutbox(sql, { topic: 'scm.commerce.sales-order.created', aggregateType: SALES_ORDER_ENTITY, aggregateId: id, aggregateVersion: 1, now, payload: { businessId: business.id, code, origin: order.origin } })
  return { response: { order, references: { verifiedAt: facts.verifiedAt, authority: facts.authority } }, affected: { salesOrderId: id, salesOrderCode: code, salesOrderVersion: 1, status: 'DRAFT' } }
}

// ── actions ──────────────────────────────────────────────────────────────────
export function loadOrderInScope(sql, scope, id, capability) {
  const orderId = typeof id === 'string' ? id.trim() : ''
  const row = orderId ? repo.loadOrder(sql, orderId) : null
  if (!row || row.tenantId !== scope.tenantId) throw denied()
  commerceAuthority.require(scope, row.businessId, capability)
  return row
}

export async function prepareOrderAction(scope, { orderId, body }, { references, readOrder }) {
  const data = zOrderAction.parse(body)
  const row = await readOrder(orderId)
  const customerId = data.fields?.customerId
  const customer = customerId ? await references.customer(scope, { businessId: row.businessId, customerId }) : null
  return { data, facts: { customer, verifiedAt: new Date().toISOString(), authority: references.kind } }
}

/** Every counted line issued through the Inventory writer, or nothing; returns what moved. */
function issueStockForOrder(sql, scope, business, order, { now, requestId, faults }) {
  if (!inventory.inventoryAuthority.mayManage(scope, business.id)) throw failure(403, 'COMMERCE_STOCK_ISSUE_REQUIRES_INVENTORY_AUTHORITY')
  const productIds = [...new Set(order.lines.map((l) => l.productId).filter(Boolean))]
  if (!productIds.length) return []
  const byId = new Map(inventory.productsByIds(sql, productIds).map((p) => [p.id, p]))
  const needed = new Map()
  for (const line of order.lines) if (line.productId) needed.set(line.productId, (needed.get(line.productId) || 0) + line.qty)
  const short = []
  for (const [productId, qty] of needed) {
    const product = byId.get(productId)
    if (!product || product.status === 'ARCHIVED') throw failure(409, 'PRODUCT_ARCHIVED')
    if (product.stockPolicy !== 'TRACKED') continue
    if (product.trackingMode === 'SERIAL') throw failure(422, 'COMMERCE_SERIAL_LINE_UNSUPPORTED')
    const onHand = inventory.onHandOf(sql, productId)
    if (onHand < qty) short.push({ productId, code: product.code, required: qty, onHand, shortage: qty - onHand })
  }
  if (short.length) throw failure(409, 'COMMERCE_STOCK_SHORTAGE', short)
  const issued = []
  for (const [productId, qty] of needed) {
    const product = byId.get(productId)
    if (product.stockPolicy !== 'TRACKED') continue
    const result = inventory.appendMovement(sql, scope, { businessId: business.id, productId, kind: 'ISSUE', quantity: qty, reason: 'ORDER_FULFILMENT', reference: `ORDER:${order.code}`, occurredAt: now, requestId }, { now })
    issued.push({ productId, code: product.code, quantity: qty, onHandAfter: result.onHandAfter, movementIds: result.movements.map((m) => m.id) })
    faults.afterStockIssue?.()
  }
  return issued
}

const ACTIONS = Object.freeze({ UPDATE: 'SALES_ORDER_UPDATED', CONFIRM: 'SALES_ORDER_CONFIRMED', COMPLETE: 'SALES_ORDER_COMPLETED', CANCEL: 'SALES_ORDER_CANCELLED' })

export function applyOrderAction(sql, scope, orderId, prepared, { now, requestId, faults = {} }) {
  const { data, facts } = prepared
  const row = loadOrderInScope(sql, scope, orderId, 'order')
  const business = { id: row.businessId, tenantId: row.tenantId }
  if (row.version !== data.version) throw failure(409, 'SALES_ORDER_VERSION_CONFLICT')
  const status = nextOrderStatus(row.status, data.action)
  if (!status) throw failure(409, 'SALES_ORDER_STATUS_INVALID')
  const change = { status }
  let lines = null
  let issued = null
  const payload = { businessId: row.businessId, code: row.code, from: { status: row.status }, to: { status } }
  switch (data.action) {
    case 'UPDATE': {
      const f = data.fields
      if (f.lines) {
        if (row.status !== 'DRAFT') throw failure(409, 'SALES_ORDER_LINES_LOCKED')
        lines = resolveLines(sql, business, f.lines)
      }
      if (f.customerId !== undefined) {
        if (f.customerId) judgeCustomer(scope, business, f.customerId, facts.customer)
        change.customerId = f.customerId
      }
      if (f.discount !== undefined) change.discountSatang = toSatang(f.discount)
      if (f.notes !== undefined) change.notes = f.notes
      if (f.orderedAt !== undefined) change.orderedAt = f.orderedAt.toISOString()
      payload.fields = Object.keys(f)
      break
    }
    case 'CONFIRM':
      change.confirmedAt = now
      break
    case 'COMPLETE':
      change.completedAt = now
      change.closedByPersonId = scope.actorId
      if (data.issueStock) {
        issued = issueStockForOrder(sql, scope, business, row, { now, requestId, faults })
        // The audit payload keeps the legacy shape; movement ids go to the operation receipt.
        payload.issued = issued.map(({ movementIds, ...entry }) => entry)
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
  faults.beforeOrderUpdate?.()
  if (repo.casUpdateOrder(sql, { id: row.id, version: row.version, change, lines, now }) !== 1) throw failure(409, 'SALES_ORDER_VERSION_CONFLICT')
  recordAudit(sql, { entityType: SALES_ORDER_ENTITY, entityId: row.id, action: ACTIONS[data.action], actorId: scope.actorId, tenantId: row.tenantId, businessId: row.businessId, requestId, now, payload: { ...payload, version: row.version + 1 } })
  faults.afterAudit?.()
  enqueueOutbox(sql, { topic: `scm.commerce.sales-order.${data.action.toLowerCase()}`, aggregateType: SALES_ORDER_ENTITY, aggregateId: row.id, aggregateVersion: row.version + 1, now, payload: { businessId: row.businessId, code: row.code, status, movementIds: (issued ?? []).flatMap((i) => i.movementIds) } })
  const order = orderDto(repo.loadOrder(sql, row.id), updatedCustomerRef(data, facts))
  return { response: { order, ...(issued ? { issued: payload.issued } : {}) }, affected: { salesOrderId: row.id, salesOrderVersion: row.version + 1, status, stockMovementIds: (issued ?? []).flatMap((i) => i.movementIds) } }
}

/** Legacy listOrders: open orders by default, filters, and the open-work summary. */
export function listOrders(sql, scope, query) {
  const q = zOrderListQuery.parse(query)
  const business = commerceAuthority.require(scope, q.businessId)
  const orders = repo.orderIdsOf(sql, { businessId: business.id, status: q.status, includeClosed: q.includeClosed, origin: q.origin, customerId: q.customerId, conversationId: q.conversationId, limit: q.limit ?? 200 })
    .map((id) => orderDto(repo.loadOrder(sql, id)))
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

/** The CRM fact for a customer set by this UPDATE, so the response can carry its code. */
const updatedCustomerRef = (data, facts) => (data.fields?.customerId && facts.customer?.id === data.fields.customerId ? facts.customer : null)
