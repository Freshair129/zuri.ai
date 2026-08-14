import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { z } from 'zod'
import { parseLineCanaryReceipt } from './line-activation-contract.js'

// @req FR-055 — adapt one strict redacted zuri-cli artifact into a canary receipt.
// @spec BR-014, SDD-028, SEC-012 — pin local transport evidence without network or secret access.
// @tested tests/unit/zuri-cli-canary-receipt.test.js

const CONTRACT_VERSION = '1.0.0'
const zUuid = z.string().uuid()
const zSha256 = z.string().regex(/^[a-f0-9]{64}$/)
const zIdentifier = z.string().min(1).max(200)
const zDateTime = z.string().datetime({ offset: true })
const APPROVED_SCOPE = Object.freeze({
  projectRef: 'qcnmhyglarzcpudjorzc',
  tenantId: '77cdbe70-3111-4a04-922a-8059be99a8b0',
  businessId: '834fa869-62f3-431c-a287-e9a95e91175b',
  bindingId: '84ed2c90-ab44-46f3-9618-1f24df0744b9',
})

const zTransportArtifact = z.object({
  contractVersion: z.literal(CONTRACT_VERSION),
  eventId: zUuid,
  correlationId: zUuid,
  projectRef: z.literal(APPROVED_SCOPE.projectRef),
  tenantId: z.literal(APPROVED_SCOPE.tenantId),
  businessId: z.literal(APPROVED_SCOPE.businessId),
  bindingId: z.literal(APPROVED_SCOPE.bindingId),
  bindingVersion: z.number().int().min(1),
  canaryPlanSha256: zSha256,
  goldenReportSha256: zSha256,
  isolationReportSha256: zSha256,
  transportSourceSha256: zSha256,
  transportConfigSha256: zSha256,
  providerId: zIdentifier,
  modelId: zIdentifier,
  approvalRef: zIdentifier,
  occurredAt: zDateTime,
  actorFingerprint: zSha256,
  httpObservation: z.object({
    statusCode: z.number().int().min(100).max(599),
    occurredAt: zDateTime,
  }).strict().optional(),
}).strict().superRefine((value, context) => {
  if (value.httpObservation
    && new Date(value.httpObservation.occurredAt) < new Date(value.occurredAt)) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['httpObservation', 'occurredAt'],
      message: 'HTTP observation time cannot precede artifact time',
    })
  }
})

export function parseZuriCliTransportArtifact(value) {
  return zTransportArtifact.parse(value)
}

export function adaptZuriCliCanaryReceiptFile(filePath) {
  const artifactBytes = readFileSync(filePath)
  const artifact = parseZuriCliTransportArtifact(JSON.parse(artifactBytes.toString('utf8')))
  const acceptedByLine = artifact.httpObservation?.statusCode >= 200
    && artifact.httpObservation.statusCode <= 299

  return parseLineCanaryReceipt({
    contractVersion: CONTRACT_VERSION,
    eventId: artifact.eventId,
    correlationId: artifact.correlationId,
    eventType: 'CANARY_TRANSPORT',
    receiptState: acceptedByLine ? 'ACCEPTED_BY_LINE' : 'GENERATED',
    projectRef: artifact.projectRef,
    tenantId: artifact.tenantId,
    businessId: artifact.businessId,
    bindingId: artifact.bindingId,
    bindingVersionBefore: artifact.bindingVersion,
    bindingVersionAfter: artifact.bindingVersion,
    canaryPlanSha256: artifact.canaryPlanSha256,
    goldenReportSha256: artifact.goldenReportSha256,
    isolationReportSha256: artifact.isolationReportSha256,
    providerId: artifact.providerId,
    modelId: artifact.modelId,
    approvalRef: artifact.approvalRef,
    transportArtifactSha256: createHash('sha256').update(artifactBytes).digest('hex'),
    ...(acceptedByLine ? { lineAcceptanceClass: 'HTTP_2XX' } : {}),
    occurredAt: acceptedByLine ? artifact.httpObservation.occurredAt : artifact.occurredAt,
    actorFingerprint: artifact.actorFingerprint,
  })
}
