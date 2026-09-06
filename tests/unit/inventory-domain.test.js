// @req FR-154 — the catalogue contracts: the code shape, an UNTRACKED product
//   has no tracking mode, a bundle names each product once, a versioned action
//   must carry what it needs.
// @req FR-155 — the ledger calculators: signed deltas, on-hand as a sum,
//   safety-stock comparison (never for an uncounted product), bundle
//   availability from on-hand, and the refusal rules by code.
// @spec BR-002
// @tested tests/unit/inventory-domain.test.js
import { describe, expect, it } from 'vitest'
import {
  bundleAvailability,
  isBelowSafetyStock,
  movementDelta,
  movementRule,
  serialStatusAfter,
  stockOnHand,
  stockSummaryRow,
  zCreateBundle,
  zCreateProduct,
  zProductAction,
  zRecordMovement,
} from '@/modules/inventory/domain/inventory'

const base = { businessId: 'b-1', code: 'SKU-1', productMasterId: 'pm-1' }

describe('FR-154 inventory catalogue contracts', () => {
  it('accepts a human code and refuses one that is not a code', () => {
    expect(zCreateProduct.parse({ ...base, code: 'gift.box_2026-A' }).code).toBe('gift.box_2026-A')
    expect(() => zCreateProduct.parse({ ...base, code: 'has space' })).toThrow()
    expect(() => zCreateProduct.parse({ ...base, code: '' })).toThrow()
    expect(() => zCreateProduct.parse({ ...base, extra: 1 })).toThrow()
  })

  it('an UNTRACKED product cannot carry a tracking mode; a TRACKED one defaults to none', () => {
    expect(() => zCreateProduct.parse({ ...base, stockPolicy: 'UNTRACKED', trackingMode: 'LOT' })).toThrow(/tracking mode/)
    expect(zCreateProduct.parse({ ...base, stockPolicy: 'UNTRACKED' }).stockPolicy).toBe('UNTRACKED')
    expect(zCreateProduct.parse({ ...base, stockPolicy: 'TRACKED', trackingMode: 'SERIAL' }).trackingMode).toBe('SERIAL')
  })

  it('a bundle needs at least one item and names a product once', () => {
    expect(() => zCreateBundle.parse({ businessId: 'b-1', code: 'B1', name: 'Box', items: [] })).toThrow()
    expect(() => zCreateBundle.parse({ businessId: 'b-1', code: 'B1', name: 'Box', items: [{ productId: 'p', qty: 1 }, { productId: 'p', qty: 2 }] })).toThrow(/once/)
    expect(zCreateBundle.parse({ businessId: 'b-1', code: 'B1', name: 'Box', items: [{ productId: 'p', qty: 2 }] }).items).toHaveLength(1)
  })

  it('UPDATE needs fields; ARCHIVE needs only a version', () => {
    expect(() => zProductAction.parse({ action: 'UPDATE', version: 1 })).toThrow(/fields/)
    expect(zProductAction.parse({ action: 'UPDATE', version: 1, fields: { safetyStock: 5 } }).fields.safetyStock).toBe(5)
    expect(zProductAction.parse({ action: 'ARCHIVE', version: 3 }).version).toBe(3)
    expect(() => zProductAction.parse({ action: 'DELETE', version: 1 })).toThrow()
  })
})

