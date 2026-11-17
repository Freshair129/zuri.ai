import { z } from 'zod'

// @req FR-175 — the money half of the Inventory lane, and nothing else: what a
//   unit cost us landed, in integer satang, and the Business-wide, per-product
//   moving weighted average replayed from its append-only ledger. Pure: no
//   Prisma, no clock, no viewer. The all-time receipt average below is a
//   purchasing statistic and is never a stock valuation.
// @req FR-177 — the FlowAccount finished-set SKU pattern lives here too,
//   because it is the same class of thing: an accounting-integration contract
//   about the codes that reach an invoice.
// @spec BR-027 (integer satang; shared costs amortised and rounded up; the
//   flat single-drop truck absorbed into unit valuation and never quoted),
//   BR-032 (the finished-set SKU pattern), ADR-074 D2/D3/D5, ADR-065 D2
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

const ceilDivNonnegative = (numerator, denominator) => (numerator + denominator - 1n) / denominator
const safeSatangFromBigInt = (value) => (value >= 0n && value <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(value) : null)

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
  const current = Math.max(0, Math.trunc(currentUnitSatang))
  const next = Math.max(0, Math.trunc(incomingUnitSatang))
  const average = ceilDivNonnegative(BigInt(held) * BigInt(current) + BigInt(incoming) * BigInt(next), BigInt(held) + BigInt(incoming))
  return Number(average)
}

// Normalize supported timestamps for the replay's deterministic ordering.
function timestampValue(value) {
  if (value instanceof Date) {
    const milliseconds = value.getTime()
    return Number.isFinite(milliseconds) ? milliseconds : 0
  }
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0
  if (typeof value === 'string' && value.trim()) {
    const milliseconds = Date.parse(value)
    return Number.isFinite(milliseconds) ? milliseconds : 0
  }
  return 0
}

const compareNumber = (left, right) => (left < right ? -1 : left > right ? 1 : 0)
const compareString = (left, right) => (left < right ? -1 : left > right ? 1 : 0)

// Order replay steps by ledger time and creation time, then rows inflow-first
// and by stable ID. Rows in the same step are aggregated before valuation.
function compareMovement(leftValue, rightValue) {
  const left = leftValue && typeof leftValue === 'object' ? leftValue : {}
  const right = rightValue && typeof rightValue === 'object' ? rightValue : {}
  return compareNumber(timestampValue(left.occurredAt), timestampValue(right.occurredAt))
    || compareNumber(timestampValue(left.createdAt), timestampValue(right.createdAt))
    || compareNumber(left.quantity > 0 ? 0 : 1, right.quantity > 0 ? 0 : 1)
    || compareString(String(left.id ?? ''), String(right.id ?? ''))
}

// Enforce the ledger's movement kind and quantity sign conventions.
function validMovement(row) {
  if (!row || typeof row !== 'object' || !Number.isSafeInteger(row.quantity)) return false
  if (row.kind === 'RECEIPT') return row.quantity > 0
  if (row.kind === 'ISSUE') return row.quantity < 0
  if (row.kind === 'ADJUSTMENT') return true
  return false
}

function movementCost(row, reasons, markPartial) {
  if (row.costSatang === null || row.costSatang === undefined) return null
  if (!Number.isSafeInteger(row.costSatang) || row.costSatang < 0) {
    reasons.add('INVALID_ROW')
    markPartial()
    return null
  }
  return BigInt(row.costSatang)
}

function transferGroupKey(row) {
  if (!row || row.reference === null || row.reference === undefined) return null
  return JSON.stringify([
    timestampValue(row.occurredAt),
    row.reference,
    row.reason ?? null,
    row.workOrderId ?? null,
  ])
}

function neutralTransferIds(movements) {
  const groups = new Map()
  for (const row of movements) {
    const key = transferGroupKey(row)
    if (key === null) continue
    const group = groups.get(key) ?? { issues: [], receipts: [] }
    if (row?.kind === 'ISSUE' && row.sourceLocationId != null && row.targetLocationId == null) group.issues.push(row)
    if (row?.kind === 'RECEIPT' && row.targetLocationId != null && row.sourceLocationId == null) group.receipts.push(row)
    groups.set(key, group)
  }
  const dropped = new Set()
  for (const group of groups.values()) {
    if (!group.issues.length || !group.receipts.length) continue
    if (!group.issues.every((row) => Number.isSafeInteger(row.quantity) && row.quantity < 0)) continue
    if (!group.receipts.every((row) => Number.isSafeInteger(row.quantity) && row.quantity > 0)) continue
    const issueQty = group.issues.reduce((sum, row) => sum + BigInt(-row.quantity), 0n)
    const receiptQty = group.receipts.reduce((sum, row) => sum + BigInt(row.quantity), 0n)
    if (issueQty !== receiptQty) continue
    for (const row of [...group.issues, ...group.receipts]) dropped.add(row)
  }
  return dropped
}

