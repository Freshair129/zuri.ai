import {
  PURCHASE_ORDER_ENTITY, SUPPLIER_ENTITY, dayKey, fromSatang, lineCostSatang, lineReceipt, nextPurchaseOrderStatus,
  purchaseOrderCode, purchaseOrderTotals, receiptState, toSatang, zCreatePurchaseOrder, zCreateSupplier, zPurchaseOrderAction,
} from '../../../kernel/procurement/procurement.js'
import { procurementAuthority, denied } from '../../../infrastructure/delegation.js'
import { recordAudit, enqueueOutbox } from '../../../infrastructure/evidence.js'
import * as inventory from '../../inventory/index.js'
import * as repo from '../adapters/procurement-repo.js'

// Procurement use cases inside SCM — ports of apps/server supplier-service /
// purchase-order-service with the same refusals, codes and audit actions.
// Every function runs inside the caller's unit of work (`sql`).

const failure = (status, code, details) => Object.assign(new Error(code), { status, code, retryable: status === 409 && /VERSION_CONFLICT/.test(code), ...(details ? { details } : {}) })
const iso = (d) => (d instanceof Date ? d.toISOString() : d ?? null)

// ── DTOs (legacy purchaseOrderDto / receiptDto shapes) ──────────────────────
const parseSerials = (json) => { try { const v = JSON.parse(json ?? '[]'); return Array.isArray(v) ? v : [] } catch { return [] } }
export const receiptDto = (r) => ({ ...r, lines: r.lines.map(({ serialNosJson, ...line }) => ({ ...line, serialNos: parseSerials(serialNosJson) })) })

export function purchaseOrderDto(sql, row) {
  const products = new Map(inventory.productsByIds(sql, [...new Set(row.lines.map((l) => l.productId).filter(Boolean))]).map((p) => [p.id, p]))
  const { lines, receipts, supplier, ...order } = row
  const totals = purchaseOrderTotals(lines)
  return {
    ...order,
    supplier: supplier ? { id: supplier.id, code: supplier.code, name: supplier.name } : null,
    total: fromSatang(totals.total), receivedValue: fromSatang(totals.receivedValue), outstandingValue: fromSatang(totals.outstandingValue),
    outstandingValueSatang: totals.outstandingValue, receiptState: receiptState(lines), receiptCount: receipts.length,
    lines: lines.map((l) => {
      const { receivedQty, outstandingQty } = lineReceipt(l)
      const p = l.productId ? products.get(l.productId) : null
      return { id: l.id, productId: l.productId, description: l.description, qty: l.qty, unitCost: fromSatang(l.unitCostSatang), lineTotal: fromSatang(lineCostSatang(l)), receivedQty, outstandingQty, product: p ? { code: p.code, name: p.name, stockPolicy: p.stockPolicy, trackingMode: p.trackingMode, counted: p.stockPolicy === 'TRACKED' } : null }
    }),
    receipts: receipts.map(receiptDto),
  }
}

// ── Supplier ────────────────────────────────────────────────────────────────
export function createSupplier(sql, scope, input, { now, requestId }) {
  const data = zCreateSupplier.parse(input)
  const business = procurementAuthority.require(scope, data.businessId, 'po')
  if (repo.supplierByCode(sql, business.tenantId, data.code)) throw failure(409, 'SUPPLIER_CODE_TAKEN')
  const { businessId, ...fields } = data
  const created = repo.insertSupplier(sql, { ...fields, tenantId: business.tenantId, businessId: business.id, now })
  recordAudit(sql, { entityType: SUPPLIER_ENTITY, entityId: created.id, action: 'SUPPLIER_CREATED', actorId: scope.actorId, tenantId: business.tenantId, businessId: business.id, requestId, now, payload: { businessId: business.id, code: created.code, name: created.name } })
  return created
}

// ── Purchase order ──────────────────────────────────────────────────────────
function requireSupplier(sql, business, supplierId) {
  const supplier = repo.supplierById(sql, supplierId)
  if (!supplier || supplier.businessId !== business.id) throw failure(422, 'SUPPLIER_NOT_FOUND')
  if (supplier.status === 'ARCHIVED') throw failure(409, 'SUPPLIER_ARCHIVED')
  return supplier
}

function resolveLines(sql, business, lines) {
  const products = new Map(inventory.productsByIds(sql, lines.map((l) => l.productId).filter(Boolean)).map((p) => [p.id, p]))
  return lines.map((line, index) => {
    let description = line.description ?? null
    if (line.productId) {
      const product = products.get(line.productId)
      if (!product || product.businessId !== business.id) throw failure(422, 'PRODUCT_NOT_FOUND')
      if (product.status === 'ARCHIVED') throw failure(409, 'PRODUCT_ARCHIVED')
      description = description ?? product.name ?? product.code
    }
    return { productId: line.productId ?? null, description, qty: line.qty, unitCostSatang: toSatang(line.unitCost), sortOrder: index }
  })
}

function nextCode(sql, table, business, now, codeFor, exhausted) {
  const prefix = `${table === 'GoodsReceipt' ? 'GRN' : 'PO'}-${dayKey(now).replace(/-/g, '')}-`
  const count = repo.countCodesWithPrefix(sql, table, business.tenantId, prefix)
  for (let seq = count + 1; seq < count + 50; seq += 1) {
    const code = codeFor(now, seq)
    if (!repo.codeTaken(sql, table, business.tenantId, code)) return code
  }
  throw failure(409, exhausted)
}
export const nextGoodsReceiptCode = (sql, business, now, codeFor) => nextCode(sql, 'GoodsReceipt', business, now, codeFor, 'GOODS_RECEIPT_CODE_EXHAUSTED')

