import { z } from 'zod'
import {
  PAYMENT_ACTIONS,
  PAYMENT_KINDS,
  PAYMENT_METHODS,
  SALES_ORDER_ACTIONS,
  SALES_ORDER_ORIGINS,
} from '@/lib/validation/enums'

// @req FR-166 — the pure vocabulary and calculators of a sales order: money
//   as integer satang (a baht input with at most two decimals is exact), the
//   line and order totals, the status machine (DRAFT → CONFIRMED → COMPLETED,
//   DRAFT | CONFIRMED → CANCELLED), the origin of a sale (CHAT when it came
//   from a Conversation), and the human code `ORD-YYYYMMDD-NNN`.
// @req FR-163 — the payment side: what verified payments and refunds add up
//   to, the payment state an order shows (UNPAID / PARTIAL / PAID / OVERPAID
//   / REFUNDED — derived, never stored), the code `PAY-YYYYMMDD-NNN`, and the
//   revenue summary counted from verified payments only, by origin and by
//   day in the Business's calendar. No I/O here on purpose.
// @spec ADR-065; ADR-054 D3/D4; BR-002
// @tested tests/unit/commerce-domain.test.js

export const SALES_ORDER_ENTITY = 'SALES_ORDER'
export const PAYMENT_ENTITY = 'PAYMENT'
export const COMMERCE_TIME_ZONE = 'Asia/Bangkok'
export const SALES_ORDER_TERMINAL_STATUSES = Object.freeze(['COMPLETED', 'CANCELLED'])
/** The derived payment state of an order — computed on read, never a column. */
export const PAYMENT_STATES = Object.freeze(['UNPAID', 'PARTIAL', 'PAID', 'OVERPAID', 'REFUNDED'])

// ── Money ───────────────────────────────────────────────────────────────────

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
const zBahtPositive = zBaht.refine((v) => v > 0, 'amount must be positive')
const zId = z.string().trim().min(1).max(200)
const zText = (max) => z.string().trim().min(1).max(max)
const zOptionalText = (max) => z.string().trim().max(max).nullable().optional()
const zDate = z.coerce.date()

// ── Contracts ───────────────────────────────────────────────────────────────

export const zOrderLine = z.object({
  productId: zId.nullable().optional(),
  description: zText(300).optional(),
  qty: z.number().int().positive(),
  unitPrice: zBaht,
  discount: zBaht.optional(),
}).strict().superRefine((line, ctx) => {
  if (!line.productId && !line.description) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['description'], message: 'a line without a product needs a description' })
  }
  if ((line.discount ?? 0) > line.qty * line.unitPrice + 1e-9) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['discount'], message: 'a line discount cannot exceed the line amount' })
  }
})

export const zOrderLines = z.array(zOrderLine).min(1).max(200)

export const zCreateOrder = z.object({
  businessId: zId,
  customerId: zId.nullable().optional(),
  conversationId: zId.nullable().optional(),
  origin: z.enum(SALES_ORDER_ORIGINS).optional(),
  currency: z.string().trim().length(3).optional(),
  discount: zBaht.optional(),
  notes: zOptionalText(2000),
  orderedAt: zDate.optional(),
  lines: zOrderLines,
}).strict()

export const zOrderFields = z.object({
  customerId: zId.nullable(),
  discount: zBaht,
  notes: zOptionalText(2000),
  orderedAt: zDate,
  lines: zOrderLines,
}).strict()

export const zOrderAction = z.object({
  action: z.enum(SALES_ORDER_ACTIONS),
  version: z.number().int().positive(),
  fields: zOrderFields.partial().strict().optional(),
  issueStock: z.boolean().optional(),
  reason: zOptionalText(500),
}).strict().superRefine((value, ctx) => {
  if (value.action === 'UPDATE' && (!value.fields || Object.keys(value.fields).length === 0)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['fields'], message: 'fields is required for UPDATE' })
  }
})

export const zRecordPayment = z.object({
  kind: z.enum(PAYMENT_KINDS).optional(),
  method: z.enum(PAYMENT_METHODS),
  amount: zBahtPositive,
  bankReference: z.string().trim().min(1).max(100).nullable().optional(),
  slipFileAssetId: zId.nullable().optional(),
  note: zOptionalText(500),
  paidAt: zDate.optional(),
}).strict()

export const zPaymentActionInput = z.object({
  action: z.enum(PAYMENT_ACTIONS),
  version: z.number().int().positive(),
  reason: zOptionalText(500),
  // @req FR-196 — an explicit, auditable exemption from the self-verify
  // refusal below, for the genuinely one-person Business. Never a silent
  // bypass: when it changes the outcome it lands in the audit payload as
  // `selfVerified: true`.
  selfVerifyAttested: z.boolean().optional(),
}).strict()

export const zOrderListQuery = z.object({
  businessId: zId,
  status: z.string().trim().min(1).optional(),
  origin: z.enum(SALES_ORDER_ORIGINS).optional(),
  customerId: zId.optional(),
  conversationId: zId.optional(),
  includeClosed: z.boolean().optional(),
  limit: z.number().int().positive().max(500).optional(),
}).strict()

// ── Calculators ─────────────────────────────────────────────────────────────

/** qty × unit price − line discount, in satang; never negative. */
export function lineTotalSatang(line) {
  return Math.max(0, line.qty * line.unitPriceSatang - (line.discountSatang || 0))
}

