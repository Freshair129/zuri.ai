import { z } from 'zod'

// Phase #76 canonical domain shape. Prisma will persist this contract later in
// the same issue; persistence is a projection of this domain meaning, not its
// source of truth.
// @spec ADR-038

export const MARKET_RESOLUTION_STATUS = Object.freeze({
  RESOLVED: 'RESOLVED',
  PARTIAL: 'PARTIAL',
  UNRESOLVED: 'UNRESOLVED',
})

const sha256 = z.string().regex(/^[a-f0-9]{64}$/i, 'must be a SHA-256 hex digest')

export const zMarketObservationDraft = z.object({
  tenantId: z.string().min(1),
  businessId: z.string().min(1).nullable(),
  rawRecordId: z.string().min(1),
  connectionId: z.string().min(1),
  provider: z.string().min(1),
  sourceEntityType: z.string().min(1),
  externalId: z.string().min(1),
  sourcePayloadHash: sha256,
  sourceUri: z.string().min(1).nullable(),
  translationSchemaVersion: z.string().min(1),
  observationType: z.string().min(1),
  candidateJson: z.string().min(2),
  canonicalProductRef: z.string().min(1).nullable(),
  canonicalCategoryRef: z.string().min(1).nullable(),
  resolutionStatus: z.enum(Object.values(MARKET_RESOLUTION_STATUS)),
  resolutionConfidence: z.number().min(0).max(1).nullable(),
  observedAt: z.coerce.date(),
  translatedAt: z.coerce.date(),
  lineageKey: sha256,
}).strict().superRefine((value, ctx) => {
  const hasCanonicalRef = Boolean(value.canonicalProductRef || value.canonicalCategoryRef)

  if (value.resolutionStatus === MARKET_RESOLUTION_STATUS.RESOLVED && !hasCanonicalRef) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['resolutionStatus'],
      message: 'RESOLVED requires at least one canonical identity reference',
    })
  }

  if (value.resolutionStatus === MARKET_RESOLUTION_STATUS.UNRESOLVED && hasCanonicalRef) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['resolutionStatus'],
      message: 'UNRESOLVED cannot carry a canonical identity reference',
    })
  }
})

export function normalizeMarketObservationDraft(input) {
  const parsed = zMarketObservationDraft.parse(input)

  try {
    const candidate = JSON.parse(parsed.candidateJson)
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) {
      throw new Error('candidate must be an object')
    }
  } catch (error) {
    throw new Error(`MarketObservation.candidateJson is invalid: ${error.message}`)
  }

  return parsed
}
