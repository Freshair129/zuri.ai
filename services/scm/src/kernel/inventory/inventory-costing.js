import { z } from 'zod'

// @req FR-175 — the money half of the Inventory lane, and nothing else: what a
//   unit cost us landed, in integer satang, and what a batch of them is worth
//   after a second delivery blends into the first. Pure: no Prisma, no clock,
//   no viewer. Every number a valuation shows comes from here, so a page and a
//   work order can never quote two different costs for the same unit.
// @req FR-177 — the FlowAccount finished-set SKU pattern lives here too,
//   because it is the same class of thing: an accounting-integration contract
//   about the codes that reach an invoice.
// @spec BR-027 (integer satang; shared costs amortised and rounded up; the
//   flat single-drop truck absorbed into unit valuation and never quoted),
//   BR-032 (the finished-set SKU pattern), ADR-074 D3/D5, ADR-065 D2
// @tested tests/unit/inventory-costing.test.js

/**
 * The flat domestic single-drop truck, in satang. It is a default, not a
 * constant of nature: a Business with a different haulier passes its own. It
 * lives here rather than in a service because the *rule* — one flat truck per
 * batch, absorbed into the unit — is what BR-027 fixes, and the amount is the
 * parameter that rule takes.
 */
export const DEFAULT_SINGLE_DROP_FREIGHT_SATANG = 250000

/**
 * The FlowAccount normalized SKU of a tradeable finished set:
 * `[factory model]-[item count]([package code])` — `TMS06-4(P-16)` is a
 * four-item set in rigid box P-16, `BW00-0(P-BAG)` a single item in a canvas
 * bag. Deliberately NOT applied to every product code: components and
 * packaging keep the ordinary FR-154 shape (BR-032).
 */
export const FINISHED_SET_SKU_PATTERN = /^[A-Z0-9]+-[0-9]+\([A-Z0-9_-]+\)$/

export function isFinishedSetSku(code) {
  return typeof code === 'string' && FINISHED_SET_SKU_PATTERN.test(code.trim())
}

export const zFinishedSetSku = z.string().trim().regex(
  FINISHED_SET_SKU_PATTERN,
  'a finished set SKU is [MODEL]-[COUNT]([PACKAGE]), e.g. TMS06-4(P-16)',
)

/** The three parts of a FlowAccount set code, or null when it is not one. */
export function parseFinishedSetSku(code) {
  const text = typeof code === 'string' ? code.trim() : ''
  const match = /^([A-Z0-9]+)-([0-9]+)\(([A-Z0-9_-]+)\)$/.exec(text)
  if (!match) return null
  return { model: match[1], itemCount: Number(match[2]), packageCode: match[3] }
}

const satang = z.number().int().nonnegative()
const positiveInt = z.number().int().positive()

export const zLandedCostInput = z.object({
  batchQty: positiveInt,
  factoryCostSatang: satang,
  seaFreightSatang: satang.optional(),
  importDutySatang: satang.optional(),
  inboundTruckSatang: satang.optional(),
  customizationPerUnitSatang: satang.optional(),
  kittingPerUnitSatang: satang.optional(),
}).strict()

/**
 * Divide a cost shared by a whole batch across its units, rounded **up** to
 * the satang, so a batch is never valued below what it cost. The remainder is
 * a rounding gain of at most one satang per unit and is never redistributed:
 * a valuation that depended on which unit got the leftover would not be
 * reproducible from the same inputs.
 */
export function amortiseSatang(totalSatang, batchQty) {
  const total = Math.max(0, Math.trunc(totalSatang ?? 0))
  const qty = Math.max(1, Math.trunc(batchQty ?? 1))
  return Math.ceil(total / qty)
}

/**
 * The landed unit cost of one batch, in satang, with every shared cost
 * amortised across the batch — including the flat single-drop truck, which is
 * exactly why a standard quote can show delivery as 0.00 (BR-027). Returns the
 * breakdown as well as the total, because "why is this unit 62.50" is a
 * question a buyer asks and a single number cannot answer.
 */