export function loadOrderInScope(sql, scope, id, capability) {
  const orderId = typeof id === 'string' ? id.trim() : ''
  if (!orderId) throw denied()
  const row = repo.loadPurchaseOrder(sql, orderId)
  if (!row || row.tenantId !== scope.tenantId) throw denied()
  procurementAuthority.require(scope, row.businessId, capability)
  return row
}

export function createPurchaseOrder(sql, scope, input, { now, requestId }) {
  const data = zCreatePurchaseOrder.parse(input)
  const business = procurementAuthority.require(scope, data.businessId, 'po')
  const supplier = requireSupplier(sql, business, data.supplierId)
  const lines = resolveLines(sql, business, data.lines)
  const code = nextCode(sql, 'PurchaseOrder', business, new Date(now), purchaseOrderCode, 'PURCHASE_ORDER_CODE_EXHAUSTED')
  const id = repo.insertPurchaseOrder(sql, { code, tenantId: business.tenantId, businessId: business.id, supplierId: supplier.id, currency: data.currency ?? 'THB', expectedAt: iso(data.expectedAt), notes: data.notes ?? null, orderedAt: iso(data.orderedAt) ?? now, createdByPersonId: scope.actorId, now }, lines)
  const dto = purchaseOrderDto(sql, repo.loadPurchaseOrder(sql, id))
  recordAudit(sql, { entityType: PURCHASE_ORDER_ENTITY, entityId: id, action: 'PURCHASE_ORDER_CREATED', actorId: scope.actorId, tenantId: business.tenantId, businessId: business.id, requestId, now, payload: { businessId: business.id, code, supplierId: supplier.id, lines: lines.length, total: dto.total } })
  enqueueOutbox(sql, { topic: 'scm.procurement.purchase-order.created', aggregateType: PURCHASE_ORDER_ENTITY, aggregateId: id, aggregateVersion: dto.version, now, payload: { businessId: business.id, code } })
  return dto
}

export function getPurchaseOrder(sql, scope, id) {
  return purchaseOrderDto(sql, loadOrderInScope(sql, scope, id, 'read'))
}

const ACTIONS = Object.freeze({ UPDATE: 'PURCHASE_ORDER_UPDATED', SEND: 'PURCHASE_ORDER_SENT', CLOSE: 'PURCHASE_ORDER_CLOSED', CANCEL: 'PURCHASE_ORDER_CANCELLED' })

export function applyPurchaseOrderAction(sql, scope, id, input, { now, requestId }) {
  const data = zPurchaseOrderAction.parse(input)
  const row = loadOrderInScope(sql, scope, id, 'po')
  const business = { id: row.businessId, tenantId: row.tenantId }
  if (row.version !== data.version) throw failure(409, 'PURCHASE_ORDER_VERSION_CONFLICT')
  const status = nextPurchaseOrderStatus(row.status, data.action)
  if (!status) throw failure(409, 'PURCHASE_ORDER_STATUS_INVALID')
  const change = { status }
  const payload = { businessId: row.businessId, code: row.code, from: { status: row.status }, to: { status } }
  let newLines = null
  switch (data.action) {
    case 'UPDATE': {
      const f = data.fields
      if (f.lines) { if (row.status !== 'DRAFT') throw failure(409, 'PURCHASE_ORDER_LINES_LOCKED'); newLines = resolveLines(sql, business, f.lines) }
      if (f.supplierId !== undefined) { if (row.status !== 'DRAFT') throw failure(409, 'PURCHASE_ORDER_SUPPLIER_LOCKED'); requireSupplier(sql, business, f.supplierId); change.supplierId = f.supplierId }
      if (f.expectedAt !== undefined) change.expectedAt = iso(f.expectedAt)
      if (f.notes !== undefined) change.notes = f.notes
      if (f.orderedAt !== undefined) change.orderedAt = iso(f.orderedAt)
      payload.fields = Object.keys(f)
      break
    }
    case 'SEND': change.sentAt = now; break
    case 'CLOSE': change.closedAt = now; change.closeReason = data.reason ?? null; payload.reason = change.closeReason; payload.receiptState = receiptState(row.lines); break
    case 'CANCEL':
      if (row.receipts.length) throw failure(409, 'PURCHASE_ORDER_HAS_RECEIPTS')
      change.cancelledAt = now; change.cancelReason = data.reason ?? null; payload.reason = change.cancelReason
      break
    default: throw failure(400, 'PURCHASE_ORDER_ACTION_UNKNOWN')
  }
  if (repo.casUpdatePurchaseOrder(sql, { id: row.id, version: row.version, change, now }) !== 1) throw failure(409, 'PURCHASE_ORDER_VERSION_CONFLICT')
  if (newLines) { repo.deleteLines(sql, row.id); repo.insertLines(sql, row.id, newLines) }
  recordAudit(sql, { entityType: PURCHASE_ORDER_ENTITY, entityId: row.id, action: ACTIONS[data.action], actorId: scope.actorId, tenantId: row.tenantId, businessId: row.businessId, requestId, now, payload: { ...payload, version: row.version + 1 } })
  enqueueOutbox(sql, { topic: `scm.procurement.purchase-order.${data.action.toLowerCase()}`, aggregateType: PURCHASE_ORDER_ENTITY, aggregateId: row.id, aggregateVersion: row.version + 1, now, payload: { businessId: row.businessId, code: row.code, status } })
  return purchaseOrderDto(sql, repo.loadPurchaseOrder(sql, row.id))
}
