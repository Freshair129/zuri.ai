import { z } from 'zod'

// @req FR-055 — parse strict activation and redacted receipt contracts.
// @spec BR-014, SDD-028, SEC-012 — correlation, scope and evidence cross the operator boundary without raw secrets.
// @tested tests/unit/line-activation-contract.test.js

const CONTRACT_VERSION = '1.0.0'
const zUuid = z.string().uuid()
const zSha256 = z.string().regex(/^[a-f0-9]{64}$/)
const zIdentifier = z.string().min(1).max(200)
const zDateTime = z.string().datetime({ offset: true })

export const LINE_ACTIVATION_RECEIPT_STATES = Object.freeze([
  'GENERATED',
  'EVIDENCE_VERIFIED',
  'ACCEPTED_BY_LINE',
  'DISPLAYED_UNKNOWN',
  'READ_UNKNOWN',
])

const zActivationInput = z.object({
  contractVersion: z.literal(CONTRACT_VERSION),
  mode: z.enum(['DRY_RUN', 'APPLY']).default('DRY_RUN'),
  correlationId: zUuid,
  scope: z.object({
    projectRef: zIdentifier,
    tenantId: zUuid,
    businessId: zUuid,
    bindingId: zUuid,
  }).strict(),
  expectation: z.object({
    bindingVersion: z.number().int().min(1),
    bindingStatus: z.literal('PENDING'),
    destinationHashPresent: z.literal(false),
    credentialHashPresent: z.literal(false),
    bindingCode: z.literal('LINE-SMARTGIFT-OA'),
    channelProvider: z.literal('LINE'),
    providerId: zIdentifier,
    modelId: zIdentifier,
  }).strict(),
  evidence: z.object({
    canaryPlanSha256: zSha256,
    goldenReportSha256: zSha256,
    isolationReportSha256: zSha256,
  }).strict(),
  approval: z.object({
    approvalRef: zIdentifier,
    notBefore: zDateTime,
    expiresAt: zDateTime,
  }).strict(),
  bindingExpiresAt: zDateTime,
}).strict().superRefine((value, context) => {
  if (new Date(value.approval.notBefore) >= new Date(value.approval.expiresAt)) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['approval', 'expiresAt'],
      message: 'approval window must end after it starts',
    })
  }
})

const zRollbackInput = z.object({
  contractVersion: z.literal(CONTRACT_VERSION),
  mode: z.enum(['DRY_RUN', 'APPLY']).default('DRY_RUN'),
  correlationId: zUuid,
  scope: z.object({
    projectRef: zIdentifier,
    tenantId: zUuid,
    businessId: zUuid,
    bindingId: zUuid,
  }).strict(),
  expectation: z.object({
    bindingVersion: z.number().int().min(1),
    bindingStatus: z.literal('ACTIVE'),
    destinationHashPresent: z.literal(true),
    credentialHashPresent: z.literal(true),
    bindingCode: z.literal('LINE-SMARTGIFT-OA'),
    channelProvider: z.literal('LINE'),
    providerId: zIdentifier,
    modelId: zIdentifier,
  }).strict(),
  evidence: z.object({
    canaryPlanSha256: zSha256,
    goldenReportSha256: zSha256,
    isolationReportSha256: zSha256,
  }).strict(),
  approval: z.object({
    approvalRef: zIdentifier,
    notBefore: zDateTime,
    expiresAt: zDateTime,
  }).strict(),
}).strict().superRefine((value, context) => {
  if (new Date(value.approval.notBefore) >= new Date(value.approval.expiresAt)) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['approval', 'expiresAt'],
      message: 'approval window must end after it starts',
    })
  }
})

