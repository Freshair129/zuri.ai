import { createHash } from 'node:crypto'
import { z } from 'zod'

import { MARKETING_PLAN_CHANNELS } from './marketing-plan-contract'

// @req FR-157 — Marketing Content briefs use a distinct bounded payload whose
// immutable revisions bind file fingerprints, rights and PM references.
// @spec SDD-088, BR-001, SEC-001
// @tested tests/unit/marketing/marketing-content-contract.test.js,
//   tests/integration/marketing-content.test.js

export const MARKETING_CONTENT_FORMATS = Object.freeze([
  'IMAGE',
  'VIDEO',
  'COPY',
  'CAROUSEL',
  'OTHER',
])

export const MARKETING_CONTENT_STATUSES = Object.freeze(['OPEN', 'ARCHIVED'])
export const MARKETING_CONTENT_REVIEW_VERDICTS = Object.freeze(['PASS', 'CHANGES_REQUIRED'])
export const MARKETING_CONTENT_DECISION_VERDICTS = Object.freeze(['APPROVE', 'REJECT', 'REVOKE'])

export const MARKETING_CONTENT_LIMITS = Object.freeze({
  title: 200,
  text: 4000,
  rationale: 4000,
  proof: 4000,
  channels: MARKETING_PLAN_CHANNELS.length,
})

const nonEmptyText = (name, max = MARKETING_CONTENT_LIMITS.text) => z
  .string()
  .trim()
  .min(1, `${name} is required`)
  .max(max, `${name} is too long`)

const zBusinessId = nonEmptyText('businessId', 100)
const zBriefId = nonEmptyText('briefId', 100)
const zContentVersionId = nonEmptyText('contentVersionId', 100)
const zPayloadHash = z.string().regex(/^[a-f0-9]{64}$/, 'payloadHash must be a SHA-256 hex digest')
const zExpectedVersion = z.number().int().min(1)
const zFileId = nonEmptyText('fileId', 100)
const zProjectId = nonEmptyText('projectId', 100)
const zWorkItemId = nonEmptyText('workItemId', 100)
const zInitiativeId = nonEmptyText('initiativeId', 100)
const zChannels = z.array(z.enum(MARKETING_PLAN_CHANNELS))
  .min(1, 'at least one channel is required')
  .max(MARKETING_CONTENT_LIMITS.channels, 'too many channels')
  .superRefine((channels, context) => {
    if (new Set(channels).size !== channels.length) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: 'channels must be unique' })
    }
  })

const zRightsDates = z.string().datetime({ offset: true })
const zRights = z.object({
  holder: nonEmptyText('rights.holder'),
  license: nonEmptyText('rights.license'),
  channels: zChannels,
  validFrom: zRightsDates,
  validUntil: zRightsDates,
  proof: nonEmptyText('rights.proof', MARKETING_CONTENT_LIMITS.proof),
}).strict().superRefine((rights, context) => {
  const validFrom = new Date(rights.validFrom)
  const validUntil = new Date(rights.validUntil)
  if (!Number.isFinite(validFrom.getTime()) || !Number.isFinite(validUntil.getTime()) || validFrom >= validUntil) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['validUntil'], message: 'rights.validUntil must be after validFrom' })
  }
})

const zPersistedAsset = z.object({
  fileId: zFileId,
  fileVersion: z.number().int().positive(),
  sha256: zPayloadHash,
}).strict()

const zClientAsset = z.object({
  fileId: zFileId,
}).strict()

const zProduction = z.object({
  projectId: zProjectId,
  workItemId: zWorkItemId,
}).strict()

const zPayloadCore = {
  objective: nonEmptyText('objective'),
  audience: nonEmptyText('audience'),
  message: nonEmptyText('message'),
  claims: nonEmptyText('claims'),
  shotList: nonEmptyText('shotList'),
  acceptanceCriteria: nonEmptyText('acceptanceCriteria'),
  evidenceReference: nonEmptyText('evidenceReference'),
  format: z.enum(MARKETING_CONTENT_FORMATS),
  initiativeId: zInitiativeId.nullable().default(null),
  channels: zChannels,
  rights: zRights.nullable().default(null),
  production: zProduction.nullable().default(null),
}

function withReferenceInvariants(assetSchema) {
  return z.object({ ...zPayloadCore, asset: assetSchema.nullable().default(null) })
    .strict()
    .superRefine((payload, context) => {
      if (payload.asset === null && payload.rights !== null) {
        context.addIssue({ code: z.ZodIssueCode.custom, path: ['rights'], message: 'rights require an asset' })
      }
      if (payload.asset !== null && payload.rights === null) {
        context.addIssue({ code: z.ZodIssueCode.custom, path: ['rights'], message: 'rights are required when an asset is bound' })
      }
      if (payload.rights) {
        const allowed = new Set(payload.rights.channels)
        if (payload.channels.some((channel) => !allowed.has(channel))) {
          context.addIssue({ code: z.ZodIssueCode.custom, path: ['rights', 'channels'], message: 'rights must cover every intended channel' })
        }
      }
    })
}

