import { z } from 'zod'

// @req FR-092
// @spec SDD-049, ADR-038
// @tested tests/unit/market-intelligence/market-signals-domain.test.js

export const zCompetitorSignalDraft = z.object({
  id: z.string().min(1).optional(),
  tenantId: z.string().min(1),
  businessId: z.string().min(1).nullable(),
  competitorName: z.string().min(1),
  productTitle: z.string().min(1),
  signalType: z.enum(['PRICE_DROP', 'PRICE_HIKE', 'NEW_PROMOTION', 'STOCK_OUT', 'NEW_ASSORTMENT']),
  previousPrice: z.number().nonnegative().nullable().optional(),
  currentPrice: z.number().nonnegative(),
  currency: z.string().length(3).default('THB'),
  changePercent: z.number().optional(),
  confidence: z.number().min(0).max(1).default(1),
  detectedAt: z.coerce.date(),
}).strict()

export const zDemandSignalDraft = z.object({
  id: z.string().min(1).optional(),
  tenantId: z.string().min(1),
  businessId: z.string().min(1).nullable(),
  category: z.string().min(1),
  intentTrend: z.enum(['RISING', 'STABLE', 'FALLING']),
  velocityScore: z.number().min(0).max(100),
  observedListingsCount: z.number().nonnegative(),
  periodStart: z.coerce.date(),
  periodEnd: z.coerce.date(),
}).strict()

export function calculatePriceChangePercent(previousPrice, currentPrice) {
  if (previousPrice == null || previousPrice <= 0) return 0
  const diff = currentPrice - previousPrice
  return Math.round((diff / previousPrice) * 10000) / 100
}

export function normalizeCompetitorSignalDraft(input) {
  const parsed = zCompetitorSignalDraft.parse(input)
  const changePercent =
    parsed.changePercent ?? calculatePriceChangePercent(parsed.previousPrice, parsed.currentPrice)
  return {
    ...parsed,
    previousPrice: parsed.previousPrice ?? null,
    changePercent,
  }
}

export function normalizeDemandSignalDraft(input) {
  return zDemandSignalDraft.parse(input)
}
