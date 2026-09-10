import { createHash, randomUUID } from 'node:crypto'
import { z } from 'zod'

// @req FR-184 — the physical stocktake input is deliberately narrower than
// the general ledger: only NONE and LOT observations are accepted. SERIAL is
// refused until a separate serial-observation contract exists.
// @spec ADR-074 D1, D2; BR-002, BR-008, BR-012, BR-026; SEC-001
// @tested tests/unit/inventory-stocktake-domain.test.js,
//   tests/integration/fr184-inventory-stocktake.test.js,
//   tests/integration/fr184-inventory-stocktake-backup.test.js

export const INVENTORY_STOCKTAKE_ENTITY = 'INVENTORY_STOCKTAKE'
export const INVENTORY_STOCKTAKE_STATUSES = Object.freeze(['PREVIEWED', 'COMMITTED'])
export const INVENTORY_STOCKTAKE_MAX_LINES = 500
export const INT32_MAX = 2_147_483_647

const zUuid = z.string().uuid()
const zIdempotencyKey = z.string().trim().min(1).max(200)
const zCount = z.number().int().nonnegative().max(INT32_MAX)

export const zStocktakeLine = z.object({
  // Explicit null is the unlocated bucket. Omitting locationId is invalid so
  // the caller cannot accidentally turn a missing location into unlocated.
  locationId: zUuid.nullable(),
  productId: zUuid,
  lotId: zUuid.nullable(),
  countedQuantity: zCount,
}).strict()

export const zStocktakePreviewInput = z.object({
  businessId: zUuid,
  lines: z.array(zStocktakeLine).min(1).max(INVENTORY_STOCKTAKE_MAX_LINES),
}).strict()

export const zStocktakeCommitInput = z.object({
  businessId: zUuid,
  previewId: zUuid,
  snapshotToken: z.string().trim().min(1).max(128),
  idempotencyKey: zIdempotencyKey,
  lines: z.array(zStocktakeLine).min(1).max(INVENTORY_STOCKTAKE_MAX_LINES),
}).strict()

export function stocktakeLineKey(line) {
  return [line.productId, line.locationId ?? 'UNLOCATED', line.lotId ?? 'NO_LOT'].join('|')
}

export function normalizeStocktakeLines(lines) {
  const normalized = lines.map((line) => ({
    productId: line.productId.trim(),
    locationId: line.locationId === null ? null : line.locationId.trim(),
    lotId: line.lotId === null ? null : line.lotId.trim(),
    countedQuantity: line.countedQuantity,
  }))
  const seen = new Set()
  for (const line of normalized) {
    const key = stocktakeLineKey(line)
    if (seen.has(key)) throw Object.assign(new Error('INVENTORY_STOCKTAKE_DUPLICATE_LINE'), { status: 422 })
    seen.add(key)
  }
  return normalized.sort((a, b) => stocktakeLineKey(a).localeCompare(stocktakeLineKey(b)))
}

export function hashStocktake(value) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex')
}

export function newStocktakePreviewId() {
  return randomUUID()
}

export function assertInt32(value, code = 'INVENTORY_STOCKTAKE_AMOUNT_OUT_OF_RANGE') {
  if (!Number.isInteger(value) || value < -INT32_MAX - 1 || value > INT32_MAX) {
    throw Object.assign(new Error(code), { status: 422 })
  }
  return value
}
