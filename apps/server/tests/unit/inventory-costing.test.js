// @req FR-175 — landed cost in integer satang: shared batch costs amortised and
//   rounded up, the flat single-drop truck absorbed into the unit, moving
//   weighted average valuation and the separate all-time purchasing statistic.
// @req FR-177 — the FlowAccount finished-set SKU pattern (BR-032).
// @spec BR-027; BR-032; ADR-074 D2, D3, D5
// @tested tests/unit/inventory-costing.test.js
import { describe, expect, it } from 'vitest'
import {
  DEFAULT_SINGLE_DROP_FREIGHT_SATANG,
  amortiseSatang,
  customizationUnitCostSatang,
  isFinishedSetSku,
  kittedUnitCostSatang,
  landedUnitCostSatang,
  movingAverageValuation,
  movingWeightedAverageSatang,
  parseFinishedSetSku,
  satangToBaht,
  allTimeReceiptAverageSatang,
} from '@/modules/inventory/domain/inventory-costing'

const movement = (id, kind, quantity, costSatang, occurredAt, extra = {}) => ({
  id,
  kind,
  quantity,
  costSatang,
  occurredAt,
  createdAt: occurredAt,
  reference: null,
  reason: null,
  sourceLocationId: null,
  targetLocationId: null,
  workOrderId: null,
  ...extra,
})

