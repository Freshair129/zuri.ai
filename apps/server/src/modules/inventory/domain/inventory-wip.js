import { z } from 'zod'
import {
  CUSTOMIZATION_TECHNIQUES,
  STOCK_RESERVATION_PURPOSES,
  WORK_ORDER_ACTIONS,
} from '@/lib/validation/enums'
import { INVENTORY_CODE_PATTERN } from './inventory'

// @req FR-176 — the customization work order's contract and the guard that
//   makes branding irreversible: a branded unit is a different product with a
//   customer lock, and every question about whether it may move is answered
//   here, by code, rather than by a service remembering to check.
// @req FR-177 — the scrap-allowance explosion: the gross quantity a net
//   requirement needs when the recipe declares an expected loss.
// @req FR-179 — the shelf-life calculators: a lot's storage age, whether it is
//   due for maintenance, and whether it may be issued at all.
// @req FR-180 — Available-to-Promise: on-hand less what is committed and what
//   is softly reserved, with quote expiry evaluated against the clock the
//   caller passes rather than a clock this file reaches for.
// @spec BR-028, BR-029, BR-030, BR-031; ADR-074 D4, D5, D7, D8
// @tested tests/unit/inventory-wip.test.js,
//   tests/integration/fr176-customization-work-order.test.js,
//   tests/integration/fr180-atp-reservations.test.js

export const CUSTOMIZATION_WORK_ORDER_ENTITY = 'CUSTOMIZATION_WORK_ORDER'
export const KITTING_WORK_ORDER_ENTITY = 'KITTING_WORK_ORDER'
export const STOCK_RESERVATION_ENTITY = 'STOCK_RESERVATION'

const zBusinessId = z.string().trim().min(1).max(200)
const zId = z.string().trim().min(1).max(200)
const zText = (max) => z.string().trim().min(1).max(max)
const zOptionalText = (max) => z.string().trim().max(max).nullable().optional()
const zCode = z.string().trim().regex(INVENTORY_CODE_PATTERN, 'code must be 1–64 letters, digits, ".", "-" or "_"')
const zSatang = z.number().int().nonnegative()

/** The scrap allowance a bill of materials or a customization run may declare (BR-029). */
export const MAX_SCRAP_ALLOWANCE_FACTOR = 0.2
export const zScrapAllowanceFactor = z.number().finite().min(0).max(MAX_SCRAP_ALLOWANCE_FACTOR)

/** The default soft hold a quote places on components, in days (BR-031). */
export const DEFAULT_QUOTE_RESERVATION_DAYS = 7
export const MILLIS_PER_DAY = 86400000

// ── FR-176 customization ────────────────────────────────────────────────────

export const zOpenCustomizationWorkOrder = z.object({
  businessId: zBusinessId,
  rawProductId: zId,
  // Optional: when the caller does not name one, the service creates the
  // branded SKU itself. That is not a catalogue decision a human makes — it is
  // the same hardware, dedicated, and its identity is the order that branded it.
  outputProductId: zId.nullable().optional(),
  technique: z.enum(CUSTOMIZATION_TECHNIQUES),
  netQuantity: z.number().int().positive(),
  scrapAllowanceFactor: zScrapAllowanceFactor.optional(),
  customerId: zId.nullable().optional(),
  salesOrderId: zId.nullable().optional(),
  logoArtworkUrl: zOptionalText(1000),
  pantoneColors: z.array(zText(40)).max(20).optional(),
  setupCostSatang: zSatang.optional(),
  runCostSatang: zSatang.optional(),
  sourceLocationId: zId.nullable().optional(),
  wipLocationId: zId.nullable().optional(),
  scrapLocationId: zId.nullable().optional(),
  scheduledDate: z.coerce.date().nullable().optional(),
  notes: zOptionalText(2000),
}).strict()

export const zCompleteCustomizationWorkOrder = z.object({
  businessId: zBusinessId,
  version: z.number().int().positive(),
  completedQty: z.number().int().nonnegative(),
  scrapQty: z.number().int().nonnegative().optional(),
  outputLotCode: zCode.nullable().optional(),
  reason: zOptionalText(500),
  occurredAt: z.coerce.date().optional(),
}).strict()