/**
 * Replay a Business-wide product's append-only stock ledger in ledger order
 * into its moving weighted-average valuation. The average changes only when a
 * costed inflow lands. Uncosted exposure stays partial until the position
 * empties and a costed receipt clears that exposure; an invalid row keeps the
 * replay partial because the skipped quantity makes emptiness untrustworthy.
 * A position at zero retains the average its last units left at, so a work
 * order that just issued its final raw unit can still read that cost. Valuation
 * deliberately ignores location; matched transfer pairs change custody, not
 * the product's cost basis. Invalid rows are skipped and reported as partial
 * evidence. Rows with the same `occurredAt` and `createdAt` replay as one step:
 * costed inflows blend once, then uncosted inflows enter, then outflows leave;
 * their IDs do not affect the result.
 *
 * @returns {{unitCostSatang: number|null, onHandQty: number, partial: boolean, partialReasons: string[], uncostedQty: number}}
 *   `partialReasons` can contain `INVALID_ROW`, `NEGATIVE_BALANCE`,
 *   `UNCOSTED_RECEIPT`, and `UNCOSTED_ADJUSTMENT`. A negative balance at any
 *   point of the replay makes the figure partial; only correcting the ledger's
 *   history so a movement is dated when the balance never goes negative removes
 *   `NEGATIVE_BALANCE`.
 *
 * This is pure: no Prisma, clock or input mutation.
 */
export function movingAverageValuation(movements = []) {
  const rows = Array.isArray(movements) ? [...movements] : []
  const neutralTransfers = neutralTransferIds(rows)
  const ordered = rows.filter((row) => !neutralTransfers.has(row)).sort(compareMovement)
  const partialReasons = new Set()
  let partial = false
  let unitCost = null
  let onHandQty = 0n
  let uncostedQty = 0n
  const markPartial = () => { partial = true }
  const hasStickyPartialReason = () => partialReasons.has('INVALID_ROW') || partialReasons.has('NEGATIVE_BALANCE')

  for (let start = 0; start < ordered.length;) {
    const first = ordered[start]
    const occurredAt = timestampValue(first?.occurredAt)
    const createdAt = timestampValue(first?.createdAt)
    let end = start + 1
    while (end < ordered.length
      && timestampValue(ordered[end]?.occurredAt) === occurredAt
      && timestampValue(ordered[end]?.createdAt) === createdAt) end += 1

    let costedInflowQty = 0n
    let costedInflowValue = 0n
    let uncostedReceiptQty = 0n
    let uncostedAdjustmentQty = 0n
    let outflowQty = 0n

    for (const row of ordered.slice(start, end)) {
      if (!validMovement(row)) {
        partialReasons.add('INVALID_ROW')
        markPartial()
        continue
      }
      const cost = movementCost(row, partialReasons, markPartial)
      const quantity = BigInt(row.quantity)

      if (row.kind === 'RECEIPT' || (row.kind === 'ADJUSTMENT' && quantity > 0n)) {
        if (cost !== null) {
          costedInflowQty += quantity
          costedInflowValue += quantity * cost
        } else if (row.kind === 'RECEIPT') {
          uncostedReceiptQty += quantity
        } else {
          uncostedAdjustmentQty += quantity
        }
      } else {
        outflowQty += quantity
      }
    }

    if (costedInflowQty > 0n) {
      const incomingAverage = ceilDivNonnegative(costedInflowValue, costedInflowQty)
      if (onHandQty <= 0n) {
        unitCost = incomingAverage
        partialReasons.delete('UNCOSTED_RECEIPT')
        partialReasons.delete('UNCOSTED_ADJUSTMENT')
        partial = hasStickyPartialReason()
        uncostedQty = 0n
      } else if (unitCost === null) {
        unitCost = incomingAverage
      } else {
        unitCost = ceilDivNonnegative(onHandQty * unitCost + costedInflowValue, onHandQty + costedInflowQty)
      }
      onHandQty += costedInflowQty
    }

    if (uncostedReceiptQty > 0n) {
      partialReasons.add('UNCOSTED_RECEIPT')
      markPartial()
      uncostedQty += uncostedReceiptQty
    }
    if (uncostedAdjustmentQty > 0n && unitCost === null) {
      partialReasons.add('UNCOSTED_ADJUSTMENT')
      markPartial()
      uncostedQty += uncostedAdjustmentQty
    }
    onHandQty += uncostedReceiptQty + uncostedAdjustmentQty + outflowQty

    if (onHandQty < 0n) {
      partialReasons.add('NEGATIVE_BALANCE')
      markPartial()
    }

    start = end
  }

  const safeUnitCost = unitCost === null ? null : safeSatangFromBigInt(unitCost)
  if (unitCost !== null && safeUnitCost === null) {
    partialReasons.add('INVALID_ROW')
    partial = true
  }
  return {
    unitCostSatang: safeUnitCost,
    onHandQty: Number(onHandQty),
    partial,
    partialReasons: [...partialReasons].sort(),
    uncostedQty: Number(uncostedQty),
  }
}

/**
 * Purchasing statistic: the average price paid across every receipt ever,
 * `ceil(Σ(abs(qty) × unitCost) / Σ(abs(qty)))`. Production callers pass
 * receipt rows only. This is not a stock valuation; nothing may use it to
 * price a work order or value stock. Missing costs are excluded from this
 * statistic (never treated as free), preserving its historical meaning.
 */
export function allTimeReceiptAverageSatang(receipts = []) {
  let qty = 0n
  let value = 0n
  for (const row of receipts) {
    const cost = row?.costSatang
    if (cost === null || cost === undefined) continue
    const count = Math.abs(Math.trunc(row.quantity ?? 0))
    if (!Number.isFinite(count) || count <= 0) continue
    const unitCost = Math.max(0, Math.trunc(cost))
    if (!Number.isFinite(unitCost)) continue
    qty += BigInt(count)
    value += BigInt(count) * BigInt(unitCost)
  }
  if (qty === 0n) return null
  return safeSatangFromBigInt(ceilDivNonnegative(value, qty))
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
