import { z } from 'zod'

// @req FR-092
// @spec SDD-049, ADR-038
// @tested tests/unit/market-intelligence/supplier-candidate-domain.test.js

export const zSupplierCandidateDraft = z.object({
  id: z.string().min(1).optional(),
  tenantId: z.string().min(1),
  businessId: z.string().min(1).nullable(),
  name: z.string().min(1),
  externalId: z.string().min(1).nullable().optional(),
  sourceProvider: z.string().min(1),
  sourceUri: z.string().min(1).nullable().optional(),
  rating: z.number().min(0).max(5).nullable().optional(),
  reviewCount: z.number().nonnegative().default(0),
  categories: z.array(z.string().min(1)).default([]),
  location: z.string().min(1).nullable().optional(),
  verified: z.boolean().default(false),
  observedAt: z.coerce.date(),
}).strict()

export function normalizeSupplierCandidateDraft(input) {
  const parsed = zSupplierCandidateDraft.parse(input)
  return {
    ...parsed,
    externalId: parsed.externalId ?? null,
    sourceUri: parsed.sourceUri ?? null,
    rating: parsed.rating ?? null,
    location: parsed.location ?? null,
  }
}

/**
 * Calculate evidence-backed score for a supplier candidate (0 - 100).
 * Balances rating, observation volume, and reliability signals.
 */
export function calculateSupplierScore(candidate, observations = []) {
  let score = 50 // Base score

  // 1. Rating contribution (up to +25 points)
  if (candidate.rating != null && candidate.rating > 0) {
    const ratingBonus = (candidate.rating / 5) * 25
    score += ratingBonus
  }

  // 2. Verified status (+10 points)
  if (candidate.verified) {
    score += 10
  }

  // 3. Evidence Volume (observations count, up to +15 points)
  const count = observations.length || candidate.reviewCount || 0
  if (count > 0) {
    const volumeBonus = Math.min(15, Math.log10(count + 1) * 10)
    score += volumeBonus
  }

  return Math.min(100, Math.round(score * 10) / 10)
}