export const zCancelWorkOrder = z.object({
  businessId: zBusinessId,
  version: z.number().int().positive(),
  reason: zOptionalText(500),
  occurredAt: z.coerce.date().optional(),
}).strict()

// @req FR-182 — one contract for what a surface may ask of a work order. The
//   action is a declared vocabulary rather than a string a route branches on,
//   and COMPLETE carries the counts only COMPLETE has: a RELEASE that quietly
//   accepted `completedQty` would be a shape the service never reads.
export const zWorkOrderAction = z.object({
  businessId: zBusinessId,
  action: z.enum(WORK_ORDER_ACTIONS),
  version: z.number().int().positive(),
  completedQty: z.number().int().nonnegative().optional(),
  assembledQty: z.number().int().nonnegative().optional(),
  scrapQty: z.number().int().nonnegative().optional(),
  outputLotCode: zCode.nullable().optional(),
  reason: zOptionalText(500),
  occurredAt: z.coerce.date().optional(),
}).strict().superRefine((value, ctx) => {
  if (value.action !== 'COMPLETE' && (value.completedQty !== undefined || value.assembledQty !== undefined || value.scrapQty !== undefined)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['action'], message: 'only COMPLETE carries produced and scrapped quantities' })
  }
})

/**
 * The gross quantity to issue for a net requirement when a declared fraction
 * is expected to be lost: `ceil(net × (1 + factor))`. The buffer leaves the
 * shelf with the rest, because a line that stops halfway to fetch three more
 * boxes has already lost the morning (BR-029).
 */
export function grossIssueQuantity(netQuantity, scrapAllowanceFactor = 0) {
  const net = Math.max(0, Math.trunc(netQuantity ?? 0))
  const factor = Math.min(MAX_SCRAP_ALLOWANCE_FACTOR, Math.max(0, Number(scrapAllowanceFactor) || 0))
  if (net === 0) return 0
  return Math.ceil(net * (1 + factor) - 1e-9)
}

/** The buffer itself, as a count — what the gross issue adds over the net. */
export function scrapBufferQuantity(netQuantity, scrapAllowanceFactor = 0) {
  return grossIssueQuantity(netQuantity, scrapAllowanceFactor) - Math.max(0, Math.trunc(netQuantity ?? 0))
}

/**
 * What a completed run leaves behind. `issued` units went out; `completed`
 * came back branded and `scrapped` did not. The remainder is unused buffer,
 * which stays raw stock. A run that reports more than it was issued is refused
 * by `reconcileRule`, not silently clamped.
 */
export function reconcileCustomizationRun({ issuedQty = 0, completedQty = 0, scrapQty = 0 } = {}) {
  const issued = Math.max(0, Math.trunc(issuedQty))
  const completed = Math.max(0, Math.trunc(completedQty))
  const scrapped = Math.max(0, Math.trunc(scrapQty))
  const consumed = completed + scrapped
  return {
    issuedQty: issued,
    completedQty: completed,
    scrapQty: scrapped,
    unusedBufferQty: Math.max(0, issued - consumed),
    overIssued: consumed > issued,
    scrapRate: issued > 0 ? scrapped / issued : 0,
  }
}

/**
 * Whether a completion may be posted, and whether it leaves the order short of
 * what it promised. `BLOCKED_SHORTAGE` is a state rather than a warning: the
 * order has stock issued, is not finished, and the shop floor needs to see it.
 */
export function customizationCompletionRule(order, { completedQty, scrapQty = 0 }) {
  if (!order) return { ok: false, code: 'CUSTOMIZATION_WORK_ORDER_NOT_FOUND' }
  if (order.status === 'COMPLETED') return { ok: false, code: 'CUSTOMIZATION_WORK_ORDER_COMPLETED' }
  if (order.status === 'CANCELLED') return { ok: false, code: 'CUSTOMIZATION_WORK_ORDER_CANCELLED' }
  if (order.status === 'DRAFT') return { ok: false, code: 'CUSTOMIZATION_WORK_ORDER_NOT_RELEASED' }
  const run = reconcileCustomizationRun({ issuedQty: order.issuedQty, completedQty, scrapQty })
  if (run.overIssued) return { ok: false, code: 'CUSTOMIZATION_WORK_ORDER_OVER_ISSUED' }
  const shortfall = Math.max(0, (order.plannedQty ?? 0) - run.completedQty)
  return { ok: true, code: null, run, shortfall, blocked: shortfall > 0 }
}