const zReceipt = z.object({
  contractVersion: z.literal(CONTRACT_VERSION),
  eventId: zUuid,
  correlationId: zUuid,
  eventType: z.enum(['ACTIVATION', 'ROLLBACK', 'CANARY_TRANSPORT']),
  receiptState: z.enum(LINE_ACTIVATION_RECEIPT_STATES),
  projectRef: zIdentifier,
  tenantId: zUuid,
  businessId: zUuid,
  bindingId: zUuid,
  bindingVersionBefore: z.number().int().min(1),
  bindingVersionAfter: z.number().int().min(1),
  canaryPlanSha256: zSha256,
  goldenReportSha256: zSha256,
  isolationReportSha256: zSha256,
  providerId: zIdentifier,
  modelId: zIdentifier,
  approvalRef: zIdentifier,
  transportArtifactSha256: zSha256.optional(),
  lineAcceptanceClass: z.literal('HTTP_2XX').optional(),
  occurredAt: zDateTime,
  actorFingerprint: zSha256,
}).strict().superRefine((value, context) => {
  const mutationEvent = value.eventType === 'ACTIVATION' || value.eventType === 'ROLLBACK'
  const expectedAfter = mutationEvent ? value.bindingVersionBefore + 1 : value.bindingVersionBefore
  if (value.bindingVersionAfter !== expectedAfter) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['bindingVersionAfter'],
      message: 'receipt version movement does not match event type',
    })
  }

  const mutationState = value.eventType === 'ACTIVATION' || value.eventType === 'ROLLBACK'
  const stateMatchesEvent = mutationState
    ? value.receiptState === 'EVIDENCE_VERIFIED'
    : ['GENERATED', 'ACCEPTED_BY_LINE', 'DISPLAYED_UNKNOWN', 'READ_UNKNOWN'].includes(value.receiptState)
  if (!stateMatchesEvent) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['receiptState'],
      message: 'event type and receipt state belong to different owners',
    })
  }

  if (mutationState && (value.transportArtifactSha256 || value.lineAcceptanceClass)) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['transportArtifactSha256'],
      message: 'mutation events cannot carry transport evidence',
    })
  }

  if (value.receiptState === 'GENERATED' && value.lineAcceptanceClass) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['lineAcceptanceClass'],
      message: 'LINE acceptance cannot exist while the transport receipt is generated',
    })
  }

  const lineObserved = ['ACCEPTED_BY_LINE', 'DISPLAYED_UNKNOWN', 'READ_UNKNOWN'].includes(value.receiptState)
  if (lineObserved && (!value.transportArtifactSha256 || !value.lineAcceptanceClass)) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['transportArtifactSha256'],
      message: 'transport hash and LINE acceptance class are required after LINE acceptance',
    })
  }
})

export function parseLineActivationInput(value, options = {}) {
  const parsed = zActivationInput.parse(value)
  const now = new Date(options.now ?? Date.now())
  if (Number.isNaN(now.getTime())) throw new Error('LINE_ACTIVATION_INVALID_NOW')

  const notBefore = new Date(parsed.approval.notBefore)
  const approvalExpiresAt = new Date(parsed.approval.expiresAt)
  const bindingExpiresAt = new Date(parsed.bindingExpiresAt)
  if (now < notBefore || now >= approvalExpiresAt) {
    throw new Error('LINE_ACTIVATION_APPROVAL_WINDOW_INACTIVE')
  }
  if (bindingExpiresAt <= now || bindingExpiresAt <= notBefore || bindingExpiresAt > approvalExpiresAt) {
    throw new Error('LINE_ACTIVATION_BINDING_EXPIRY_OUT_OF_BOUNDS')
  }
  return parsed
}

export function parseLineCanaryReceipt(value) {
  return zReceipt.parse(value)
}

export function parseLineRollbackInput(value, options = {}) {
  const parsed = zRollbackInput.parse(value)
  const now = new Date(options.now ?? Date.now())
  if (Number.isNaN(now.getTime())) throw new Error('LINE_ROLLBACK_INVALID_NOW')

  const notBefore = new Date(parsed.approval.notBefore)
  const approvalExpiresAt = new Date(parsed.approval.expiresAt)
  if (now < notBefore || now >= approvalExpiresAt) {
    throw new Error('LINE_ROLLBACK_APPROVAL_WINDOW_INACTIVE')
  }
  return parsed
}
