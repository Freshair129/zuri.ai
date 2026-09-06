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
  allocateFefo,
  bundleAvailability,
  explodeRecipe,
  isBelowSafetyStock,
  maxBuildableQuantity,
  movementDelta,
  movementRule,
  pickRecipeForQuantity,
  recipeRequirements,
  serialStatusAfter,
  stockOnHand,
  stockSummaryRow,
  zCreateBundle,
  zCreateProduct,
  zCreateRecipe,
  zProductAction,
  zRecipeAction,
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

  it('FEFO takes from the earliest-expiring open lot first, unknown expiry last, and reports what no lot covers', () => {
    const lots = [
      { id: 'undated', status: 'OPEN', onHand: 10, expiresAt: null, createdAt: '2026-01-01' },
      { id: 'late', status: 'OPEN', onHand: 5, expiresAt: '2027-01-01', createdAt: '2026-02-01' },
      { id: 'soon', status: 'OPEN', onHand: 3, expiresAt: '2026-12-01', createdAt: '2026-03-01' },
      { id: 'closed', status: 'CLOSED', onHand: 50, expiresAt: '2026-11-01', createdAt: '2026-03-01' },
    ]
    expect(allocateFefo(lots, 7)).toEqual({ allocations: [{ lotId: 'soon', qty: 3 }, { lotId: 'late', qty: 4 }], remainder: 0 })
    expect(allocateFefo(lots, 20)).toEqual({ allocations: [{ lotId: 'soon', qty: 3 }, { lotId: 'late', qty: 5 }, { lotId: 'undated', qty: 10 }], remainder: 2 })
    expect(allocateFefo([], 1)).toEqual({ allocations: [], remainder: 1 })
  })
})

describe('FR-156 recipe / bill of materials calculators', () => {
  const recipe = (over = {}) => ({ id: 'r10', productId: 'box', batchSize: 10, yieldQty: 10, status: 'ACTIVE', lines: [
    { componentProductId: 'ribbon', qty: 5, fixed: false },
    { componentProductId: 'crate', qty: 1, fixed: true },
    { componentProductId: 'card', qty: 10, fixed: false },
  ], ...over })

  it('the contracts: a recipe needs a positive batch size and at least one distinct component; UPDATE needs fields', () => {
    const base = { businessId: 'b', code: 'RCP-1', productId: 'box', name: 'Box', batchSize: 10, lines: [{ componentProductId: 'ribbon', qty: 5 }] }
    expect(zCreateRecipe.parse(base).batchSize).toBe(10)
    expect(() => zCreateRecipe.parse({ ...base, batchSize: 0 })).toThrow()
    expect(() => zCreateRecipe.parse({ ...base, lines: [] })).toThrow()
    expect(() => zCreateRecipe.parse({ ...base, lines: [{ componentProductId: 'a', qty: 1 }, { componentProductId: 'a', qty: 2 }] })).toThrow(/once/)
    expect(() => zCreateRecipe.parse({ ...base, lines: [{ componentProductId: 'a', qty: -1 }] })).toThrow()
    expect(() => zRecipeAction.parse({ action: 'UPDATE', version: 1 })).toThrow(/fields/)
    expect(zRecipeAction.parse({ action: 'ARCHIVE', version: 2 }).version).toBe(2)
  })

  it('picks the largest batch size that fits, else the smallest, never an archived one', () => {
    const r10 = recipe(), r50 = recipe({ id: 'r50', batchSize: 50 }), r100 = recipe({ id: 'r100', batchSize: 100, status: 'ARCHIVED' })
    expect(pickRecipeForQuantity([r10, r50, r100], 60).id).toBe('r50')
    expect(pickRecipeForQuantity([r10, r50, r100], 500).id).toBe('r50')
    expect(pickRecipeForQuantity([r10, r50], 25).id).toBe('r10')
    expect(pickRecipeForQuantity([r50], 3).id).toBe('r50')
    expect(pickRecipeForQuantity([r100], 3)).toBeNull()
    expect(pickRecipeForQuantity([], 3)).toBeNull()
  })

  it('explodes to a quantity: scaled lines multiply, a fixed line does not, and the output yield follows the batch', () => {
    const exploded = explodeRecipe(recipe({ yieldQty: 12 }), 25)
    expect(exploded).toMatchObject({ quantity: 25, factor: 2.5, producedQty: 30 })
    expect(exploded.lines.map((l) => [l.componentProductId, l.required])).toEqual([['ribbon', 12.5], ['crate', 1], ['card', 25]])
  })

  it('requirements compare with on-hand: whole units are issued, uncounted components never block', () => {
    const req = recipeRequirements(explodeRecipe(recipe(), 25), { ribbon: 12, crate: 1, card: null })
    expect(req.lines.map((l) => [l.componentProductId, l.issueQty, l.onHand, l.shortage])).toEqual([['ribbon', 13, 12, 1], ['crate', 1, 1, 0], ['card', 25, null, 0]])
    expect(req.canBuild).toBe(false)
    expect(recipeRequirements(explodeRecipe(recipe(), 25), { ribbon: 13, crate: 1, card: null }).canBuild).toBe(true)
  })

  it('the maximum buildable quantity is the tightest scaled line, a fixed line allows the batch or nothing, uncounted lines never limit', () => {
    expect(maxBuildableQuantity(recipe(), { ribbon: 20, crate: 1, card: null })).toBe(40)
    expect(maxBuildableQuantity(recipe(), { ribbon: 20, crate: 0, card: null })).toBe(0)
    expect(maxBuildableQuantity(recipe(), { ribbon: 3, crate: 1, card: null })).toBe(6)
    expect(maxBuildableQuantity(recipe({ lines: [{ componentProductId: 'card', qty: 1 }] }), { card: null })).toBeNull()
    expect(maxBuildableQuantity(recipe({ lines: [{ componentProductId: 'crate', qty: 1, fixed: true }] }), { crate: 3 })).toBeNull()
  })
})