/**
 * Whether this product may be issued for this customer and order. A product
 * that is not customer-dedicated is unconstrained; a dedicated one may be
 * issued only for the customer and the sales order it was branded for
 * (BR-028). An issue that names neither — a scrap write-off, a stocktake
 * correction — is allowed, because the alternative is stock nobody can ever
 * write off.
 */
export function dedicationRule(product, { customerId = null, salesOrderId = null, allowUndedicated = true } = {}) {
  if (!product) return { ok: false, code: 'INVENTORY_PRODUCT_NOT_FOUND' }
  const lockedCustomer = product.dedicatedCustomerId ?? null
  const lockedOrder = product.dedicatedSalesOrderId ?? null
  if (!lockedCustomer && !lockedOrder) return { ok: true, code: null }
  if (!customerId && !salesOrderId) {
    return allowUndedicated ? { ok: true, code: null } : { ok: false, code: 'INVENTORY_CUSTOM_COMPONENT_DEDICATED' }
  }
  if (lockedCustomer && customerId && lockedCustomer !== customerId) {
    return { ok: false, code: 'INVENTORY_CUSTOM_COMPONENT_WRONG_CUSTOMER' }
  }
  if (lockedOrder && salesOrderId && lockedOrder !== salesOrderId) {
    return { ok: false, code: 'INVENTORY_CUSTOM_COMPONENT_WRONG_SALES_ORDER' }
  }
  return { ok: true, code: null }
}

// ── FR-177 kitting ──────────────────────────────────────────────────────────

export const zOpenKittingWorkOrder = z.object({
  businessId: zBusinessId,
  recipeId: zId,
  plannedQty: z.number().int().positive(),
  customerId: zId.nullable().optional(),
  salesOrderId: zId.nullable().optional(),
  laborCostSatang: zSatang.optional(),
  sourceLocationId: zId.nullable().optional(),
  wipLocationId: zId.nullable().optional(),
  targetLocationId: zId.nullable().optional(),
  scrapLocationId: zId.nullable().optional(),
  outputLotCode: zCode.nullable().optional(),
  notes: zOptionalText(2000),
}).strict()

export const zCompleteKittingWorkOrder = z.object({
  businessId: zBusinessId,
  version: z.number().int().positive(),
  assembledQty: z.number().int().nonnegative(),
  scrapQty: z.number().int().nonnegative().optional(),
  reason: zOptionalText(500),
  occurredAt: z.coerce.date().optional(),
}).strict()

/**
 * A recipe explosion with the recipe's declared scrap allowance applied to
 * every scaled line. A `fixed` line (one crate per batch, one jig) does not
 * scale and does not get a buffer: you do not need 1.02 crates.
 */
export function explodeWithScrap(explosion, scrapAllowanceFactor = 0) {
  const factor = Math.min(MAX_SCRAP_ALLOWANCE_FACTOR, Math.max(0, Number(scrapAllowanceFactor) || 0))
  const lines = explosion.lines.map((line) => {
    const netQty = Math.ceil(line.required - 1e-9)
    const grossQty = line.fixed ? netQty : grossIssueQuantity(netQty, factor)
    return { ...line, netQty, grossQty, scrapBufferQty: grossQty - netQty }
  })
  return { ...explosion, scrapAllowanceFactor: factor, lines }
}

/**
 * The explosion compared with what is actually available. A counted component
 * reports its shortage against `availableByProductId` (ATP, not raw on-hand —
 * a component another quote already promised is not available to this build);
 * an uncounted one never blocks.
 */
export function kittingRequirements(explosion, availableByProductId = {}) {
  const lines = explosion.lines.map((line) => {
    const available = availableByProductId[line.componentProductId]
    const counted = available !== null && available !== undefined
    const shortage = counted ? Math.max(0, line.grossQty - available) : 0
    return { ...line, available: counted ? available : null, shortage }
  })
  return { ...explosion, lines, canBuild: lines.every((l) => l.shortage === 0) }
}

