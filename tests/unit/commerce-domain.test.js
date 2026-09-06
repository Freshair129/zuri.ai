// @req FR-158 — the pure rules of a sales order: exact money in satang, the
//   line contract, totals, the status machine, the origin of a sale, the code.
// @req FR-159 — the payment side: what verified money adds up to, the derived
//   payment state, the payment status machine, and revenue counted from
//   verified payments only by origin and day.
// @spec ADR-065; BR-002
// @tested tests/unit/commerce-domain.test.js
import { describe, expect, it } from 'vitest'
import {
  dayKey,
  fromSatang,
  lineTotalSatang,
  nextOrderStatus,
  nextPaymentStatus,
  orderCode,
  orderTotals,
  paymentCode,
  paymentState,
  paymentSummary,
  resolveOrigin,
  revenueSummary,
  toSatang,
  zCreateOrder,
  zOrderAction,
  zOrderLine,
  zRecordPayment,
} from '@/modules/commerce/domain/commerce'

describe('FR-158 money and order contracts', () => {
  it('baht with two decimals round-trips through integer satang exactly', () => {
    expect(toSatang(1490)).toBe(149000)
    expect(toSatang(0.1 + 0.2)).toBe(30)
    expect(toSatang(19.99)).toBe(1999)
    expect(fromSatang(1999)).toBe(19.99)
    expect(() => toSatang(Number.NaN)).toThrow()
  })

  it('a line needs a product or a description, a non-negative price with two decimals, and a discount within the line', () => {
    expect(zOrderLine.parse({ description: 'กล่องของขวัญ', qty: 2, unitPrice: 745 }).qty).toBe(2)
    expect(zOrderLine.parse({ productId: 'p', qty: 1, unitPrice: 0 }).unitPrice).toBe(0)
    expect(() => zOrderLine.parse({ qty: 1, unitPrice: 10 })).toThrow(/description/)
    expect(() => zOrderLine.parse({ description: 'x', qty: 0, unitPrice: 10 })).toThrow()
    expect(() => zOrderLine.parse({ description: 'x', qty: 1, unitPrice: 10.005 })).toThrow(/two decimals/)
    expect(() => zOrderLine.parse({ description: 'x', qty: 1, unitPrice: 10, discount: 11 })).toThrow(/exceed/)
    expect(() => zCreateOrder.parse({ businessId: 'b', lines: [] })).toThrow()
    expect(() => zOrderAction.parse({ action: 'UPDATE', version: 1 })).toThrow(/fields/)
    expect(zOrderAction.parse({ action: 'COMPLETE', version: 2, issueStock: true }).issueStock).toBe(true)
    expect(() => zRecordPayment.parse({ method: 'TRANSFER', amount: 0 })).toThrow(/positive/)
    expect(zRecordPayment.parse({ method: 'QR', amount: 250.5 }).kind).toBeUndefined()
  })

  it('totals: line total, subtotal, line and order discounts, never negative', () => {
    const lines = [
      { qty: 2, unitPriceSatang: 74500, discountSatang: 4500 },
      { qty: 1, unitPriceSatang: 100000, discountSatang: 0 },
    ]
    expect(lineTotalSatang(lines[0])).toBe(144500)
    expect(orderTotals(lines, 20000)).toEqual({ subtotal: 249000, lineDiscount: 4500, orderDiscount: 20000, total: 224500 })
    expect(orderTotals(lines, 999999)).toEqual({ subtotal: 249000, lineDiscount: 4500, orderDiscount: 244500, total: 0 })
    expect(orderTotals([], 0)).toEqual({ subtotal: 0, lineDiscount: 0, orderDiscount: 0, total: 0 })
  })

  it('the status machine: DRAFT → CONFIRMED → COMPLETED, cancel from either open state, nothing from a closed one', () => {
    expect(nextOrderStatus('DRAFT', 'CONFIRM')).toBe('CONFIRMED')
    expect(nextOrderStatus('DRAFT', 'COMPLETE')).toBeNull()
    expect(nextOrderStatus('CONFIRMED', 'COMPLETE')).toBe('COMPLETED')
    expect(nextOrderStatus('CONFIRMED', 'CONFIRM')).toBeNull()
    expect(nextOrderStatus('DRAFT', 'CANCEL')).toBe('CANCELLED')
    expect(nextOrderStatus('CONFIRMED', 'CANCEL')).toBe('CANCELLED')
    expect(nextOrderStatus('COMPLETED', 'CANCEL')).toBeNull()
    expect(nextOrderStatus('CONFIRMED', 'UPDATE')).toBe('CONFIRMED')
    expect(nextOrderStatus('CANCELLED', 'UPDATE')).toBeNull()
  })

  it('a sale from a Conversation is CHAT whatever was said; otherwise the stated origin, else WALK_IN', () => {
    expect(resolveOrigin({ conversationId: 'c', origin: 'ONLINE' })).toBe('CHAT')
    expect(resolveOrigin({ conversationId: null, origin: 'ONLINE' })).toBe('ONLINE')
    expect(resolveOrigin({})).toBe('WALK_IN')
  })

  it('codes follow the Business calendar', () => {
    const at = new Date('2026-09-06T17:30:00Z') // 00:30 on the 7th in Bangkok
    expect(dayKey(at)).toBe('2026-09-07')
    expect(orderCode(at, 3)).toBe('ORD-20260907-003')
    expect(paymentCode(at, 12)).toBe('PAY-20260907-012')
  })
})

