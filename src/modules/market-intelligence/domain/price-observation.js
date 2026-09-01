import { z } from 'zod'

// @req FR-092
// @spec SDD-049, ADR-038
// @tested tests/unit/market-intelligence/price-observation-domain.test.js

const ISO_CURRENCY = z.string().regex(/^[A-Z]{3}$/, 'must be a 3-letter ISO-4217 currency code')

export const zPriceObservationDraft = z.object({
  tenantId: z.string().min(1),
  businessId: z.string().min(1).nullable(),
  marketObservationId: z.string().min(1).optional(),
  rawRecordId: z.string().min(1),
  sourceProvider: z.string().min(1),
  productTitle: z.string().min(1),
  canonicalProductRef: z.string().min(1).nullable().optional(),
  canonicalCategoryRef: z.string().min(1).nullable().optional(),
  rawPrice: z.number().nonnegative(),
  currency: ISO_CURRENCY.default('THB'),
  bundleQuantity: z.number().positive().default(1),
  unitPrice: z.number().nonnegative().optional(),
  condition: z.enum(['NEW', 'USED', 'REFURBISHED', 'UNKNOWN']).default('UNKNOWN'),
  intent: z.enum(['BUY', 'SELL', 'AUCTION', 'UNKNOWN']).default('UNKNOWN'),
  sellerName: z.string().min(1).nullable().optional(),
  sellerRating: z.number().min(0).max(5).nullable().optional(),
  sourceUri: z.string().min(1).nullable().optional(),
  observedAt: z.coerce.date(),
}).strict()

export function calculateNormalizedUnitPrice(rawPrice, bundleQuantity = 1) {
  if (bundleQuantity <= 0 || !Number.isFinite(bundleQuantity)) {
    throw new Error('bundleQuantity must be a positive finite number')
  }
  if (rawPrice < 0 || !Number.isFinite(rawPrice)) {
    throw new Error('rawPrice must be a non-negative finite number')
  }
  const unitPrice = rawPrice / bundleQuantity
  return Math.round(unitPrice * 100) / 100
}

export function normalizePriceObservationDraft(input) {
  const parsed = zPriceObservationDraft.parse(input)
  const bundleQty = parsed.bundleQuantity ?? 1
  const unitPrice = parsed.unitPrice ?? calculateNormalizedUnitPrice(parsed.rawPrice, bundleQty)
  return {
    ...parsed,
    bundleQuantity: bundleQty,
    unitPrice,
    canonicalProductRef: parsed.canonicalProductRef ?? null,
    canonicalCategoryRef: parsed.canonicalCategoryRef ?? null,
    sellerName: parsed.sellerName ?? null,
    sellerRating: parsed.sellerRating ?? null,
    sourceUri: parsed.sourceUri ?? null,
  }
}