export function landedUnitCostSatang(input) {
  const data = zLandedCostInput.parse(input)
  const breakdown = {
    factory: data.factoryCostSatang,
    seaFreight: amortiseSatang(data.seaFreightSatang ?? 0, data.batchQty),
    importDuty: amortiseSatang(data.importDutySatang ?? 0, data.batchQty),
    inboundTruck: amortiseSatang(data.inboundTruckSatang ?? 0, data.batchQty),
    customization: data.customizationPerUnitSatang ?? 0,
    kitting: data.kittingPerUnitSatang ?? 0,
  }
  const unitCostSatang = Object.values(breakdown).reduce((sum, part) => sum + part, 0)
  return {
    batchQty: data.batchQty,
    unitCostSatang,
    totalCostSatang: unitCostSatang * data.batchQty,
    breakdown,
    // What the customer is told, and what it actually cost us. Both, always:
    // a quote that showed only the zero would be a claim nobody could audit.
    freightSatang: 0,
    freightAbsorbedSatang: breakdown.inboundTruck * data.batchQty,
  }
}

/**
 * Moving weighted average: a receipt of `incomingQty` at `incomingUnitSatang`
 * blends into a position of `onHandQty` at `currentUnitSatang`. Rounded up for
 * the same reason `amortiseSatang` is. A receipt into an empty (or negative,
 * which the ledger refuses but arithmetic should survive) position simply
 * takes the incoming cost.
 */
export function movingWeightedAverageSatang({ onHandQty = 0, currentUnitSatang = 0, incomingQty = 0, incomingUnitSatang = 0 } = {}) {
  const held = Math.max(0, Math.trunc(onHandQty))
  const incoming = Math.max(0, Math.trunc(incomingQty))
  if (incoming <= 0) return Math.max(0, Math.trunc(currentUnitSatang))
  if (held <= 0) return Math.max(0, Math.trunc(incomingUnitSatang))
  const total = held * Math.max(0, Math.trunc(currentUnitSatang)) + incoming * Math.max(0, Math.trunc(incomingUnitSatang))
  return Math.ceil(total / (held + incoming))
}

/**
 * The weighted average unit cost of what a product has actually received:
 * `Σ(qty × unitCost) / Σ(qty)` over the receipt rows that carry a cost, in
 * satang. Rows with no cost are skipped rather than counted as free — a
 * product whose receipts never carried a cost returns null, which is the
 * honest answer and the one a caller can report as "unknown" instead of
 * printing 0.00 for a stainless steel tumbler.
 */
export function weightedAverageUnitCostSatang(receipts = []) {
  let qty = 0
  let value = 0
  for (const row of receipts) {
    const cost = row?.costSatang
    if (cost === null || cost === undefined) continue
    const count = Math.abs(Math.trunc(row.quantity ?? 0))
    if (count <= 0) continue
    qty += count
    value += count * Math.max(0, Math.trunc(cost))
  }
  if (qty === 0) return null
  return Math.ceil(value / qty)
}

/**
 * The blended unit cost of one assembled set: every component's landed cost
 * times how many of it the set contains, plus the assembly labour amortised
 * across the batch. `components` are `{ unitCostSatang, qtyPerSet }`; a
 * component with no known cost contributes nothing rather than guessing, and
 * is reported so a caller can say the figure is partial.
 */
export function kittedUnitCostSatang({ components = [], laborCostSatang = 0, batchQty = 1 } = {}) {
  let componentsSatang = 0
  const missingCost = []
  for (const line of components) {
    if (line?.unitCostSatang === null || line?.unitCostSatang === undefined) {
      missingCost.push(line?.productId ?? null)
      continue
    }
    componentsSatang += Math.max(0, Math.trunc(line.unitCostSatang)) * Math.max(0, Math.ceil(line.qtyPerSet ?? 0))
  }
  const laborPerUnit = amortiseSatang(laborCostSatang, batchQty)
  return {
    unitCostSatang: componentsSatang + laborPerUnit,
    componentsSatang,
    laborPerUnitSatang: laborPerUnit,
    complete: missingCost.length === 0,
    missingCostProductIds: missingCost,
  }
}

/**
 * The per-unit cost a customization run adds: the one-off setup (a laser jig,
 * a screen, a foil die) amortised across the batch, plus the per-piece run
 * cost. Setup is amortised across the units *planned*, not the units that
 * survived — the jig was made for the run, and charging the survivors for the
 * scrap would make the same job cost more the worse it went.
 */
export function customizationUnitCostSatang({ setupCostSatang = 0, runCostSatang = 0, plannedQty = 1 } = {}) {
  return amortiseSatang(setupCostSatang, plannedQty) + Math.max(0, Math.trunc(runCostSatang))
}

/** Satang → baht for a surface that shows money; never used to compute one. */
export const satangToBaht = (value) => (Number.isFinite(value) ? Math.trunc(value) / 100 : null)
