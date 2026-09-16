import { z } from 'zod'
import {
  INVENTORY_GENERIC_STOCK_LOCATION_TYPES,
  INVENTORY_LOCATION_TYPES,
} from '@/lib/validation/enums'
import { INVENTORY_CODE_PATTERN } from './inventory'

// @req FR-174 — the vocabulary of *where* stock is: the location contract, the
//   transfer contract, and the pure calculators that turn a located ledger
//   into per-location on-hand. No I/O: the transfer service and any page that
//   shows a location bucket compute from the same functions, so they cannot
//   disagree.
// @spec BR-026 (a transfer is one movement pair; a located sum is reported
//   beside the Business-wide total, never instead of it), ADR-074 D1, D2
// @tested tests/unit/warehouse-location.test.js,
//   tests/integration/fr174-warehouse-locations.test.js

export const WAREHOUSE_LOCATION_ENTITY = 'WAREHOUSE_LOCATION'

export const zLocationCode = z.string().trim().regex(INVENTORY_CODE_PATTERN, 'code must be 1–64 letters, digits, ".", "-" or "_"')
const zBusinessId = z.string().trim().min(1).max(200)
const zId = z.string().trim().min(1).max(200)
const zText = (max) => z.string().trim().min(1).max(max)
const zOptionalText = (max) => z.string().trim().max(max).nullable().optional()

export const zCreateLocation = z.object({
  businessId: zBusinessId,
  code: zLocationCode,
  name: zText(200),
  type: z.enum(INVENTORY_LOCATION_TYPES),
  isVirtual: z.boolean().optional(),
  address: zOptionalText(500),
}).strict()

export const zLocationFields = z.object({
  name: zText(200),
  address: zOptionalText(500),
  isVirtual: z.boolean(),
}).strict()

export const zLocationAction = z.object({
  action: z.enum(['UPDATE', 'ARCHIVE']),
  version: z.number().int().positive(),
  fields: zLocationFields.partial().strict().optional(),
}).strict().superRefine((value, ctx) => {
  if (value.action === 'UPDATE' && (!value.fields || Object.keys(value.fields).length === 0)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['fields'], message: 'fields is required for UPDATE' })
  }
})

export const zTransferStock = z.object({
  businessId: zBusinessId,
  productId: zId,
  sourceLocationId: zId,
  targetLocationId: zId,
  quantity: z.number().int().positive(),
  lotId: zId.nullable().optional(),
  lotCode: zLocationCode.nullable().optional(),
  serialNos: z.array(zText(100)).max(500).optional(),
  costSatang: z.number().int().nonnegative().nullable().optional(),
  reason: zOptionalText(500),
  reference: zOptionalText(200),
  occurredAt: z.coerce.date().optional(),
}).strict().superRefine((value, ctx) => {
  if (value.sourceLocationId === value.targetLocationId) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['targetLocationId'], message: 'a transfer needs two different locations' })
  }
  if (value.lotId && value.lotCode) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['lotCode'], message: 'give lotId or lotCode, not both' })
  }
})

const GENERIC_STOCK_TYPES = new Set(INVENTORY_GENERIC_STOCK_LOCATION_TYPES)

/**
 * Whether a location holds freely allocatable, unbranded stock. Branded
 * (customer-dedicated) stock may never be transferred into one of these
 * (BR-028) — that is the move that would launder a logo back into the pool.
 */
export function isGenericStockLocation(location) {
  return Boolean(location) && GENERIC_STOCK_TYPES.has(location.type)
}

/**
 * Whether a movement is allowed to name these locations, answered by code so
 * the service refuses rather than recording a transfer nobody can explain.
 */
export function transferRule({ product, source, target }) {
  if (!source || source.status === 'ARCHIVED') return { ok: false, code: 'WAREHOUSE_LOCATION_NOT_FOUND' }
  if (!target || target.status === 'ARCHIVED') return { ok: false, code: 'WAREHOUSE_LOCATION_NOT_FOUND' }
  if (source.id === target.id) return { ok: false, code: 'WAREHOUSE_TRANSFER_SAME_LOCATION' }
  if (source.businessId !== target.businessId) return { ok: false, code: 'WAREHOUSE_LOCATION_NOT_FOUND' }
  if (product && product.businessId !== source.businessId) return { ok: false, code: 'INVENTORY_PRODUCT_NOT_FOUND' }
  // BR-028 — the one transfer the ledger must never accept.
  if (product?.itemKind === 'CUSTOM_COMPONENT' && isGenericStockLocation(target)) {
    return { ok: false, code: 'INVENTORY_CUSTOM_COMPONENT_NOT_RETURNABLE' }
  }
  return { ok: true, code: null }
}

/**
 * On-hand per location from a Business's located movements. A movement's
 * quantity is signed (FR-155): an ISSUE carrying a `sourceLocationId` leaves
 * that location, a RECEIPT carrying a `targetLocationId` arrives at one. A row
 * with neither — everything written before ADR-074 — lands under `null`, which
 * is why a located total is reported beside the Business-wide sum rather than
 * instead of it (BR-026).
 */
export function onHandByLocation(movements = []) {
  const byLocation = new Map()
  const bump = (locationId, delta) => {
    byLocation.set(locationId, (byLocation.get(locationId) ?? 0) + delta)
  }
  for (const movement of movements) {
    const qty = typeof movement.quantity === 'number' ? movement.quantity : 0
    if (qty === 0) continue
    if (qty > 0) bump(movement.targetLocationId ?? null, qty)
    else bump(movement.sourceLocationId ?? null, qty)
  }
  return byLocation
}

/**
 * The located view of one product: a row per location that holds any of it,
 * the unlocated remainder, and the Business-wide total the two must add up to.
 * `located` never claims to be the whole picture — `unlocated` is what says so.
 */
export function locatedStockSummary(movements = [], locationsById = new Map()) {
  const byLocation = onHandByLocation(movements)
  const unlocated = byLocation.get(null) ?? 0
  const located = [...byLocation.entries()]
    .filter(([locationId]) => locationId !== null)
    .map(([locationId, onHand]) => {
      const location = locationsById.get?.(locationId) ?? locationsById[locationId] ?? null
      return {
        locationId,
        code: location?.code ?? null,
        name: location?.name ?? null,
        type: location?.type ?? null,
        isVirtual: location?.isVirtual ?? null,
        onHand,
      }
    })
    .sort((a, b) => (a.code ?? '').localeCompare(b.code ?? ''))
  const total = located.reduce((sum, row) => sum + row.onHand, 0) + unlocated
  return { located, unlocated, total }
}

/** On-hand at one location, from the same signed rows. */
export function onHandAtLocation(movements = [], locationId) {
  return onHandByLocation(movements).get(locationId) ?? 0
}