/** The order's money from its lines and its own discount, all in satang. */
export function orderTotals(lines = [], orderDiscountSatang = 0) {
  const subtotal = lines.reduce((sum, l) => sum + l.qty * l.unitPriceSatang, 0)
  const lineDiscount = lines.reduce((sum, l) => sum + (l.discountSatang || 0), 0)
  const orderDiscount = Math.min(Math.max(0, orderDiscountSatang || 0), Math.max(0, subtotal - lineDiscount))
  return { subtotal, lineDiscount, orderDiscount, total: Math.max(0, subtotal - lineDiscount - orderDiscount) }
}

/** What the payments against an order add up to, by status and kind, in satang. */
export function paymentSummary(payments = []) {
  const sum = (kind, status) => payments.filter((p) => p.kind === kind && p.status === status).reduce((s, p) => s + p.amountSatang, 0)
  const paid = sum('PAYMENT', 'VERIFIED')
  const refunded = sum('REFUND', 'VERIFIED')
  return { paid, refunded, net: paid - refunded, pending: sum('PAYMENT', 'PENDING'), pendingRefund: sum('REFUND', 'PENDING') }
}

/** UNPAID / PARTIAL / PAID / OVERPAID / REFUNDED from the order total and the verified net. */
export function paymentState(totalSatang, summary) {
  const net = summary?.net ?? 0
  if (net > totalSatang) return 'OVERPAID'
  if (net === totalSatang) return 'PAID'
  if (net > 0) return 'PARTIAL'
  return (summary?.refunded ?? 0) > 0 ? 'REFUNDED' : 'UNPAID'
}

/** Whether a sales order accepts no further work. */
export function isOrderClosed(status) {
  return SALES_ORDER_TERMINAL_STATUSES.includes(status)
}

/**
 * The status an action leads to from `current`, or null when not allowed.
 * UPDATE keeps DRAFT or CONFIRMED (lines only change while DRAFT — the
 * service enforces that half); COMPLETE needs a confirmed order.
 */
export function nextOrderStatus(current, action) {
  switch (action) {
    case 'UPDATE':
      return isOrderClosed(current) ? null : current
    case 'CONFIRM':
      return current === 'DRAFT' ? 'CONFIRMED' : null
    case 'COMPLETE':
      return current === 'CONFIRMED' ? 'COMPLETED' : null
    case 'CANCEL':
      return isOrderClosed(current) ? null : 'CANCELLED'
    default:
      return null
  }
}

/** A payment's next status, or null: only a PENDING payment can be verified or rejected. */
export function nextPaymentStatus(current, action) {
  if (current !== 'PENDING') return null
  if (action === 'VERIFY') return 'VERIFIED'
  if (action === 'REJECT') return 'REJECTED'
  return null
}

/** The origin a new order gets: a Conversation makes it CHAT (the legacy "ads revenue"), else what was said, else WALK_IN. */
export function resolveOrigin({ conversationId, origin }) {
  if (conversationId) return 'CHAT'
  return origin ?? 'WALK_IN'
}

// ── Codes and calendar ──────────────────────────────────────────────────────

export function dayKey(date, timeZone = COMMERCE_TIME_ZONE) {
  const d = date instanceof Date ? date : new Date(date)
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d)
}

export const orderCode = (date, seq, timeZone = COMMERCE_TIME_ZONE) => `ORD-${dayKey(date, timeZone).replace(/-/g, '')}-${String(seq).padStart(3, '0')}`
export const paymentCode = (date, seq, timeZone = COMMERCE_TIME_ZONE) => `PAY-${dayKey(date, timeZone).replace(/-/g, '')}-${String(seq).padStart(3, '0')}`

// ── Revenue ─────────────────────────────────────────────────────────────────

/**
 * Revenue is counted from VERIFIED payments only, net of verified refunds
 * (the legacy rule "ROAS from VERIFIED"), on the day the money was paid, in
 * the Business's calendar; attributed to the order's origin. Pending money
 * is reported beside it, never inside it.
 */
export function revenueSummary(orders = [], { from = null, to = null, timeZone = COMMERCE_TIME_ZONE } = {}) {
  const inRange = (d) => (!from || d >= from) && (!to || d <= to)
  const byOrigin = {}
  for (const origin of SALES_ORDER_ORIGINS) byOrigin[origin] = 0
  const byDay = new Map()
  let verifiedNet = 0
  let pendingAmount = 0
  let pendingCount = 0
  let refunded = 0
  for (const order of orders) {
    for (const p of order.payments || []) {
      const day = dayKey(p.paidAt || p.createdAt, timeZone)
      if (!inRange(day)) continue
      if (p.status === 'PENDING') {
        if (p.kind === 'PAYMENT') { pendingAmount += p.amountSatang; pendingCount += 1 }
        continue
      }
      if (p.status !== 'VERIFIED') continue
      const signed = p.kind === 'REFUND' ? -p.amountSatang : p.amountSatang
      if (p.kind === 'REFUND') refunded += p.amountSatang
      verifiedNet += signed
      byOrigin[order.origin] = (byOrigin[order.origin] || 0) + signed
      byDay.set(day, (byDay.get(day) || 0) + signed)
    }
  }
  return {
    verifiedNet,
    refunded,
    byOrigin,
    byDay: [...byDay.entries()].sort(([a], [b]) => (a < b ? -1 : 1)).map(([day, net]) => ({ day, net })),
    pending: { count: pendingCount, amount: pendingAmount },
  }
}
