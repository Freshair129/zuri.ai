import { z } from 'zod'
import { PURCHASE_ORDER_ACTIONS, SUPPLIER_ACTIONS } from '@/lib/validation/enums'
import { zInventoryCode } from '@/modules/inventory/domain/inventory'

// @req FR-160 — the pure vocabulary and calculators of the buy side: the
//   supplier contract, the purchase-order line and its cost (integer satang —
//   the same money rule as Commerce, ADR-065 D2), the order's total, the
//   status machine (DRAFT → SENT → RECEIVED; SENT → CLOSED as a short-close;
//   DRAFT | SENT → CANCELLED), and the human codes `PO-YYYYMMDD-NNN`.
// @req FR-161 — the receipt side: what each order line has received and what
//   is still outstanding (derived from the receipt lines, never a column),
//   the order's `receiptState` NONE / PARTIAL / COMPLETE, the pure plan of a
//   receipt against an order (a line must name an order line, may not exceed
//   what is outstanding, and the plan says whether it completes the order),
//   and the code `GRN-YYYYMMDD-NNN`. No I/O here on purpose.
// @spec ADR-066; ADR-054 D3/D4; BR-002
// @tested tests/unit/procurement-domain.test.js

export const PROCUREMENT_DOMAIN_KEY = 'procurement'
export const SUPPLIER_ENTITY = 'SUPPLIER'
export const PURCHASE_ORDER_ENTITY = 'PURCHASE_ORDER'
export const GOODS_RECEIPT_ENTITY = 'GOODS_RECEIPT'
export const PROCUREMENT_TIME_ZONE = 'Asia/Bangkok'
export const PURCHASE_ORDER_OPEN_STATUSES = Object.freeze(['DRAFT', 'SENT'])
/** The derived receipt state of a purchase order — computed on read, never a column. */
export const RECEIPT_STATES = Object.freeze(['NONE', 'PARTIAL', 'COMPLETE'])

// ── Money (the Commerce rule: integer satang in columns, baht in the API) ───

/** Baht (at most two decimals) → integer satang. */
export function toSatang(baht) {
  const n = Number(baht)
  if (!Number.isFinite(n)) throw new Error('amount must be a finite number')
  return Math.round(n * 100)
}

/** Integer satang → baht number. */
export function fromSatang(satang) {
  return Math.round(Number(satang) || 0) / 100
}

const zBaht = z.number().finite().nonnegative().refine((v) => Math.abs(v * 100 - Math.round(v * 100)) < 1e-6, 'amounts carry at most two decimals')
const zId = z.string().trim().min(1).max(200)
const zText = (max) => z.string().trim().min(1).max(max)
const zOptionalText = (max) => z.string().trim().max(max).nullable().optional()
const zDate = z.coerce.date()
const SUPPLIER_CODE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/
export const zSupplierCode = z.string().trim().regex(SUPPLIER_CODE_PATTERN, 'code must be 1–64 letters, digits, ".", "-" or "_"')

// ── Supplier contracts ──────────────────────────────────────────────────────

export const zSupplierFields = z.object({
  name: zText(200),
  taxId: zOptionalText(30),
  contactName: zOptionalText(200),
  phone: zOptionalText(50),
  email: z.string().trim().email().max(200).nullable().optional(),
  address: zOptionalText(1000),
  paymentTerms: zOptionalText(200),
  leadTimeDays: z.number().int().nonnegative().max(3650).nullable().optional(),
  notes: zOptionalText(2000),
}).strict()

export const zCreateSupplier = zSupplierFields.extend({ businessId: zId, code: zSupplierCode }).strict()

export const zSupplierAction = z.object({
  action: z.enum(SUPPLIER_ACTIONS),
  version: z.number().int().positive(),
  fields: zSupplierFields.partial().strict().optional(),
  reason: zOptionalText(500),
}).strict().superRefine((value, ctx) => {
  if (value.action === 'UPDATE' && (!value.fields || Object.keys(value.fields).length === 0)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['fields'], message: 'fields is required for UPDATE' })
  }
})

export const zSupplierListQuery = z.object({ businessId: zId, includeArchived: z.boolean().optional() }).strict()

