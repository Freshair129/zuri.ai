// @req FR-175 — landed cost in integer satang: shared batch costs amortised and
//   rounded up, the flat single-drop truck absorbed into the unit, moving
//   weighted average across receipts, and the blended cost of an assembled set.
// @req FR-177 — the FlowAccount finished-set SKU pattern (BR-032).
// @spec BR-027; BR-032; ADR-074 D3, D5
// @tested tests/unit/inventory-costing.test.js
import { describe, expect, it } from 'vitest'
import {
  DEFAULT_SINGLE_DROP_FREIGHT_SATANG,
  amortiseSatang,
  customizationUnitCostSatang,
  isFinishedSetSku,
  kittedUnitCostSatang,
  landedUnitCostSatang,
  movingWeightedAverageSatang,
  parseFinishedSetSku,
  satangToBaht,
  weightedAverageUnitCostSatang,
} from '@/modules/inventory/domain/inventory-costing'

describe('FR-175 landed cost (BR-027)', () => {
  it('AC-175.1 — a shared batch cost is divided across the batch and rounded UP, so a batch is never valued below what it cost', () => {
    // 2,500 THB over 500 units divides exactly.
    expect(amortiseSatang(250000, 500)).toBe(500)
    // 2,500 THB over 3 units does not: 83,333.33 → 83,334, and 3 × 83,334
    // exceeds the outlay rather than falling short of it.
    expect(amortiseSatang(250000, 3)).toBe(83334)
    expect(amortiseSatang(250000, 3) * 3).toBeGreaterThan(250000)
    // A zero or missing cost contributes nothing; a zero batch never divides by zero.
    expect(amortiseSatang(0, 500)).toBe(0)
    expect(amortiseSatang(undefined, 0)).toBe(0)
  })

  it('AC-175.2 — the flat single-drop truck is absorbed into the unit cost, and the quote states both the zero and what it really cost', () => {
    const result = landedUnitCostSatang({
      batchQty: 500,
      factoryCostSatang: 7846, // BW00-0 at the ADR-009 locked 34.00 ฿/USD baseline
      seaFreightSatang: 1200000,
      importDutySatang: 300000,
      inboundTruckSatang: DEFAULT_SINGLE_DROP_FREIGHT_SATANG,
    })
    expect(result.breakdown).toEqual({
      factory: 7846,
      seaFreight: 2400,
      importDuty: 600,
      inboundTruck: 500,
      customization: 0,
      kitting: 0,
    })
    expect(result.unitCostSatang).toBe(7846 + 2400 + 600 + 500)
    expect(result.totalCostSatang).toBe(result.unitCostSatang * 500)
    // BR-027 — the customer is charged nothing for delivery, and the figure
    // that makes that claim auditable travels with it.
    expect(result.freightSatang).toBe(0)
    expect(result.freightAbsorbedSatang).toBe(DEFAULT_SINGLE_DROP_FREIGHT_SATANG)
  })

  it('AC-175.3 — money is integer satang: a fractional or negative cost is refused, never rounded into the ledger', () => {
    expect(() => landedUnitCostSatang({ batchQty: 100, factoryCostSatang: 78.46 })).toThrow()
    expect(() => landedUnitCostSatang({ batchQty: 100, factoryCostSatang: -1 })).toThrow()
    expect(() => landedUnitCostSatang({ batchQty: 0, factoryCostSatang: 100 })).toThrow()
  })

  it('AC-175.4 — a receipt blends into the running average; a first receipt simply sets it', () => {
    expect(movingWeightedAverageSatang({ onHandQty: 0, currentUnitSatang: 0, incomingQty: 100, incomingUnitSatang: 8000 })).toBe(8000)
    // 100 at 80.00 ฿ plus 100 at 90.00 ฿ is 85.00 ฿.
    expect(movingWeightedAverageSatang({ onHandQty: 100, currentUnitSatang: 8000, incomingQty: 100, incomingUnitSatang: 9000 })).toBe(8500)
    // Nothing incoming leaves the position untouched.
    expect(movingWeightedAverageSatang({ onHandQty: 100, currentUnitSatang: 8000, incomingQty: 0 })).toBe(8000)
  })

  it('AC-175.5 — a product whose receipts never carried a cost reports null, not a free tumbler', () => {
    expect(weightedAverageUnitCostSatang([{ quantity: 10, costSatang: null }, { quantity: 5 }])).toBeNull()
    expect(weightedAverageUnitCostSatang([{ quantity: 10, costSatang: 8000 }, { quantity: 10, costSatang: 9000 }])).toBe(8500)
    // An ISSUE row's sign never subtracts from the average.
    expect(weightedAverageUnitCostSatang([{ quantity: -10, costSatang: 8000 }])).toBe(8000)
  })

  it('AC-175.6 — a kitted set costs its components plus the labour amortised across the run, and says when a component cost is missing', () => {
    const complete = kittedUnitCostSatang({
      components: [
        { productId: 'tumbler', unitCostSatang: 11346, qtyPerSet: 1 },
        { productId: 'powerbank', unitCostSatang: 24000, qtyPerSet: 1 },
        { productId: 'box', unitCostSatang: 4500, qtyPerSet: 1 },
      ],
      laborCostSatang: 500000,
      batchQty: 500,
    })
    expect(complete).toMatchObject({ componentsSatang: 39846, laborPerUnitSatang: 1000, unitCostSatang: 40846, complete: true })

    const partial = kittedUnitCostSatang({ components: [{ productId: 'foam', unitCostSatang: null, qtyPerSet: 1 }, { productId: 'box', unitCostSatang: 4500, qtyPerSet: 1 }], batchQty: 10 })
    expect(partial.complete).toBe(false)
    expect(partial.missingCostProductIds).toEqual(['foam'])
    expect(partial.unitCostSatang).toBe(4500)
  })

  it('AC-175.7 — a customization run charges its setup across the units PLANNED, so a bad run does not cost more per surviving piece', () => {
    // 800 ฿ jig over 500 planned = 1.60 ฿, plus 12.00 ฿ a piece.
    expect(customizationUnitCostSatang({ setupCostSatang: 80000, runCostSatang: 1200, plannedQty: 500 })).toBe(160 + 1200)
    expect(customizationUnitCostSatang({})).toBe(0)
  })

  it('AC-175.8 — satang converts to baht only for display', () => {
    expect(satangToBaht(62500)).toBe(625)
    expect(satangToBaht(7846)).toBe(78.46)
    expect(satangToBaht(undefined)).toBeNull()
  })
})