/** Client-facing payload: only a FileAsset id may cross the API boundary. */
export const zMarketingContentPayloadInput = withReferenceInvariants(zClientAsset)

/** Persisted payload: the server-resolved FileAsset version and fingerprint. */
export const zMarketingContentPayload = withReferenceInvariants(zPersistedAsset)

export const zMarketingContentTitle = nonEmptyText('title', MARKETING_CONTENT_LIMITS.title)
export const zMarketingContentRationale = nonEmptyText('rationale', MARKETING_CONTENT_LIMITS.rationale)

export const zMarketingContentCreateInput = z.object({
  businessId: zBusinessId,
  title: zMarketingContentTitle,
  payload: zMarketingContentPayloadInput,
}).strict()

export const zMarketingContentRevisionInput = z.object({
  businessId: zBusinessId,
  expectedVersion: zExpectedVersion,
  title: zMarketingContentTitle,
  payload: zMarketingContentPayloadInput,
}).strict()

export const zMarketingContentReviewInput = z.object({
  businessId: zBusinessId,
  expectedVersion: zExpectedVersion,
  action: z.literal('review'),
  contentVersionId: zContentVersionId,
  payloadHash: zPayloadHash,
  verdict: z.enum(MARKETING_CONTENT_REVIEW_VERDICTS),
  rationale: zMarketingContentRationale,
  rightsConfirmed: z.boolean(),
  brandConfirmed: z.boolean(),
}).strict()

export const zMarketingContentDecisionInput = z.object({
  businessId: zBusinessId,
  expectedVersion: zExpectedVersion,
  action: z.literal('decide'),
  contentVersionId: zContentVersionId,
  payloadHash: zPayloadHash,
  reviewId: zBriefId.optional(),
  verdict: z.enum(MARKETING_CONTENT_DECISION_VERDICTS),
  rationale: zMarketingContentRationale,
  expiresAt: z.string().datetime({ offset: true }).optional(),
}).strict()

export const zMarketingContentArchiveInput = z.object({
  businessId: zBusinessId,
  expectedVersion: zExpectedVersion,
  action: z.literal('archive'),
}).strict()

export const zMarketingContentReviseActionInput = zMarketingContentRevisionInput.extend({
  action: z.literal('revise'),
})

export const zMarketingContentActionInput = z.discriminatedUnion('action', [
  zMarketingContentReviseActionInput,
  zMarketingContentReviewInput,
  zMarketingContentDecisionInput,
  zMarketingContentArchiveInput,
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

export function canonicalMarketingContentContent({ title, payload }) {
  const normalizedTitle = zMarketingContentTitle.parse(title)
  const normalizedPayload = zMarketingContentPayload.parse(payload)
  return JSON.stringify(canonicalize({ title: normalizedTitle, payload: normalizedPayload }))
}

export function hashMarketingContentContent({ title, payload }) {
  return createHash('sha256')
    .update(canonicalMarketingContentContent({ title, payload }))
    .digest('hex')
}

export function serializeMarketingContentVersion({ title, payload }) {
  const normalizedTitle = zMarketingContentTitle.parse(title)
  const normalizedPayload = zMarketingContentPayload.parse(payload)
  return JSON.stringify({ title: normalizedTitle, payload: normalizedPayload })
}

export function parseMarketingContentVersionPayload(payloadJson) {
  let parsed
  try {
    parsed = JSON.parse(payloadJson)
  } catch {
    throw new Error('Marketing content version payload is invalid JSON')
  }
  if (
    !parsed ||
    typeof parsed !== 'object' ||
    Array.isArray(parsed) ||
    typeof parsed.title !== 'string' ||
    !Object.prototype.hasOwnProperty.call(parsed, 'payload')
  ) {
    throw new Error('Marketing content version payload must contain an immutable title and payload')
  }
  return {
    title: zMarketingContentTitle.parse(parsed.title),
    payload: zMarketingContentPayload.parse(parsed.payload),
  }
}

export function isFiniteFutureDate(value, now = new Date()) {
  return value instanceof Date && Number.isFinite(value.getTime()) && value.getTime() > now.getTime()
}

export function isActiveRightsWindow(rights, now = new Date()) {
  if (!rights) return false
  const validFrom = new Date(rights.validFrom)
  const validUntil = new Date(rights.validUntil)
  return Number.isFinite(validFrom.getTime()) && Number.isFinite(validUntil.getTime()) &&
    validFrom.getTime() <= now.getTime() && now.getTime() < validUntil.getTime()
}
