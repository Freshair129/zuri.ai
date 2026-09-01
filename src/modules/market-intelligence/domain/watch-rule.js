import { z } from 'zod'

// @req FR-092
// @spec SDD-049, ADR-038
// @tested tests/unit/market-intelligence/price-observation-domain.test.js

export const zWatchRuleDraft = z.object({
  id: z.string().min(1).optional(),
  tenantId: z.string().min(1),
  businessId: z.string().min(1).nullable(),
  name: z.string().min(1),
  query: z.string().min(1),
  excludeKeywords: z.array(z.string().min(1)).default([]),
  maxPrice: z.number().positive().nullable().optional(),
  minPrice: z.number().nonnegative().nullable().optional(),
  currency: z.string().length(3).default('THB'),
  condition: z.enum(['NEW', 'USED', 'REFURBISHED', 'ANY']).default('ANY'),
  intent: z.enum(['BUY', 'SELL', 'AUCTION', 'ANY']).default('ANY'),
  active: z.boolean().default(true),
  notificationChannel: z.enum(['LINE', 'EMAIL', 'WEBHOOK', 'IN_APP']).default('IN_APP'),
  createdAt: z.coerce.date().optional(),
}).strict()

export function normalizeWatchRuleDraft(input) {
  const parsed = zWatchRuleDraft.parse(input)
  return {
    ...parsed,
    excludeKeywords: (parsed.excludeKeywords || []).map((k) => k.trim().toLowerCase()).filter(Boolean),
    maxPrice: parsed.maxPrice ?? null,
    minPrice: parsed.minPrice ?? null,
  }
}

export function evaluateWatchRule(rule, observation) {
  if (!rule.active) {
    return { matched: false, reason: 'RULE_INACTIVE' }
  }

  // Tenant isolation check
  if (rule.tenantId !== observation.tenantId) {
    return { matched: false, reason: 'TENANT_MISMATCH' }
  }
  if (rule.businessId && observation.businessId && rule.businessId !== observation.businessId) {
    return { matched: false, reason: 'BUSINESS_MISMATCH' }
  }

  const title = (observation.productTitle || '').toLowerCase()
  const queryLower = (rule.query || '').toLowerCase().trim()

  // 1. Target Query Match
  if (queryLower && !title.includes(queryLower)) {
    return { matched: false, reason: 'QUERY_NOT_MATCHED' }
  }

  // 2. Exclude Keywords Check
  const exclusions = rule.excludeKeywords || []
  for (const exclude of exclusions) {
    if (exclude && title.includes(exclude.toLowerCase())) {
      return { matched: false, reason: `EXCLUDED_BY_KEYWORD: ${exclude}` }
    }
  }

  // 3. Price Checks
  const effectivePrice = observation.unitPrice ?? observation.rawPrice
  if (rule.maxPrice != null && effectivePrice > rule.maxPrice) {
    return { matched: false, reason: `PRICE_ABOVE_MAX: ${effectivePrice} > ${rule.maxPrice}` }
  }
  if (rule.minPrice != null && effectivePrice < rule.minPrice) {
    return { matched: false, reason: `PRICE_BELOW_MIN: ${effectivePrice} < ${rule.minPrice}` }
  }

  // 4. Condition Check
  if (rule.condition && rule.condition !== 'ANY') {
    if (observation.condition && observation.condition !== 'UNKNOWN' && observation.condition !== rule.condition) {
      return { matched: false, reason: `CONDITION_MISMATCH: ${observation.condition} !== ${rule.condition}` }
    }
  }

  // 5. Intent Check
  if (rule.intent && rule.intent !== 'ANY') {
    if (observation.intent && observation.intent !== 'UNKNOWN' && observation.intent !== rule.intent) {
      return { matched: false, reason: `INTENT_MISMATCH: ${observation.intent} !== ${rule.intent}` }
    }
  }

  return {
    matched: true,
    matchedRuleId: rule.id,
    ruleName: rule.name,
    observationTitle: observation.productTitle,
    effectivePrice,
    currency: observation.currency,
  }
}
