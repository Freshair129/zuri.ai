// @req FR-164 — the pure rules of the buy side: exact money in satang, the
//   supplier and purchase-order contracts, the order's totals, the status
//   machine and the codes.
// @req FR-165 — the receipt side: what each line has received and what is
//   outstanding, the derived receipt state, the pure plan of a receipt against
//   an order (unknown line, over-receipt, completion) and the ledger reference.
// @spec ADR-066; BR-002
// @tested tests/unit/procurement-domain.test.js
import { describe, expect, it } from 'vitest'
import {
  dayKey,
  fromSatang,
  goodsReceiptCode,
  lineCostSatang,
  lineReceipt,
  nextPurchaseOrderStatus,
  planReceipt,
  procurementSummary,
  purchaseOrderCode,
  purchaseOrderTotals,
  receiptReference,
  receiptState,
  toSatang,
  zCreatePurchaseOrder,
  zCreateSupplier,
  zPostReceipt,
  zPurchaseOrderAction,
  zPurchaseOrderLine,
  zSupplierAction,
} from '@/modules/procurement/domain/procurement'

describe('FR-164 supplier and purchase-order contracts', () => {
  it('money is exact in satang, the same rule Commerce follows', () => {
    expect(toSatang(1490)).toBe(149000)
    expect(toSatang(0.1 + 0.2)).toBe(30)
    expect(fromSatang(1999)).toBe(19.99)
    expect(() => toSatang(Number.NaN)).toThrow()
  })

  it('a supplier needs a well-formed code and a name; contact and terms are plain attributes', () => {
    expect(zCreateSupplier.parse({ businessId: 'b', code: 'SUP-001', name: 'บริษัท กล่อง จำกัด', leadTimeDays: 7 }).leadTimeDays).toBe(7)
    expect(() => zCreateSupplier.parse({ businessId: 'b', code: 'SUP 001', name: 'x' })).toThrow(/code/)
    expect(() => zCreateSupplier.parse({ businessId: 'b', code: 'SUP-1', name: 'x', email: 'not-an-email' })).toThrow()
    expect(() => zSupplierAction.parse({ action: 'UPDATE', version: 1 })).toThrow(/fields/)
    expect(zSupplierAction.parse({ action: 'ARCHIVE', version: 3 }).version).toBe(3)
  })

  it('a line needs a product or a description, a positive quantity and a two-decimal unit cost', () => {
    expect(zPurchaseOrderLine.parse({ description: 'กล่อง', qty: 10, unitCost: 12.5 }).qty).toBe(10)
    expect(zPurchaseOrderLine.parse({ productId: 'p', qty: 1, unitCost: 0 }).unitCost).toBe(0)
    expect(() => zPurchaseOrderLine.parse({ qty: 1, unitCost: 1 })).toThrow(/description/)
    expect(() => zPurchaseOrderLine.parse({ description: 'x', qty: 0, unitCost: 1 })).toThrow()
    expect(() => zPurchaseOrderLine.parse({ description: 'x', qty: 1, unitCost: 1.005 })).toThrow(/two decimals/)
    expect(() => zCreatePurchaseOrder.parse({ businessId: 'b', supplierId: 's', lines: [] })).toThrow()
    expect(() => zPurchaseOrderAction.parse({ action: 'UPDATE', version: 1 })).toThrow(/fields/)
    expect(zPurchaseOrderAction.parse({ action: 'CLOSE', version: 2, reason: 'ผู้ขายส่งไม่ครบ' }).reason).toBe('ผู้ขายส่งไม่ครบ')
  })

  it('totals: line cost, ordered total, received and outstanding value from the receipt lines', () => {
    const lines = [
      { qty: 10, unitCostSatang: 2000, receiptLines: [{ qty: 3 }, { qty: 2 }] },
      { qty: 1, unitCostSatang: 10000, receiptLines: [] },
    ]
    expect(lineCostSatang(lines[0])).toBe(20000)
    expect(purchaseOrderTotals(lines)).toEqual({ total: 30000, receivedValue: 10000, outstandingValue: 20000 })
    expect(purchaseOrderTotals([])).toEqual({ total: 0, receivedValue: 0, outstandingValue: 0 })
  })

  it('the status machine: DRAFT → SENT → RECEIVED by receipt; SENT → SHORT_CLOSED; open → CANCELLED; nothing from a closed one', () => {
    expect(nextPurchaseOrderStatus('DRAFT', 'SEND')).toBe('SENT')
    expect(nextPurchaseOrderStatus('SENT', 'SEND')).toBeNull()
    expect(nextPurchaseOrderStatus('DRAFT', 'CLOSE')).toBeNull()
    expect(nextPurchaseOrderStatus('SENT', 'CLOSE')).toBe('SHORT_CLOSED')
    expect(nextPurchaseOrderStatus('DRAFT', 'CANCEL')).toBe('CANCELLED')
    expect(nextPurchaseOrderStatus('SENT', 'CANCEL')).toBe('CANCELLED')
    expect(nextPurchaseOrderStatus('RECEIVED', 'CANCEL')).toBeNull()
    expect(nextPurchaseOrderStatus('SENT', 'UPDATE')).toBe('SENT')
    expect(nextPurchaseOrderStatus('SHORT_CLOSED', 'UPDATE')).toBeNull()
    expect(nextPurchaseOrderStatus('SENT', 'RECEIVE')).toBeNull()
  })

  it('codes follow the Business calendar', () => {
    const at = new Date('2026-09-06T17:30:00Z') // 00:30 on the 7th in Bangkok
    expect(dayKey(at)).toBe('2026-09-07')
    expect(purchaseOrderCode(at, 3)).toBe('PO-20260907-003')
    expect(goodsReceiptCode(at, 12)).toBe('GRN-20260907-012')
    expect(receiptReference('PO-20260907-003', 'GRN-20260907-012')).toBe('PO:PO-20260907-003/GRN:GRN-20260907-012')
  })
})