// ── FR-179 shelf life ───────────────────────────────────────────────────────

/**
 * How long this batch has been in storage since it was last restored, in whole
 * days. `lastMaintainedAt` beats `manufacturedAt` because a recharge resets
 * the clock; a lot with neither date has no measurable age and returns null,
 * which is the honest answer and the one that never blocks.
 */
export function lotStorageAgeDays(lot, now = new Date()) {
  const from = lot?.lastMaintainedAt ?? lot?.manufacturedAt ?? null
  if (!from) return null
  const start = new Date(from).getTime()
  const end = new Date(now).getTime()
  if (!Number.isFinite(start) || !Number.isFinite(end)) return null
  return Math.floor((end - start) / MILLIS_PER_DAY)
}

/**
 * The shelf-life standing of one lot of one product: `OK`, `DUE` (past the
 * maintenance interval — surfaced, never blocked) or `EXPIRED` (past the
 * maximum storage days — refused for issue and for kitting until a maintenance
 * is recorded). A product declaring neither threshold is always `OK`.
 */
export function lotShelfLifeState(product, lot, now = new Date()) {
  const interval = product?.maintenanceIntervalDays ?? null
  const max = product?.maxStorageDays ?? null
  if (!interval && !max) return { state: 'OK', ageDays: lotStorageAgeDays(lot, now), dueInDays: null }
  const ageDays = lotStorageAgeDays(lot, now)
  if (ageDays === null) return { state: 'OK', ageDays: null, dueInDays: null }
  if (max && ageDays > max) return { state: 'EXPIRED', ageDays, dueInDays: 0 }
  if (interval && ageDays >= interval) return { state: 'DUE', ageDays, dueInDays: 0 }
  const nextThreshold = interval ?? max
  return { state: 'OK', ageDays, dueInDays: Math.max(0, nextThreshold - ageDays) }
}

/** Whether a lot may be issued at all, by code, so a pick refuses rather than dispatches a dead battery. */
export function shelfLifeIssueRule(product, lot, now = new Date()) {
  const { state, ageDays } = lotShelfLifeState(product, lot, now)
  if (state === 'EXPIRED') return { ok: false, code: 'INVENTORY_LOT_STORAGE_EXPIRED', ageDays }
  return { ok: true, code: null, ageDays }
}

/**
 * The audit a warehouse asks for: every lot of every ageing product, with its
 * standing and the deadline it is measured against. `lots` carry their product
 * inline so the calculator stays pure.
 */
export function auditShelfLife(lots = [], now = new Date()) {
  const rows = lots.map((entry) => {
    const { product, lot, onHand = null } = entry
    const standing = lotShelfLifeState(product, lot, now)
    const from = lot?.lastMaintainedAt ?? lot?.manufacturedAt ?? null
    const max = product?.maxStorageDays ?? null
    return {
      productId: product?.id ?? null,
      productCode: product?.code ?? null,
      lotId: lot?.id ?? null,
      lotCode: lot?.code ?? null,
      onHand,
      ageDays: standing.ageDays,
      state: standing.state,
      dueInDays: standing.dueInDays,
      maintenanceIntervalDays: product?.maintenanceIntervalDays ?? null,
      maxStorageDays: max,
      lastMaintainedAt: lot?.lastMaintainedAt ?? null,
      manufacturedAt: lot?.manufacturedAt ?? null,
      hardDeadlineAt: from && max ? new Date(new Date(from).getTime() + max * MILLIS_PER_DAY) : null,
    }
  })
  return {
    rows,
    counts: {
      total: rows.length,
      ok: rows.filter((r) => r.state === 'OK').length,
      due: rows.filter((r) => r.state === 'DUE').length,
      expired: rows.filter((r) => r.state === 'EXPIRED').length,
    },
  }
}

// ── FR-180 reservations and ATP ─────────────────────────────────────────────