// ── Purchase-order contracts ────────────────────────────────────────────────

export const zPurchaseOrderLine = z.object({
  productId: zId.nullable().optional(),
  description: zText(300).optional(),
  qty: z.number().int().positive(),
  unitCost: zBaht,
}).strict().superRefine((line, ctx) => {
  if (!line.productId && !line.description) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['description'], message: 'a line without a product needs a description' })
  }
})

export const zPurchaseOrderLines = z.array(zPurchaseOrderLine).min(1).max(200)

export const zCreatePurchaseOrder = z.object({
  businessId: zId,
  supplierId: zId,
  currency: z.string().trim().length(3).optional(),
  expectedAt: zDate.nullable().optional(),
  notes: zOptionalText(2000),
  orderedAt: zDate.optional(),
  lines: zPurchaseOrderLines,
}).strict()

export const zPurchaseOrderFields = z.object({
  supplierId: zId,
  expectedAt: zDate.nullable(),
  notes: zOptionalText(2000),
  orderedAt: zDate,
  lines: zPurchaseOrderLines,
}).strict()

export const zPurchaseOrderAction = z.object({
  action: z.enum(PURCHASE_ORDER_ACTIONS),
  version: z.number().int().positive(),
  fields: zPurchaseOrderFields.partial().strict().optional(),
  reason: zOptionalText(500),
}).strict().superRefine((value, ctx) => {
  if (value.action === 'UPDATE' && (!value.fields || Object.keys(value.fields).length === 0)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['fields'], message: 'fields is required for UPDATE' })
  }
})

export const zPurchaseOrderListQuery = z.object({
  businessId: zId,
  status: z.string().trim().min(1).optional(),
  supplierId: zId.optional(),
  includeClosed: z.boolean().optional(),
  limit: z.number().int().positive().max(500).optional(),
}).strict()

// ── Goods-receipt contracts ─────────────────────────────────────────────────

export const zReceiptLine = z.object({
  purchaseOrderLineId: zId,
  qty: z.number().int().positive(),
  lotCode: zInventoryCode.nullable().optional(),
  expiresAt: zDate.nullable().optional(),
  serialNos: z.array(zText(100)).max(500).optional(),
}).strict()

export const zPostReceipt = z.object({
  supplierReference: zOptionalText(100),
  notes: zOptionalText(2000),
  receivedAt: zDate.optional(),
  lines: z.array(zReceiptLine).min(1).max(200),
}).strict().superRefine((value, ctx) => {
  const seen = new Set()
  for (const [index, line] of value.lines.entries()) {
    if (seen.has(line.purchaseOrderLineId)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['lines', index, 'purchaseOrderLineId'], message: 'an order line appears once per receipt' })
    }
    seen.add(line.purchaseOrderLineId)
  }
})

// ── Calculators ─────────────────────────────────────────────────────────────

/** qty × unit cost, in satang. */
export function lineCostSatang(line) {
  return line.qty * line.unitCostSatang
}

/** What one order line has received (from its receipt lines) and what is still outstanding. */
export function lineReceipt(line) {
  const receivedQty = (line.receiptLines || []).reduce((sum, r) => sum + (r.qty || 0), 0)
  return { receivedQty, outstandingQty: Math.max(0, line.qty - receivedQty) }
}

/** NONE / PARTIAL / COMPLETE from the lines' received quantities against the ordered ones. */
export function receiptState(lines = []) {
  if (!lines.length) return 'NONE'
  let received = 0
  let complete = 0
  for (const line of lines) {
    const { receivedQty } = lineReceipt(line)
    if (receivedQty > 0) received += 1
    if (receivedQty >= line.qty) complete += 1
  }
  if (complete === lines.length) return 'COMPLETE'
  return received > 0 ? 'PARTIAL' : 'NONE'
}

/** The order's money from its lines, in satang: ordered, received so far, still outstanding. */
export function purchaseOrderTotals(lines = []) {
  let total = 0
  let receivedValue = 0
  for (const line of lines) {
    total += lineCostSatang(line)
    receivedValue += Math.min(line.qty, lineReceipt(line).receivedQty) * line.unitCostSatang
  }
  return { total, receivedValue, outstandingValue: Math.max(0, total - receivedValue) }
}