describe('FR-177 FlowAccount finished-set SKU (BR-032)', () => {
  it('AC-177.1 — a tradeable set is [MODEL]-[COUNT]([PACKAGE]); a component code is not, and is not supposed to be', () => {
    expect(isFinishedSetSku('TMS06-4(P-16)')).toBe(true)
    expect(isFinishedSetSku('TMS06-3(P-06)')).toBe(true)
    expect(isFinishedSetSku('BW00-0(P-BAG)')).toBe(true)
    expect(isFinishedSetSku('COMP-TUMBLER-SUS304-500ML')).toBe(false)
    expect(isFinishedSetSku('tms06-4(p-16)')).toBe(false)
    expect(isFinishedSetSku('TMS06-4')).toBe(false)
    expect(isFinishedSetSku('TMS06-4(P 16)')).toBe(false)
    expect(isFinishedSetSku(null)).toBe(false)
  })

  it('AC-177.2 — the three parts are readable, so a picker knows which box to fetch without a lookup', () => {
    expect(parseFinishedSetSku('TMS06-4(P-16)')).toEqual({ model: 'TMS06', itemCount: 4, packageCode: 'P-16' })
    expect(parseFinishedSetSku('BW00-0(P-BAG)')).toEqual({ model: 'BW00', itemCount: 0, packageCode: 'P-BAG' })
    expect(parseFinishedSetSku('not-a-set')).toBeNull()
  })
})
