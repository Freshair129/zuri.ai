import { createHash } from 'node:crypto'
import { z } from 'zod'

// @req FR-155 — Marketing Strategy plans accept one bounded, strict payload and
// persist immutable revisions whose hash includes the plan identity.
// @spec SDD-086, BR-001, SEC-001
// @tested tests/unit/marketing/marketing-plan-contract.test.js,
//   tests/integration/marketing-plan.test.js

export const MARKETING_PLAN_CHANNELS = Object.freeze([
  'META_ADS',
  'TIKTOK_ADS',
  'INSTAGRAM',
  'GA4',
  'SEO',
])

export const MARKETING_PLAN_STATUSES = Object.freeze(['DRAFT', 'APPROVED', 'ARCHIVED'])
export const MARKETING_PLAN_REVIEW_VERDICTS = Object.freeze(['PASS', 'CHANGES_REQUIRED'])
export const MARKETING_PLAN_DECISION_VERDICTS = Object.freeze(['APPROVE', 'REJECT', 'REVOKE'])

// Bounds are deliberately kept here with the input contract. The service and
// routes must not silently accept a larger shape that a future UI cannot render.
export const MARKETING_PLAN_LIMITS = Object.freeze({
  title: 200,
  text: 4000,
  actionTitle: 240,
  rationale: 4000,
  actions: 50,
  channels: MARKETING_PLAN_CHANNELS.length,
  budget: 1_000_000_000_000,
})

const nonEmptyText = (name, max) => z
  .string()
  .trim()
  .min(1, `${name} is required`)
  .max(max, `${name} is too long`)

export const zMarketingPlanTitle = nonEmptyText('title', MARKETING_PLAN_LIMITS.title)
export const zMarketingPlanRationale = nonEmptyText('rationale', MARKETING_PLAN_LIMITS.rationale)

const zMarketingPlanAction = z.object({
  title: nonEmptyText('action title', MARKETING_PLAN_LIMITS.actionTitle),
}).strict()

const zChannels = z.array(z.enum(MARKETING_PLAN_CHANNELS))
  .min(1, 'at least one channel is required')
  .max(MARKETING_PLAN_LIMITS.channels, 'too many channels')
  .superRefine((channels, context) => {
    if (new Set(channels).size !== channels.length) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: 'channels must be unique' })
    }
  })

export const zMarketingPlanPayload = z.object({
  objective: nonEmptyText('objective', MARKETING_PLAN_LIMITS.text),
  situation: nonEmptyText('situation', MARKETING_PLAN_LIMITS.text),
  audience: nonEmptyText('audience', MARKETING_PLAN_LIMITS.text),
  channels: zChannels,
  budget: z.number().finite().min(0).max(MARKETING_PLAN_LIMITS.budget),
  currency: z.string().regex(/^[A-Z]{3}$/, 'currency must be a three-letter uppercase code'),
  successMetric: nonEmptyText('successMetric', MARKETING_PLAN_LIMITS.text),
  actions: z.array(zMarketingPlanAction)
    .min(1, 'at least one action is required')
    .max(MARKETING_PLAN_LIMITS.actions, 'too many actions'),
}).strict()

const zBusinessId = nonEmptyText('businessId', 100)
const zPlanId = nonEmptyText('planId', 100)
const zPlanVersionId = nonEmptyText('planVersionId', 100)
const zPayloadHash = z.string().regex(/^[a-f0-9]{64}$/, 'payloadHash must be a SHA-256 hex digest')
const zExpectedVersion = z.number().int().min(1)

export const zMarketingPlanCreateInput = z.object({
  businessId: zBusinessId,
  title: zMarketingPlanTitle,
  payload: zMarketingPlanPayload,
}).strict()

export const zMarketingPlanRevisionInput = z.object({
  businessId: zBusinessId,
  expectedVersion: zExpectedVersion,
  title: zMarketingPlanTitle,
  payload: zMarketingPlanPayload,
}).strict()

export const zMarketingPlanReviewInput = z.object({
  businessId: zBusinessId,
  expectedVersion: zExpectedVersion,
  action: z.literal('review'),
  planVersionId: zPlanVersionId,
  payloadHash: zPayloadHash,
  verdict: z.enum(MARKETING_PLAN_REVIEW_VERDICTS),
  rationale: zMarketingPlanRationale,
}).strict()

export const zMarketingPlanDecisionInput = z.object({
  businessId: zBusinessId,
  expectedVersion: zExpectedVersion,
  action: z.literal('decide'),
  planVersionId: zPlanVersionId,
  payloadHash: zPayloadHash,
  reviewId: zPlanId.optional(),
  verdict: z.enum(MARKETING_PLAN_DECISION_VERDICTS),
  rationale: zMarketingPlanRationale,
  expiresAt: z.string().datetime({ offset: true }).optional(),
}).strict()

export const zMarketingPlanArchiveInput = z.object({
  businessId: zBusinessId,
  expectedVersion: zExpectedVersion,
  action: z.literal('archive'),
}).strict()

export const zMarketingPlanReviseActionInput = zMarketingPlanRevisionInput.extend({
  action: z.literal('revise'),
})

export const zMarketingPlanActionInput = z.discriminatedUnion('action', [
  zMarketingPlanReviseActionInput,
  zMarketingPlanReviewInput,
  zMarketingPlanDecisionInput,
  zMarketingPlanArchiveInput,
])

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize)
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, canonicalize(value[key])]),
    )
  }
  return value
}

/**
 * The title is part of the signed content even though it remains a Plan field.
 * A title edit therefore creates a new revision and cannot retain an old review.
 */
export function canonicalMarketingPlanContent({ title, payload }) {
  const normalizedTitle = zMarketingPlanTitle.parse(title)
  const normalizedPayload = zMarketingPlanPayload.parse(payload)
  return JSON.stringify(canonicalize({ title: normalizedTitle, payload: normalizedPayload }))
}

export function hashMarketingPlanContent({ title, payload }) {
  return createHash('sha256')
    .update(canonicalMarketingPlanContent({ title, payload }))
    .digest('hex')
}

/**
 * Store the identity beside the payload so historical revisions remain
 * independently inspectable if the parent Plan title changes later.
 */
export function serializeMarketingPlanVersion({ title, payload }) {
  const normalizedTitle = zMarketingPlanTitle.parse(title)
  const normalizedPayload = zMarketingPlanPayload.parse(payload)
  return JSON.stringify({ title: normalizedTitle, payload: normalizedPayload })
}

export function parseMarketingPlanVersionPayload(payloadJson) {
  let parsed
  try {
    parsed = JSON.parse(payloadJson)
  } catch {
    throw new Error('Marketing plan version payload is invalid JSON')
  }

  if (
    !parsed ||
    typeof parsed !== 'object' ||
    Array.isArray(parsed) ||
    typeof parsed.title !== 'string' ||
    !Object.prototype.hasOwnProperty.call(parsed, 'payload')
  ) {
    throw new Error('Marketing plan version payload must contain an immutable title and payload')
  }

  return {
    title: zMarketingPlanTitle.parse(parsed.title),
    payload: zMarketingPlanPayload.parse(parsed.payload),
  }
}

export function parseMarketingPlanPayload(payload) {
  return zMarketingPlanPayload.parse(payload)
}

export function isFiniteFutureDate(value, now = new Date()) {
  return value instanceof Date && Number.isFinite(value.getTime()) && value.getTime() > now.getTime()
}