describe('FR-155 stock ledger calculators', () => {
  it('a RECEIPT adds, an ISSUE removes, an ADJUSTMENT keeps its sign, anything else contributes nothing', () => {
    expect(movementDelta('RECEIPT', 5)).toBe(5)
    expect(movementDelta('ISSUE', 5)).toBe(-5)
    expect(movementDelta('ADJUSTMENT', -3)).toBe(-3)
    expect(movementDelta('ADJUSTMENT', 4)).toBe(4)
    expect(movementDelta('TRANSFER', 4)).toBe(0)
  })

  it('on-hand is the sum of the ledger', () => {
    expect(stockOnHand([])).toBe(0)
    expect(stockOnHand([{ quantity: 10 }, { quantity: -3 }, { quantity: -2 }])).toBe(5)
  })

  it('only a counted product can be below safety stock, and the summary row never prints a zero for an uncounted one', () => {
    const tracked = { id: 'p1', code: 'A', stockPolicy: 'TRACKED', trackingMode: 'NONE', unit: 'EA', safetyStock: 10 }
    const untracked = { ...tracked, id: 'p2', code: 'B', stockPolicy: 'UNTRACKED' }
    expect(isBelowSafetyStock(tracked, 9)).toBe(true)
    expect(isBelowSafetyStock(tracked, 10)).toBe(false)
    expect(isBelowSafetyStock(untracked, 0)).toBe(false)
    expect(stockSummaryRow(tracked, [{ quantity: 4 }])).toMatchObject({ onHand: 4, belowSafetyStock: true })
    expect(stockSummaryRow(untracked, [])).toMatchObject({ onHand: null, belowSafetyStock: false })
  })

  it('bundle availability is the tightest counted item; uncounted items never limit', () => {
    const items = [{ productId: 'a', qty: 2 }, { productId: 'b', qty: 1 }, { productId: 'svc', qty: 1 }]
    expect(bundleAvailability(items, { a: 10, b: 3, svc: null })).toBe(3)
    expect(bundleAvailability(items, { a: 1, b: 3, svc: null })).toBe(0)
    expect(bundleAvailability([{ productId: 'svc', qty: 1 }], { svc: null })).toBeNull()
  })

  it('the movement contract refuses a zero adjustment, a non-positive receipt, and lotId with lotCode', () => {
    const m = { businessId: 'b', productId: 'p' }
    expect(() => zRecordMovement.parse({ ...m, kind: 'ADJUSTMENT', quantity: 0 })).toThrow(/zero/)
    expect(() => zRecordMovement.parse({ ...m, kind: 'RECEIPT', quantity: -1 })).toThrow(/positive/)
    expect(() => zRecordMovement.parse({ ...m, kind: 'RECEIPT', quantity: 1, lotId: 'l', lotCode: 'L' })).toThrow(/not both/)
    expect(zRecordMovement.parse({ ...m, kind: 'ISSUE', quantity: 2, serialNos: ['S1', 'S2'] }).serialNos).toHaveLength(2)
  })

  it('the refusal rules answer by code', () => {
    const tracked = { status: 'ACTIVE', stockPolicy: 'TRACKED', trackingMode: 'NONE' }
    expect(movementRule(null, {}).code).toBe('INVENTORY_PRODUCT_NOT_FOUND')
    expect(movementRule({ ...tracked, status: 'ARCHIVED' }, { kind: 'RECEIPT', quantity: 1 }).code).toBe('INVENTORY_PRODUCT_ARCHIVED')
    expect(movementRule({ ...tracked, stockPolicy: 'UNTRACKED' }, { kind: 'RECEIPT', quantity: 1 }).code).toBe('INVENTORY_PRODUCT_UNTRACKED')
    expect(movementRule(tracked, { kind: 'RECEIPT', quantity: 1, serialNos: ['S'] }).code).toBe('INVENTORY_SERIAL_NOT_TRACKED')
    expect(movementRule(tracked, { kind: 'RECEIPT', quantity: 1, lotCode: 'L' }).code).toBe('INVENTORY_LOT_NOT_TRACKED')
    expect(movementRule(tracked, { kind: 'RECEIPT', quantity: 1 })).toEqual({ ok: true, code: null })

    const lot = { ...tracked, trackingMode: 'LOT' }
    expect(movementRule(lot, { kind: 'RECEIPT', quantity: 1 }).code).toBe('INVENTORY_LOT_REQUIRED')
    expect(movementRule(lot, { kind: 'ISSUE', quantity: 1 }).ok).toBe(true)
    expect(movementRule(lot, { kind: 'RECEIPT', quantity: 1, lotCode: 'L' }).ok).toBe(true)

    const serial = { ...tracked, trackingMode: 'SERIAL' }
    expect(movementRule(serial, { kind: 'ADJUSTMENT', quantity: 1 }).code).toBe('INVENTORY_SERIAL_ADJUSTMENT_NOT_ALLOWED')
    expect(movementRule(serial, { kind: 'RECEIPT', quantity: 2, serialNos: ['S1'] }).code).toBe('INVENTORY_SERIAL_COUNT_MISMATCH')
    expect(movementRule(serial, { kind: 'RECEIPT', quantity: 2, serialNos: ['S1', 'S1'] }).code).toBe('INVENTORY_SERIAL_DUPLICATE')
    expect(movementRule(serial, { kind: 'ISSUE', quantity: 1, serialNos: ['S1'] }).ok).toBe(true)
  })

  it('a receipt leaves a serial IN_STOCK, an issue leaves it ISSUED, an adjustment touches none', () => {
    expect(serialStatusAfter('RECEIPT')).toBe('IN_STOCK')
    expect(serialStatusAfter('ISSUE')).toBe('ISSUED')
    expect(serialStatusAfter('ADJUSTMENT')).toBeNull()
  })
})
