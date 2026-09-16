import { createHash } from 'node:crypto'
import { z } from 'zod'

// @req FR-185 — one strict, hash-bound planning payload is shared by create,
// revision, read and snapshot recovery; it contains references, never content.
// @spec FR-157, FR-159, FR-160, FR-103, SEC-001, SEC-003
// @tested tests/unit/marketing/marketing-broadcast-contract.test.js

const text = (name, max = 200) => z.string().trim().min(1, `${name} is required`).max(max, `${name} is too long`)
const hash = z.string().regex(/^[a-f0-9]{64}$/, 'must be a lowercase SHA-256 hash')
const internalId = text('internal id', 200)

export const BROADCAST_INTENT_STATUSES = Object.freeze(['PLANNING', 'ARCHIVED'])
export const BROADCAST_INTENT_STATES = Object.freeze(['READY', 'EMPTY', 'PARTIAL', 'UNAVAILABLE', 'UNKNOWN', 'FORBIDDEN'])
export const BROADCAST_DISPATCH_UNAVAILABLE = Object.freeze({
  state: 'UNAVAILABLE',
  reasonCode: 'LINE_BROADCAST_OWNER_CONTRACT_UNAVAILABLE',
})
export const BROADCAST_AUDIENCE_UNAVAILABLE = Object.freeze({
  source: 'CRM_CONVERSATION_READ_MODEL',
  sourceVersion: null,
  audienceSpecVersion: '1.0',
  filter: { consentStatus: 'GRANTED' },
  criteriaHash: '40a2ec2eb918a1ac9ba76e6a0f811b8b3e38eec32f0fe654388123122b780268',
  resolutionState: 'UNAVAILABLE',
  resolutionRef: null,
})
export const BROADCAST_CONSENT_UNAVAILABLE = Object.freeze({
  source: 'CRM_CUSTOMER.consentStatus',
  requiredValue: 'GRANTED',
  policyReference: 'FR-103',
  policyVersion: null,
  snapshotRef: null,
  snapshotVersion: null,
  state: 'UNAVAILABLE',
})

const zAccount = z.object({
  lineOaAccountId: internalId,
  accountVersion: z.number().int().min(1),
}).strict()

const zContent = z.object({
  briefId: internalId,
  contentVersionId: internalId,
  payloadHash: hash,
}).strict()

const zAudience = z.object({
  source: z.literal('CRM_CONVERSATION_READ_MODEL'),
  sourceVersion: z.null(),
  audienceSpecVersion: z.literal('1.0'),
  filter: z.object({ consentStatus: z.literal('GRANTED') }).strict(),
  criteriaHash: hash,
  resolutionState: z.literal('UNAVAILABLE'),
  resolutionRef: z.null(),
}).strict()

const zConsent = z.object({
  source: z.literal('CRM_CUSTOMER.consentStatus'),
  requiredValue: z.literal('GRANTED'),
  policyReference: z.literal('FR-103'),
  policyVersion: z.null(),
  snapshotRef: z.null(),
  snapshotVersion: z.null(),
  state: z.literal('UNAVAILABLE'),
}).strict()

export const zMarketingBroadcastPayloadInput = z.object({
  channel: z.literal('LINE'),
  account: zAccount.nullable(),
  accountState: z.literal('UNAVAILABLE').optional(),
  accountReasonCode: z.literal('LINE_ACCOUNT_NOT_SELECTED').optional(),
  content: zContent,
  audience: zAudience,
  consent: zConsent,
}).strict().superRefine((value, context) => {
  if (value.account === null) {
    if (value.accountState !== 'UNAVAILABLE') context.addIssue({ code: z.ZodIssueCode.custom, path: ['accountState'], message: 'accountState must be UNAVAILABLE when account is null' })
    if (value.accountReasonCode !== 'LINE_ACCOUNT_NOT_SELECTED') context.addIssue({ code: z.ZodIssueCode.custom, path: ['accountReasonCode'], message: 'accountReasonCode must be LINE_ACCOUNT_NOT_SELECTED when account is null' })
  } else if (value.accountState !== undefined || value.accountReasonCode !== undefined) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['accountState'], message: 'accountState is only allowed when account is null' })
  }
})

export const zMarketingBroadcastCreateInput = z.object({
  businessId: text('businessId', 200),
  idempotencyKey: text('idempotencyKey', 200),
  code: text('code', 100).optional(),
  payload: zMarketingBroadcastPayloadInput,
}).strict()

const expectedVersion = z.number().int().min(1)
export const zMarketingBroadcastActionInput = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('revise'),
    businessId: text('businessId', 200),
    expectedVersion,
    payload: zMarketingBroadcastPayloadInput,
  }).strict(),
  z.object({
    action: z.literal('archive'),
    businessId: text('businessId', 200),
    expectedVersion,
  }).strict(),
])

export const zMarketingBroadcastIntentId = internalId

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue)
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stableValue(value[key])]))
  }
  return value
}

export function stableJson(value) {
  return JSON.stringify(stableValue(value))
}

export function criteriaHash(filter = { consentStatus: 'GRANTED' }) {
  return createHash('sha256').update(stableJson(filter), 'utf8').digest('hex')
}

export function normalizeMarketingBroadcastPayload(input) {
  const parsed = zMarketingBroadcastPayloadInput.parse(input)
  const expectedCriteriaHash = criteriaHash(parsed.audience.filter)
  if (parsed.audience.criteriaHash !== expectedCriteriaHash) {
    throw new Error('BROADCAST_AUDIENCE_CRITERIA_HASH_INVALID')
  }
  return parsed
}

export function serializeMarketingBroadcastPayload(payload) {
  return stableJson(normalizeMarketingBroadcastPayload(payload))
}

export function hashMarketingBroadcastPayload(payload) {
  return createHash('sha256').update(serializeMarketingBroadcastPayload(payload), 'utf8').digest('hex')
}

export function parseMarketingBroadcastPayload(payloadJson, expectedHash = null) {
  if (typeof payloadJson !== 'string') throw new Error('BROADCAST_PAYLOAD_JSON_INVALID')
  let parsed
  try {
    parsed = JSON.parse(payloadJson)
  } catch {
    throw new Error('BROADCAST_PAYLOAD_JSON_INVALID')
  }
  const normalized = normalizeMarketingBroadcastPayload(parsed)
  const actualHash = hashMarketingBroadcastPayload(normalized)
  if (expectedHash !== null && actualHash !== expectedHash) throw new Error('BROADCAST_PAYLOAD_HASH_INVALID')
  return normalized
}

export function broadcastPayloadIdentity(payload) {
  const normalized = normalizeMarketingBroadcastPayload(payload)
  return { payload: normalized, payloadJson: serializeMarketingBroadcastPayload(normalized), payloadHash: hashMarketingBroadcastPayload(normalized) }
}

export function classifyMarketingQuestion(question) {
  const normalized = typeof question === 'string' ? question.trim().toLowerCase() : ''
  if (/(roas|revenue|รายได้|ยอดจริง)/u.test(normalized)) return 'ANALYZE_ROAS'
  if (/(fatigue|frequency|ล้า|ความถี่)/u.test(normalized)) return 'DETECT_FATIGUE'
  if (!normalized || normalized === 'overview') return 'EXECUTIVE_OVERVIEW'
  return 'UNSUPPORTED'
}

export const zMarketingAskInput = z.object({
  businessId: text('businessId', 200),
  question: z.string().trim().max(400, 'question is too long'),
}).strict()

export const zMarketingAskQuestion = zMarketingAskInput.shape.question