export const zCreateReservation = z.object({
  businessId: zBusinessId,
  productId: zId,
  quantity: z.number().int().positive(),
  purpose: z.enum(STOCK_RESERVATION_PURPOSES).optional(),
  customerId: zId.nullable().optional(),
  salesOrderId: zId.nullable().optional(),
  quoteReference: zOptionalText(200),
  customerCompany: zOptionalText(200),
  contactHandle: zOptionalText(200),
  holdDays: z.number().int().positive().max(90).optional(),
  expiresAt: z.coerce.date().nullable().optional(),
  notes: zOptionalText(2000),
}).strict()

export const zReservationAction = z.object({
  businessId: zBusinessId,
  action: z.enum(['RELEASE', 'CONVERT']),
  version: z.number().int().positive(),
  salesOrderId: zId.nullable().optional(),
  reason: zOptionalText(500),
}).strict()

/**
 * Whether a reservation still holds stock at this instant. Expiry is decided
 * on read against the clock rather than by a sweeper, so an ATP figure is
 * correct whether or not a worker has run; a sweeper may later stamp the row
 * `EXPIRED` for reporting, and stamping a row every reader already ignores
 * changes no number (BR-031).
 */
export function isReservationLive(reservation, now = new Date()) {
  if (!reservation || reservation.status !== 'ACTIVE') return false
  if (!reservation.expiresAt) return true
  return new Date(reservation.expiresAt).getTime() > new Date(now).getTime()
}

/** When a quote hold placed now runs out. */
export function quoteExpiryAt(now = new Date(), holdDays = DEFAULT_QUOTE_RESERVATION_DAYS) {
  return new Date(new Date(now).getTime() + Math.max(1, Math.trunc(holdDays)) * MILLIS_PER_DAY)
}

/**
 * Available-to-Promise for one product: physical on-hand less what a confirmed
 * order has committed and what a live quote is holding. Never negative — a
 * negative ATP is an over-promise, which the caller sees as `overCommitted`
 * rather than as a number it might subtract again.
 */
export function availableToPromise({ onHand = 0, reservations = [], now = new Date() } = {}) {
  let committed = 0
  let quoted = 0
  for (const reservation of reservations) {
    if (!isReservationLive(reservation, now)) continue
    const qty = Math.max(0, Math.trunc(reservation.quantity ?? 0))
    if (reservation.purpose === 'ORDER') committed += qty
    else quoted += qty
  }
  const raw = onHand - committed - quoted
  return {
    onHand,
    committed,
    reservedForQuotes: quoted,
    available: Math.max(0, raw),
    overCommitted: raw < 0 ? -raw : 0,
  }
}

/**
 * How many complete sets the *available* (not merely on-hand) components allow.
 * ATP rather than on-hand on purpose: two quotes must not both promise the same
 * tumblers. An uncounted component never limits; a fixed line allows the batch
 * or nothing. Null when no line is counted.
 */
export function maxBuildableFromAvailable(recipe, availableByProductId = {}) {
  let limit = null
  for (const line of recipe?.lines ?? []) {
    const available = availableByProductId[line.componentProductId]
    if (available === null || available === undefined) continue
    const allows = line.fixed
      ? (available >= line.qty ? Number.POSITIVE_INFINITY : 0)
      : Math.floor((available / line.qty) * recipe.batchSize)
    limit = limit === null ? allows : Math.min(limit, allows)
  }
  if (limit === Number.POSITIVE_INFINITY) return null
  return limit
}

// ── Work-order codes ────────────────────────────────────────────────────────

/** `YYYYMMDD` in UTC — the same day key Procurement's GRN codes use. */
export function workOrderDayKey(now = new Date()) {
  const d = new Date(now)
  const pad = (n) => String(n).padStart(2, '0')
  return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}`
}

export const customizationWorkOrderCode = (now, seq) => `CWO-${workOrderDayKey(now)}-${String(seq).padStart(3, '0')}`
export const kittingWorkOrderCode = (now, seq) => `KWO-${workOrderDayKey(now)}-${String(seq).padStart(3, '0')}`
export const reservationCode = (now, seq) => `RSV-${workOrderDayKey(now)}-${String(seq).padStart(3, '0')}`