/** Whether a purchase order accepts no further work. */
export function isPurchaseOrderClosed(status) {
  return !PURCHASE_ORDER_OPEN_STATUSES.includes(status)
}

/**
 * The status an action leads to from `current`, or null when not allowed.
 * UPDATE keeps DRAFT or SENT (lines and supplier only change while DRAFT —
 * the service enforces that half); SEND needs a draft; CLOSE short-closes a
 * SENT order; CANCEL is refused by the service once anything was received.
 */
export function nextPurchaseOrderStatus(current, action) {
  switch (action) {
    case 'UPDATE':
      return isPurchaseOrderClosed(current) ? null : current
    case 'SEND':
      return current === 'DRAFT' ? 'SENT' : null
    case 'CLOSE':
      return current === 'SENT' ? 'CLOSED' : null
    case 'CANCEL':
      return isPurchaseOrderClosed(current) ? null : 'CANCELLED'
    default:
      return null
  }
}

/**
 * The pure plan of a receipt against an order's lines: every receipt line
 * must name an order line of this order, and may not receive more than that
 * line still has outstanding. Answers whether the receipt completes the order.
 */
export function planReceipt(orderLines = [], receiptLines = []) {
  const byId = new Map(orderLines.map((line) => [line.id, line]))
  const missing = receiptLines.filter((r) => !byId.has(r.purchaseOrderLineId)).map((r) => r.purchaseOrderLineId)
  if (missing.length) return { ok: false, code: 'PROCUREMENT_RECEIPT_LINE_NOT_FOUND', details: missing, completesOrder: false }
  const over = []
  for (const r of receiptLines) {
    const line = byId.get(r.purchaseOrderLineId)
    const { receivedQty, outstandingQty } = lineReceipt(line)
    if (r.qty > outstandingQty) over.push({ purchaseOrderLineId: line.id, description: line.description, ordered: line.qty, received: receivedQty, outstanding: outstandingQty, requested: r.qty })
  }
  if (over.length) return { ok: false, code: 'PROCUREMENT_RECEIPT_EXCEEDS_ORDERED', details: over, completesOrder: false }
  const requested = new Map(receiptLines.map((r) => [r.purchaseOrderLineId, r.qty]))
  const completesOrder = orderLines.every((line) => lineReceipt(line).receivedQty + (requested.get(line.id) || 0) >= line.qty)
  return { ok: true, code: null, details: [], completesOrder }
}

/** The dashboard's numbers over a list of order DTOs (statuses and receipt states already derived). */
export function procurementSummary(orders = []) {
  const open = orders.filter((o) => !isPurchaseOrderClosed(o.status))
  return {
    open: open.length,
    draft: open.filter((o) => o.status === 'DRAFT').length,
    awaitingDelivery: open.filter((o) => o.status === 'SENT' && o.receiptState === 'NONE').length,
    partiallyReceived: open.filter((o) => o.status === 'SENT' && o.receiptState === 'PARTIAL').length,
    outstandingValueSatang: open.filter((o) => o.status === 'SENT').reduce((sum, o) => sum + (o.outstandingValueSatang || 0), 0),
  }
}

// ── Codes and calendar ──────────────────────────────────────────────────────

export function dayKey(date, timeZone = PROCUREMENT_TIME_ZONE) {
  const d = date instanceof Date ? date : new Date(date)
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d)
}

export const purchaseOrderCode = (date, seq, timeZone = PROCUREMENT_TIME_ZONE) => `PO-${dayKey(date, timeZone).replace(/-/g, '')}-${String(seq).padStart(3, '0')}`
export const goodsReceiptCode = (date, seq, timeZone = PROCUREMENT_TIME_ZONE) => `GRN-${dayKey(date, timeZone).replace(/-/g, '')}-${String(seq).padStart(3, '0')}`
/** The reference every ledger row of a receipt carries, so a movement can be traced back to its order and receipt. */
export const receiptReference = (purchaseOrderCodeValue, goodsReceiptCodeValue) => `PO:${purchaseOrderCodeValue}/GRN:${goodsReceiptCodeValue}`