describe('FR-159 payments and revenue', () => {
  const payments = [
    { kind: 'PAYMENT', status: 'VERIFIED', amountSatang: 100000 },
    { kind: 'PAYMENT', status: 'PENDING', amountSatang: 50000 },
    { kind: 'PAYMENT', status: 'REJECTED', amountSatang: 99999 },
    { kind: 'REFUND', status: 'VERIFIED', amountSatang: 20000 },
    { kind: 'REFUND', status: 'PENDING', amountSatang: 5000 },
  ]

  it('only VERIFIED money counts; pending and rejected are reported apart', () => {
    expect(paymentSummary(payments)).toEqual({ paid: 100000, refunded: 20000, net: 80000, pending: 50000, pendingRefund: 5000 })
    expect(paymentSummary([])).toEqual({ paid: 0, refunded: 0, net: 0, pending: 0, pendingRefund: 0 })
  })

  it('the payment state is derived from total and verified net', () => {
    expect(paymentState(100000, paymentSummary([]))).toBe('UNPAID')
    expect(paymentState(100000, { net: 40000, refunded: 0 })).toBe('PARTIAL')
    expect(paymentState(100000, { net: 100000, refunded: 0 })).toBe('PAID')
    expect(paymentState(100000, { net: 120000, refunded: 0 })).toBe('OVERPAID')
    expect(paymentState(100000, { net: 0, refunded: 100000 })).toBe('REFUNDED')
    expect(paymentState(0, { net: 0, refunded: 0 })).toBe('PAID')
  })

  it('only a PENDING payment can be verified or rejected', () => {
    expect(nextPaymentStatus('PENDING', 'VERIFY')).toBe('VERIFIED')
    expect(nextPaymentStatus('PENDING', 'REJECT')).toBe('REJECTED')
    expect(nextPaymentStatus('VERIFIED', 'REJECT')).toBeNull()
    expect(nextPaymentStatus('REJECTED', 'VERIFY')).toBeNull()
  })

  it('revenue is verified net by origin and by Bangkok day, with pending beside it', () => {
    const orders = [
      { origin: 'CHAT', payments: [{ kind: 'PAYMENT', status: 'VERIFIED', amountSatang: 100000, paidAt: '2026-09-06T03:00:00Z' }, { kind: 'REFUND', status: 'VERIFIED', amountSatang: 10000, paidAt: '2026-09-06T04:00:00Z' }] },
      { origin: 'WALK_IN', payments: [{ kind: 'PAYMENT', status: 'VERIFIED', amountSatang: 50000, paidAt: '2026-09-06T17:30:00Z' }, { kind: 'PAYMENT', status: 'PENDING', amountSatang: 7000, paidAt: '2026-09-07T01:00:00Z' }] },
      { origin: 'ONLINE', payments: [{ kind: 'PAYMENT', status: 'REJECTED', amountSatang: 999, paidAt: '2026-09-06T05:00:00Z' }] },
    ]
    const all = revenueSummary(orders)
    expect(all.verifiedNet).toBe(140000)
    expect(all.refunded).toBe(10000)
    expect(all.byOrigin).toEqual({ CHAT: 90000, WALK_IN: 50000, ONLINE: 0 })
    expect(all.byDay).toEqual([{ day: '2026-09-06', net: 90000 }, { day: '2026-09-07', net: 50000 }])
    expect(all.pending).toEqual({ count: 1, amount: 7000 })
    expect(revenueSummary(orders, { from: '2026-09-07', to: '2026-09-07' }).verifiedNet).toBe(50000)
    expect(revenueSummary(orders, { from: '2026-09-08' }).byDay).toEqual([])
  })
})