const permutations = (rows) => rows.length < 2
  ? [rows]
  : rows.flatMap((row, index) => permutations(rows.filter((_, other) => other !== index)).map((rest) => [row, ...rest]))

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

  it('AC-175.5 — the all-time receipt average is a purchasing statistic, not a stock valuation', () => {
    expect(allTimeReceiptAverageSatang([{ quantity: 10, costSatang: null }, { quantity: 5 }])).toBeNull()
    expect(allTimeReceiptAverageSatang([{ quantity: 10, costSatang: 8000 }, { quantity: 10, costSatang: 9000 }])).toBe(8500)
    // Production passes receipt rows only; legacy arithmetic uses absolute quantity.
    expect(allTimeReceiptAverageSatang([{ quantity: -10, costSatang: 8000 }])).toBe(8000)
  })

  it('AC-175.9 — a receipt after depletion restarts valuation at the new receipt cost', () => {
    expect(movingAverageValuation([
      movement('a', 'RECEIPT', 10, 100, '2026-01-01T00:00:00.000Z'),
      movement('b', 'ISSUE', -10, null, '2026-01-02T00:00:00.000Z'),
      movement('c', 'RECEIPT', 10, 200, '2026-01-03T00:00:00.000Z'),
    ])).toEqual({ unitCostSatang: 200, onHandQty: 10, partial: false, partialReasons: [], uncostedQty: 0 })
  })

  it('AC-175.10 — partial depletion leaves the old stock in the receipt blend', () => {
    expect(movingAverageValuation([
      movement('a', 'RECEIPT', 10, 100, '2026-01-01T00:00:00.000Z'),
      movement('b', 'ISSUE', -4, null, '2026-01-02T00:00:00.000Z'),
      movement('c', 'RECEIPT', 6, 200, '2026-01-03T00:00:00.000Z'),
    ])).toEqual({ unitCostSatang: 150, onHandQty: 12, partial: false, partialReasons: [], uncostedQty: 0 })
  })

  it('AC-175.11 — receipts at different prices blend against the stock left after each issue', () => {
    // 5@100, issue 2 => 3@100; add 3@200 => 6@150; issue 1 => 5@150; add 5@250 => 10@200.
    expect(movingAverageValuation([
      movement('a', 'RECEIPT', 5, 100, '2026-01-01T00:00:00.000Z'),
      movement('b', 'ISSUE', -2, null, '2026-01-02T00:00:00.000Z'),
      movement('c', 'RECEIPT', 3, 200, '2026-01-03T00:00:00.000Z'),
      movement('d', 'ISSUE', -1, null, '2026-01-04T00:00:00.000Z'),
      movement('e', 'RECEIPT', 5, 250, '2026-01-05T00:00:00.000Z'),
    ])).toEqual({ unitCostSatang: 200, onHandQty: 10, partial: false, partialReasons: [], uncostedQty: 0 })
  })

  it('AC-175.12 — an uncosted receipt marks a live valuation partial and remains in its quantity basis', () => {
    const live = movingAverageValuation([
      movement('a', 'RECEIPT', 10, 100, '2026-01-01T00:00:00.000Z'),
      movement('b', 'RECEIPT', 2, null, '2026-01-02T00:00:00.000Z'),
    ])
    expect(live).toEqual({ unitCostSatang: 100, onHandQty: 12, partial: true, partialReasons: ['UNCOSTED_RECEIPT'], uncostedQty: 2 })
    expect(movingAverageValuation([movement('a', 'RECEIPT', 2, null, '2026-01-01T00:00:00.000Z')]))
      .toEqual({ unitCostSatang: null, onHandQty: 2, partial: true, partialReasons: ['UNCOSTED_RECEIPT'], uncostedQty: 2 })
  })

  it('AC-175.13 — a costed receipt clears partial evidence only after the position emptied', () => {
    expect(movingAverageValuation([
      movement('a', 'RECEIPT', 4, 100, '2026-01-01T00:00:00.000Z'),
      movement('b', 'RECEIPT', 2, null, '2026-01-02T00:00:00.000Z'),
      movement('c', 'ISSUE', -6, null, '2026-01-03T00:00:00.000Z'),
      movement('d', 'RECEIPT', 3, 250, '2026-01-04T00:00:00.000Z'),
    ])).toEqual({ unitCostSatang: 250, onHandQty: 3, partial: false, partialReasons: [], uncostedQty: 0 })
  })

  it('AC-175.14 — uncosted count corrections use a known average, and adjustments down leave it unchanged', () => {
    expect(movingAverageValuation([
      movement('a', 'RECEIPT', 5, 100, '2026-01-01T00:00:00.000Z'),
      movement('b', 'ADJUSTMENT', 2, null, '2026-01-02T00:00:00.000Z'),
      movement('c', 'ADJUSTMENT', -3, null, '2026-01-03T00:00:00.000Z'),
    ])).toEqual({ unitCostSatang: 100, onHandQty: 4, partial: false, partialReasons: [], uncostedQty: 0 })
  })

  it('AC-175.15 — rows are replayed by occurrence time regardless of input order', () => {
    expect(movingAverageValuation([
      movement('c', 'RECEIPT', 10, 200, '2026-01-03T00:00:00.000Z'),
      movement('b', 'ISSUE', -10, null, '2026-01-02T00:00:00.000Z'),
      movement('a', 'RECEIPT', 10, 100, '2026-01-01T00:00:00.000Z'),
    ])).toMatchObject({ unitCostSatang: 200, onHandQty: 10, partial: false })
  })

  it('AC-175.15a — missing timestamps sort as zero and same-time steps blend inflows before outflows after createdAt', () => {
    expect(movingAverageValuation([
      movement('c', 'RECEIPT', 2, 200, '1970-01-01T00:00:00.002Z'),
      movement('b', 'ISSUE', -2, null, '1970-01-01T00:00:00.001Z'),
      movement('a', 'RECEIPT', 2, 100, 'not-a-date'),
    ])).toMatchObject({ unitCostSatang: 200, onHandQty: 2, partial: false })

    const tieAt = '2026-01-02T00:00:00.000Z'
    expect(movingAverageValuation([
      movement('a', 'RECEIPT', 1, 100, '2026-01-01T00:00:00.000Z'),
      movement('b-out', 'ISSUE', -1, null, tieAt, { createdAt: '2026-01-02T00:00:00.000Z' }),
      movement('z-in', 'RECEIPT', 1, 200, tieAt, { createdAt: '2026-01-02T00:00:00.001Z' }),
    ])).toMatchObject({ unitCostSatang: 200, onHandQty: 1 })

    const sameInstant = '2026-01-03T00:00:00.000Z'
    expect(movingAverageValuation([
      movement('a-start', 'RECEIPT', 1, 0, '2026-01-01T00:00:00.000Z'),
      movement('b', 'RECEIPT', 1, 2, sameInstant),
      movement('a', 'RECEIPT', 1, 1, sameInstant),
    ])).toMatchObject({ unitCostSatang: 1, onHandQty: 3 })
  })

  it('AC-175.21 — a negative historical balance makes valuation partial and survives later cost resets', () => {
    expect(movingAverageValuation([
      movement('receipt-day-2', 'RECEIPT', 10, 100, '2026-01-02T00:00:00.000Z'),
      movement('receipt-day-3', 'RECEIPT', 10, 200, '2026-01-03T00:00:00.000Z'),
      movement('issue-day-1', 'ISSUE', -15, null, '2026-01-01T00:00:00.000Z'),
    ])).toEqual({ unitCostSatang: 200, onHandQty: 5, partial: true, partialReasons: ['NEGATIVE_BALANCE'], uncostedQty: 0 })

    expect(movingAverageValuation([
      movement('issue-day-1', 'ISSUE', -2, null, '2026-01-01T00:00:00.000Z'),
      movement('receipt-day-2', 'RECEIPT', 2, 100, '2026-01-02T00:00:00.000Z'),
      movement('receipt-day-3', 'RECEIPT', 3, 200, '2026-01-03T00:00:00.000Z'),
    ])).toEqual({ unitCostSatang: 200, onHandQty: 3, partial: true, partialReasons: ['NEGATIVE_BALANCE'], uncostedQty: 0 })
  })

  it('AC-175.22 — the same ledger with an issue after both receipts has the complete append-order average', () => {
    expect(movingAverageValuation([
      movement('receipt-day-2', 'RECEIPT', 10, 100, '2026-01-02T00:00:00.000Z'),
      movement('receipt-day-3', 'RECEIPT', 10, 200, '2026-01-03T00:00:00.000Z'),
      movement('issue-day-4', 'ISSUE', -15, null, '2026-01-04T00:00:00.000Z'),
    ])).toEqual({ unitCostSatang: 150, onHandQty: 5, partial: false, partialReasons: [], uncostedQty: 0 })
  })

  it('AC-175.23 — same-time costed receipts blend once independent of row order and IDs', () => {
    const sameInstant = '2026-01-03T00:00:00.000Z'
    for (const ids of [['a', 'b', 'c'], ['c', 'b', 'a']]) {
      const rows = [100, 101, 102].map((costSatang, index) => movement(ids[index], 'RECEIPT', 1, costSatang, sameInstant, { createdAt: sameInstant }))
      for (const shuffled of permutations(rows)) {
        expect(movingAverageValuation(shuffled)).toEqual({ unitCostSatang: 101, onHandQty: 3, partial: false, partialReasons: [], uncostedQty: 0 })
      }
    }
  })

  it('AC-175.24 — a same-time issue and uncosted receipt share one inflow-first step on existing stock', () => {
    const sameInstant = '2026-01-02T00:00:00.000Z'
    for (const ids of [['a', 'b', 'c', 'd'], ['d', 'c', 'b', 'a']]) {
      const rows = [
        movement(ids[0], 'RECEIPT', 2, 100, '2026-01-01T00:00:00.000Z'),
        movement(ids[1], 'RECEIPT', 1, 102, sameInstant, { createdAt: sameInstant }),
        movement(ids[2], 'RECEIPT', 1, null, sameInstant, { createdAt: sameInstant }),
        movement(ids[3], 'ISSUE', -2, null, sameInstant, { createdAt: sameInstant }),
      ]
      for (const shuffled of permutations(rows)) {
        expect(movingAverageValuation(shuffled)).toEqual({ unitCostSatang: 101, onHandQty: 2, partial: true, partialReasons: ['UNCOSTED_RECEIPT'], uncostedQty: 1 })
      }
    }
  })

  it('AC-175.16 — a located transfer, including one of the whole position, does not change business valuation', () => {
    const at = '2026-01-02T00:00:00.000Z'
    const result = movingAverageValuation([
      movement('a', 'RECEIPT', 5, 100, '2026-01-01T00:00:00.000Z'),
      movement('b', 'ISSUE', -5, null, at, { reference: 'MOVE-1', reason: 'STOCK_TRANSFER', sourceLocationId: 'source' }),
      movement('c', 'RECEIPT', 5, null, at, { reference: 'MOVE-1', reason: 'STOCK_TRANSFER', targetLocationId: 'target' }),
    ])
    expect(result).toEqual({ unitCostSatang: 100, onHandQty: 5, partial: false, partialReasons: [], uncostedQty: 0 })

    const partialTransfer = movingAverageValuation([
      movement('a', 'RECEIPT', 10, 100, '2026-01-01T00:00:00.000Z'),
      movement('b', 'ISSUE', -4, null, at, { reference: 'MOVE-2', reason: 'STOCK_TRANSFER', sourceLocationId: 'source' }),
      movement('c', 'RECEIPT', 4, null, at, { reference: 'MOVE-2', reason: 'STOCK_TRANSFER', targetLocationId: 'target' }),
    ])
    expect(partialTransfer).toEqual({ unitCostSatang: 100, onHandQty: 10, partial: false, partialReasons: [], uncostedQty: 0 })
  })

  it('AC-175.17 — a buffer-return transfer cancels without swallowing same-time customization consumption', () => {
    const at = '2026-01-02T00:00:00.000Z'
    expect(movingAverageValuation([
      movement('a', 'RECEIPT', 10, 100, '2026-01-01T00:00:00.000Z'),
      movement('b', 'ISSUE', -2, null, at, { reference: 'CWO:1', reason: 'CUSTOMIZATION_BUFFER_RETURNED', sourceLocationId: 'wip', workOrderId: 'wo-1' }),
      movement('c', 'RECEIPT', 2, null, at, { reference: 'CWO:1', reason: 'CUSTOMIZATION_BUFFER_RETURNED', targetLocationId: 'raw', workOrderId: 'wo-1' }),
      movement('d', 'ISSUE', -3, null, at, { reference: 'CWO:1', reason: 'CUSTOMIZATION_CONSUMED', sourceLocationId: 'raw', workOrderId: 'wo-1' }),
    ])).toEqual({ unitCostSatang: 100, onHandQty: 7, partial: false, partialReasons: [], uncostedQty: 0 })
  })

  it('AC-175.18 — invalid movement rows are skipped and reported, never used to price stock', () => {
    expect(movingAverageValuation([
      movement('a', 'RECEIPT', 1, 100, '2026-01-01T00:00:00.000Z'),
      movement('b', 'ISSUE', 1, 1, '2026-01-02T00:00:00.000Z'),
    ])).toEqual({ unitCostSatang: 100, onHandQty: 1, partial: true, partialReasons: ['INVALID_ROW'], uncostedQty: 0 })
    expect(movingAverageValuation([
      movement('a', 'RECEIPT', 1, 100, '2026-01-01T00:00:00.000Z'),
      movement('b', 'RECEIPT', 2, -1, '2026-01-02T00:00:00.000Z'),
    ])).toEqual({ unitCostSatang: 100, onHandQty: 3, partial: true, partialReasons: ['INVALID_ROW', 'UNCOSTED_RECEIPT'], uncostedQty: 2 })
    expect(movingAverageValuation([
      movement('a', 'ADJUSTMENT', 2, null, '2026-01-01T00:00:00.000Z'),
    ])).toEqual({ unitCostSatang: null, onHandQty: 2, partial: true, partialReasons: ['UNCOSTED_ADJUSTMENT'], uncostedQty: 2 })
    expect(movingAverageValuation([
      movement('a', 'RECEIPT', 2, 100, '2026-01-01T00:00:00.000Z'),
      movement('b', 'ISSUE', 1, 1, '2026-01-02T00:00:00.000Z'),
      movement('c', 'ISSUE', -2, null, '2026-01-03T00:00:00.000Z'),
      movement('d', 'RECEIPT', 3, 250, '2026-01-04T00:00:00.000Z'),
    ])).toEqual({ unitCostSatang: 250, onHandQty: 3, partial: true, partialReasons: ['INVALID_ROW'], uncostedQty: 0 })
  })

  it('AC-175.19 — blend math remains exact above Number safe aggregate range', () => {
    const max = Number.MAX_SAFE_INTEGER
    expect(movingAverageValuation([
      movement('a', 'RECEIPT', max, max, '2026-01-01T00:00:00.000Z'),
      movement('b', 'RECEIPT', max, max - 1, '2026-01-02T00:00:00.000Z'),
    ])).toMatchObject({ unitCostSatang: max })
  })

  it('AC-175.20 — every permutation of seeded ledgers replays identically and replay is repeatable', () => {
    let state = 0x51f15e
    const random = () => { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return state }
    const kinds = ['RECEIPT', 'ISSUE', 'ADJUSTMENT']
    for (let ledgerIndex = 0; ledgerIndex < 250; ledgerIndex += 1) {
      const sharedInstant = new Date(Date.UTC(2026, 0, 1 + (random() % 4))).toISOString()
      const entries = Array.from({ length: 4 }, (_, rowIndex) => {
        const kind = kinds[random() % kinds.length]
        const magnitude = 1 + (random() % 5)
        const quantity = kind === 'RECEIPT' ? magnitude : kind === 'ISSUE' ? -magnitude : (random() % 2 ? magnitude : -magnitude)
        const cost = random() % 5 === 0 ? null : random() % 1000
        const sameStep = ledgerIndex % 2 === 0 && rowIndex < 2
        const occurredAt = sameStep ? sharedInstant : new Date(Date.UTC(2026, 0, 1 + (random() % 4))).toISOString()
        const createdAt = sameStep ? sharedInstant : new Date(Date.UTC(2026, 0, 1 + (random() % 4))).toISOString()
        return { kind, quantity, cost, occurredAt, createdAt }
      })
      const ids = entries.map((_, index) => `ledger-${ledgerIndex}-${random().toString(16).padStart(8, '0')}-${index}`)
      for (let index = ids.length - 1; index > 0; index -= 1) {
        const other = random() % (index + 1)
        ;[ids[index], ids[other]] = [ids[other], ids[index]]
      }
      const rows = entries.map((entry, index) => movement(ids[index], entry.kind, entry.quantity, entry.cost, entry.occurredAt, { createdAt: entry.createdAt }))
      const originalRows = rows.map((row) => ({ ...row }))
      const expected = movingAverageValuation(rows)
      expect(rows).toEqual(originalRows)
      expect(movingAverageValuation(rows)).toEqual(expected)
      for (const shuffled of permutations(rows)) expect(movingAverageValuation(shuffled)).toEqual(expected)
    }
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