describe('FR-165 receipt state and the receipt plan', () => {
  const lines = [
    { id: 'a', description: 'กล่อง', qty: 10, unitCostSatang: 2000, receiptLines: [{ qty: 4 }] },
    { id: 'b', description: 'ค่าขนส่ง', qty: 1, unitCostSatang: 10000, receiptLines: [] },
  ]

  it('what a line received and what is outstanding come from its receipt lines', () => {
    expect(lineReceipt(lines[0])).toEqual({ receivedQty: 4, outstandingQty: 6 })
    expect(lineReceipt(lines[1])).toEqual({ receivedQty: 0, outstandingQty: 1 })
    expect(lineReceipt({ qty: 2, receiptLines: [{ qty: 3 }] })).toEqual({ receivedQty: 3, outstandingQty: 0 })
  })

  it('the receipt state is NONE, PARTIAL or COMPLETE — derived, never stored', () => {
    expect(receiptState([])).toBe('NONE')
    expect(receiptState([{ qty: 1, receiptLines: [] }])).toBe('NONE')
    expect(receiptState(lines)).toBe('PARTIAL')
    expect(receiptState([{ qty: 2, receiptLines: [{ qty: 2 }] }, { qty: 1, receiptLines: [] }])).toBe('PARTIAL')
    expect(receiptState([{ qty: 2, receiptLines: [{ qty: 1 }, { qty: 1 }] }, { qty: 1, receiptLines: [{ qty: 1 }] }])).toBe('COMPLETE')
  })

  it('a receipt names order lines, never exceeds what is outstanding, and says when it completes the order', () => {
    expect(planReceipt(lines, [{ purchaseOrderLineId: 'zzz', qty: 1 }])).toMatchObject({ ok: false, code: 'PROCUREMENT_RECEIPT_LINE_NOT_FOUND', details: ['zzz'] })
    const over = planReceipt(lines, [{ purchaseOrderLineId: 'a', qty: 7 }])
    expect(over).toMatchObject({ ok: false, code: 'PROCUREMENT_RECEIPT_EXCEEDS_ORDERED' })
    expect(over.details).toEqual([{ purchaseOrderLineId: 'a', description: 'กล่อง', ordered: 10, received: 4, outstanding: 6, requested: 7 }])
    expect(planReceipt(lines, [{ purchaseOrderLineId: 'a', qty: 6 }])).toMatchObject({ ok: true, completesOrder: false })
    expect(planReceipt(lines, [{ purchaseOrderLineId: 'a', qty: 6 }, { purchaseOrderLineId: 'b', qty: 1 }])).toMatchObject({ ok: true, completesOrder: true })
    expect(() => zPostReceipt.parse({ lines: [{ purchaseOrderLineId: 'a', qty: 1 }, { purchaseOrderLineId: 'a', qty: 1 }] })).toThrow(/once per receipt/)
    expect(() => zPostReceipt.parse({ lines: [{ purchaseOrderLineId: 'a', qty: 1, lotCode: 'bad lot' }] })).toThrow(/code/)
    expect(zPostReceipt.parse({ lines: [{ purchaseOrderLineId: 'a', qty: 2, serialNos: ['S1', 'S2'] }] }).lines[0].serialNos).toEqual(['S1', 'S2'])
  })

  it('the dashboard summary counts open orders by what they wait for', () => {
    const orders = [
      { status: 'DRAFT', receiptState: 'NONE', outstandingValueSatang: 100 },
      { status: 'SENT', receiptState: 'NONE', outstandingValueSatang: 20000 },
      { status: 'SENT', receiptState: 'PARTIAL', outstandingValueSatang: 5000 },
      { status: 'RECEIVED', receiptState: 'COMPLETE', outstandingValueSatang: 0 },
      { status: 'CANCELLED', receiptState: 'NONE', outstandingValueSatang: 999 },
    ]
    expect(procurementSummary(orders)).toEqual({ open: 3, draft: 1, awaitingDelivery: 1, partiallyReceived: 1, outstandingValueSatang: 25000 })
  })
})
