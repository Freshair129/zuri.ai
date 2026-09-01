import { z } from 'zod'

// @req FR-092
// @spec SDD-049, ADR-038
// @tested tests/unit/market-intelligence/market-research-domain.test.js

export const zMarketResearchRunDraft = z.object({
  id: z.string().min(1).optional(),
  tenantId: z.string().min(1),
  businessId: z.string().min(1).nullable(),
  researchQuestion: z.string().min(1),
  categoryScope: z.string().min(1).nullable().optional(),
  productScope: z.string().min(1).nullable().optional(),
  findingsSummary: z.string().min(1),
  minObservedPrice: z.number().nonnegative().nullable().optional(),
  maxObservedPrice: z.number().nonnegative().nullable().optional(),
  avgObservedPrice: z.number().nonnegative().nullable().optional(),
  currency: z.string().length(3).default('THB'),
  evidenceCount: z.number().nonnegative().default(0),
  confidenceScore: z.number().min(0).max(1).default(1),
  executedAt: z.coerce.date(),
}).strict()

export function normalizeMarketResearchRunDraft(input) {
  const parsed = zMarketResearchRunDraft.parse(input)
  return {
    ...parsed,
    categoryScope: parsed.categoryScope ?? null,
    productScope: parsed.productScope ?? null,
    minObservedPrice: parsed.minObservedPrice ?? null,
    maxObservedPrice: parsed.maxObservedPrice ?? null,
    avgObservedPrice: parsed.avgObservedPrice ?? null,
  }
}
